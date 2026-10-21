import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import { PRODUCT_SALE_PAYSTACK_ROLES } from "@/utils/rbac-access";
import { createAdminClient } from "@/utils/supabase/admin";
import { verifyPaystackTransaction } from "@/utils/paystack";
import { loadPaymentRequestForFulfillment } from "@/utils/pos-momo-fulfillment";
import { processProductSalePaystackEvent } from "@/utils/paystack-product-sale-webhook";
import {
  PRODUCT_SALE_PAYSTACK_CONTEXT,
  roundGhs,
} from "@/utils/product-sale-paystack";

export const runtime = "nodejs";

type ConfirmBody = {
  payment_request_id?: string;
  reference?: string;
  /** Customer closed or failed the popup. No sale or payment is recorded. */
  abandon?: boolean;
};

export async function POST(request: Request) {
  const auth = await requireTenantRoleIn(PRODUCT_SALE_PAYSTACK_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  let body: ConfirmBody;
  try {
    body = (await request.json()) as ConfirmBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const paymentRequestId =
    typeof body.payment_request_id === "string"
      ? body.payment_request_id.trim()
      : "";
  const reference =
    typeof body.reference === "string" ? body.reference.trim() : "";

  if (!paymentRequestId && !reference) {
    return NextResponse.json(
      { error: "payment_request_id or reference is required" },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const requestRow = await loadPaymentRequestForFulfillment(admin, {
    paymentRequestId: paymentRequestId || null,
    reference: reference || null,
  });

  if (!requestRow) {
    return NextResponse.json(
      { error: "Payment request not found." },
      { status: 404 },
    );
  }

  if (requestRow.tenant_id !== auth.tenantId) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  if (body.abandon === true) {
    if (requestRow.status === "paid") {
      return NextResponse.json(
        { error: "This payment is already confirmed." },
        { status: 409 },
      );
    }
    const { error: abandonError } = await admin
      .from("product_sale_payment_requests")
      .update({
        status: "cancelled",
        updated_at: new Date().toISOString(),
      })
      .eq("id", requestRow.id)
      .eq("tenant_id", auth.tenantId)
      .in("status", ["pending", "sent"]);
    if (abandonError) {
      return NextResponse.json({ error: abandonError.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true, abandoned: true });
  }

  const refToVerify =
    reference || (requestRow.paystack_reference ?? "").trim();
  if (!refToVerify) {
    return NextResponse.json(
      { error: "Missing Paystack reference." },
      { status: 400 },
    );
  }

  const verified = await verifyPaystackTransaction(refToVerify);
  if (!verified.ok) {
    return NextResponse.json({ error: verified.error }, { status: 502 });
  }
  if (verified.status !== "success") {
    return NextResponse.json(
      {
        error: `Payment not successful yet (status: ${verified.status}).`,
        status: verified.status,
      },
      { status: 409 },
    );
  }

  const paidAmountGhs =
    verified.amount != null ? roundGhs(verified.amount / 100) : null;

  try {
    const processed = await processProductSalePaystackEvent({
      reference: verified.reference,
      amount: verified.amount,
      channel: verified.channel,
      paid_at: verified.paidAt,
      metadata: {
        context: PRODUCT_SALE_PAYSTACK_CONTEXT,
        tenant_id: requestRow.tenant_id,
        invoice_no: requestRow.invoice_no,
        payment_request_id: requestRow.id,
      },
    });
    if (processed.ignored || processed.needsAttention) {
      return NextResponse.json({ error: processed.detail }, { status: 409 });
    }

    const latest = await loadPaymentRequestForFulfillment(admin, {
      paymentRequestId: requestRow.id,
    });

    return NextResponse.json({
      ok: true,
      invoice_no: latest?.invoice_no ?? requestRow.invoice_no,
      income_ids: latest?.income_ids ?? requestRow.income_ids ?? [],
      already_fulfilled: latest?.status === "paid" && requestRow.status === "paid",
      payment_method: latest?.payment_method ?? requestRow.payment_method,
      reference: verified.reference,
      amount_ghs: paidAmountGhs,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to record the sale after payment.",
      },
      { status: 500 },
    );
  }
}
