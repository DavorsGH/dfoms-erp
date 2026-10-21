import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import { PRODUCT_SALE_PAYSTACK_ROLES } from "@/utils/rbac-access";
import { createAdminClient } from "@/utils/supabase/admin";
import { loadPaymentRequestForFulfillment } from "@/utils/pos-momo-fulfillment";
import {
  confirmProductSalePaystackPayment,
  PAYSTACK_CONFIRM_SOURCES,
  paystackConfirmResponse,
  type PaystackConfirmSource,
} from "@/utils/paystack-product-sale-confirm";

export const runtime = "nodejs";

type ConfirmBody = {
  payment_request_id?: string;
  reference?: string;
  /**
   * popup_success, popup_closed or check_payment. The server always verifies with
   * Paystack and never trusts the client's claim of success.
   */
  source?: string;
  /** Explicit cancel only. The popup no longer sends this on close. */
  abandon?: boolean;
};

function parseSource(raw: unknown): PaystackConfirmSource {
  if (
    typeof raw === "string" &&
    raw !== "nightly_reconciliation" &&
    (PAYSTACK_CONFIRM_SOURCES as readonly string[]).includes(raw)
  ) {
    return raw as PaystackConfirmSource;
  }
  return "popup_success";
}

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

  if (body.abandon === true) {
    const admin = createAdminClient();
    const requestRow = await loadPaymentRequestForFulfillment(admin, {
      paymentRequestId: paymentRequestId || null,
      reference: reference || null,
    });
    if (!requestRow) {
      return NextResponse.json({ error: "Payment request not found." }, { status: 404 });
    }
    if (requestRow.tenant_id !== auth.tenantId) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }
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

  const result = await confirmProductSalePaystackPayment({
    paymentRequestId: paymentRequestId || null,
    reference: reference || null,
    source: parseSource(body.source),
    tenantId: auth.tenantId,
  });
  const response = paystackConfirmResponse(result);
  return NextResponse.json(response.body, { status: response.status });
}
