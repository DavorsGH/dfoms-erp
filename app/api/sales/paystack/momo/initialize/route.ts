import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { requireTenantRoleIn } from "@/utils/admin-auth";
import { POS_SECTION_ROLES } from "@/utils/rbac-access";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  ghsToPesewas,
  initializePaystackOneOffTransaction,
} from "@/utils/paystack";
import {
  isValidEmail,
  PRODUCT_SALE_PAYSTACK_CONTEXT,
  resolvePaystackCustomerEmail,
  resolveSiteUrlFromRequest,
  roundGhs,
} from "@/utils/product-sale-paystack";
import { requireActiveSettlementSubaccount } from "@/utils/product-sale-settlement";
import {
  buildCartSnapshot,
  cartSnapshotTotal,
} from "@/utils/pos-momo-fulfillment";
import {
  POS_MOMO_PAYMENT_METHOD,
  type PosCartLine,
} from "@/app/dashboard/pos/pos-utils";

export const runtime = "nodejs";

type MomoInitializeBody = {
  sale_date?: string;
  client_id?: string | null;
  customer_name?: string | null;
  notes?: string | null;
  due_date?: string;
  delivery_email?: string | null;
  cart_lines?: PosCartLine[];
};

export async function POST(request: Request) {
  const auth = await requireTenantRoleIn(POS_SECTION_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  let body: MomoInitializeBody;
  try {
    body = (await request.json()) as MomoInitializeBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const cartLines = Array.isArray(body.cart_lines) ? body.cart_lines : [];
  if (cartLines.length === 0) {
    return NextResponse.json({ error: "cart_lines is required" }, { status: 400 });
  }

  for (const line of cartLines) {
    if (!line.productId || !(line.quantity > 0) || line.unitPrice < 0) {
      return NextResponse.json(
        { error: "Each cart line needs productId, quantity > 0, and unitPrice >= 0." },
        { status: 400 },
      );
    }
  }

  const clientId =
    typeof body.client_id === "string" && body.client_id.trim()
      ? body.client_id.trim()
      : null;
  const customerName =
    typeof body.customer_name === "string" && body.customer_name.trim()
      ? body.customer_name.trim()
      : null;

  if (!clientId && !customerName) {
    return NextResponse.json(
      { error: "Select a customer or enter a walk-in name." },
      { status: 400 },
    );
  }

  const saleDate =
    typeof body.sale_date === "string" && body.sale_date.trim()
      ? body.sale_date.trim()
      : new Date().toISOString().slice(0, 10);
  const dueDate =
    typeof body.due_date === "string" && body.due_date.trim()
      ? body.due_date.trim()
      : saleDate;
  const notes =
    typeof body.notes === "string" && body.notes.trim()
      ? body.notes.trim()
      : null;

  const deliveryEmailRaw =
    typeof body.delivery_email === "string" ? body.delivery_email.trim() : "";
  const deliveryEmail = deliveryEmailRaw
    ? deliveryEmailRaw.toLowerCase()
    : null;
  if (deliveryEmail && !isValidEmail(deliveryEmail)) {
    return NextResponse.json(
      { error: "delivery_email is not a valid email address." },
      { status: 400 },
    );
  }

  const snapshot = buildCartSnapshot({
    saleDate,
    clientId,
    customerName,
    notes,
    dueDate,
    cartLines,
  });
  const amountGhs = cartSnapshotTotal(snapshot);
  if (amountGhs <= 0) {
    return NextResponse.json(
      { error: "Cart total must be greater than zero." },
      { status: 400 },
    );
  }

  // Tenant fund routing: POS MoMo payments are customer money owed to the
  // tenant, so we must charge into the tenant's settlement subaccount. BLOCK
  // (never silently omit the subaccount) if Payment Settings is not active.
  const settlement = await requireActiveSettlementSubaccount(auth.tenantId);
  if (!settlement.ok) {
    return NextResponse.json(
      { error: settlement.error, code: settlement.code ?? undefined },
      { status: settlement.status },
    );
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const provisionalInvoice = `MOMO-PENDING-${crypto.randomUUID().slice(0, 8)}`;
  const admin = createAdminClient();

  const { data: inserted, error: insertError } = await admin
    .from("product_sale_payment_requests")
    .insert({
      tenant_id: auth.tenantId,
      invoice_no: provisionalInvoice,
      income_ids: [],
      cart_snapshot: snapshot,
      amount_requested: amountGhs,
      currency: "GHS",
      status: "pending",
      payment_method: POS_MOMO_PAYMENT_METHOD,
      delivery_email: deliveryEmail,
      delivery_phone: null,
      send_email: false,
      send_sms: false,
      created_by: user?.id ?? null,
    })
    .select("id")
    .single();

  if (insertError || !inserted?.id) {
    return NextResponse.json(
      { error: insertError?.message ?? "Failed to create payment request." },
      { status: 500 },
    );
  }

  const paymentRequestId = inserted.id as string;
  const siteUrl = resolveSiteUrlFromRequest(request);
  const callbackUrl = `${siteUrl}/pay/product-sale/callback?payment_request_id=${encodeURIComponent(paymentRequestId)}`;
  const paystackEmail = resolvePaystackCustomerEmail({
    deliveryEmail,
    invoiceNo: provisionalInvoice,
  });

  const initialized = await initializePaystackOneOffTransaction({
    email: paystackEmail,
    amountPesewas: ghsToPesewas(amountGhs),
    callbackUrl,
    currency: "GHS",
    channels: ["mobile_money"],
    // Route this charge to the tenant's settlement account (guarded above).
    subaccountCode: settlement.subaccountCode,
    metadata: {
      context: PRODUCT_SALE_PAYSTACK_CONTEXT,
      tenant_id: auth.tenantId,
      invoice_no: provisionalInvoice,
      payment_request_id: paymentRequestId,
      flow: "pos_momo_inline",
    },
  });

  if (!initialized.ok) {
    await admin
      .from("product_sale_payment_requests")
      .update({
        status: "failed",
        updated_at: new Date().toISOString(),
        email_error: initialized.error,
      })
      .eq("id", paymentRequestId);

    return NextResponse.json({ error: initialized.error }, { status: 502 });
  }

  if (!initialized.accessCode?.trim()) {
    await admin
      .from("product_sale_payment_requests")
      .update({
        status: "failed",
        updated_at: new Date().toISOString(),
        email_error: "Paystack initialize response missing access_code.",
      })
      .eq("id", paymentRequestId);

    return NextResponse.json(
      { error: "Paystack initialize response missing access_code." },
      { status: 502 },
    );
  }

  const { error: updateError } = await admin
    .from("product_sale_payment_requests")
    .update({
      paystack_reference: initialized.reference,
      authorization_url: initialized.authorizationUrl,
      status: "sent",
      updated_at: new Date().toISOString(),
    })
    .eq("id", paymentRequestId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    payment_request_id: paymentRequestId,
    reference: initialized.reference,
    access_code: initialized.accessCode,
    authorization_url: initialized.authorizationUrl,
    amount_ghs: roundGhs(amountGhs),
    public_key: (process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY ?? "").trim() || null,
  });
}
