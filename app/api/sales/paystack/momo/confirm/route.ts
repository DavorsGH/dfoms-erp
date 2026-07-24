import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import { POS_SECTION_ROLES } from "@/utils/rbac-access";
import { createAdminClient } from "@/utils/supabase/admin";
import { verifyPaystackTransaction } from "@/utils/paystack";
import {
  fulfillPosCartSnapshotPaymentRequest,
  loadPaymentRequestForFulfillment,
} from "@/utils/pos-momo-fulfillment";
import { roundGhs } from "@/utils/product-sale-paystack";

export const runtime = "nodejs";

type ConfirmBody = {
  payment_request_id?: string;
  reference?: string;
};

export async function POST(request: Request) {
  const auth = await requireTenantRoleIn(POS_SECTION_ROLES);
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
    const result = await fulfillPosCartSnapshotPaymentRequest(admin, requestRow, {
      reference: verified.reference,
      paidAmountGhs,
      paidAt: verified.paidAt,
      skipVerify: true,
      paystackChannel: verified.channel,
    });

    return NextResponse.json({
      ok: true,
      invoice_no: result.invoiceNo,
      income_ids: result.incomeIds,
      already_fulfilled: result.alreadyFulfilled,
      payment_method: result.paymentMethod,
      reference: verified.reference,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Failed to create sale after payment.",
      },
      { status: 500 },
    );
  }
}
