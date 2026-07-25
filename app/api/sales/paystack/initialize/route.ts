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
  invoiceOutstanding,
  isRequestPaymentMethod,
  isValidEmail,
  normalizeGhanaPhone,
  paymentMethodFromNotes,
  PRODUCT_SALE_PAYSTACK_CONTEXT,
  resolvePaystackCustomerEmail,
  resolveSiteUrlFromRequest,
  roundGhs,
  type ProductSaleIncomeLine,
} from "@/utils/product-sale-paystack";
import { requireActiveSettlementSubaccount } from "@/utils/product-sale-settlement";
import {
  buildCartSnapshot,
  cartSnapshotTotal,
} from "@/utils/pos-momo-fulfillment";
import type { PosCartLine } from "@/app/dashboard/pos/pos-utils";
import { sendResendEmail } from "@/utils/resend-email";
import { sendHubtelSms } from "@/utils/hubtel-sms";

export const runtime = "nodejs";

type InitializeBody = {
  /** Existing unpaid invoice path (Product Sales / legacy). */
  invoice_no?: string;
  amount_ghs?: number;
  delivery_email?: string | null;
  delivery_phone?: string | null;
  send_email?: boolean;
  send_sms?: boolean;
  payment_method?: string | null;
  /** POS charge-first cart path (Request Payment link). */
  cart_lines?: PosCartLine[];
  sale_date?: string;
  client_id?: string | null;
  customer_name?: string | null;
  notes?: string | null;
  due_date?: string;
};

type IncomeRow = ProductSaleIncomeLine & {
  invoice_no: string;
  tenant_id: string;
};

const REQUEST_PAYMENT_CHANNELS = ["card", "mobile_money"] as const;

async function deliverPaymentLink(options: {
  sendEmail: boolean;
  sendSms: boolean;
  deliveryEmail: string | null;
  deliveryPhone: string | null;
  link: string;
  amountLabel: string;
  invoiceLabel: string;
}): Promise<{
  emailSent: boolean;
  smsSent: boolean;
  emailError: string | null;
  smsError: string | null;
  emailSentAt: string | null;
  smsSentAt: string | null;
}> {
  let emailSent = false;
  let smsSent = false;
  let emailError: string | null = null;
  let smsError: string | null = null;
  let emailSentAt: string | null = null;
  let smsSentAt: string | null = null;

  if (options.sendEmail && options.deliveryEmail) {
    const emailResult = await sendResendEmail({
      to: options.deliveryEmail,
      subject: `Payment request for ${options.invoiceLabel}`,
      html: `<p>Please pay <strong>GHS ${options.amountLabel}</strong> for <strong>${options.invoiceLabel}</strong>.</p><p><a href="${options.link}">Pay now</a></p><p>If the button does not work, open this link:<br/>${options.link}</p>`,
      text: `Please pay GHS ${options.amountLabel} for ${options.invoiceLabel}: ${options.link}`,
    });
    if (emailResult.ok) {
      emailSent = true;
      emailSentAt = new Date().toISOString();
    } else {
      emailError = emailResult.error;
    }
  }

  if (options.sendSms && options.deliveryPhone) {
    const smsResult = await sendHubtelSms({
      to: options.deliveryPhone,
      content: `Davors: Pay GHS ${options.amountLabel} for ${options.invoiceLabel}: ${options.link}`,
    });
    if (smsResult.ok) {
      smsSent = true;
      smsSentAt = new Date().toISOString();
    } else {
      smsError = smsResult.error;
    }
  }

  return {
    emailSent,
    smsSent,
    emailError,
    smsError,
    emailSentAt,
    smsSentAt,
  };
}

export async function POST(request: Request) {
  const auth = await requireTenantRoleIn(POS_SECTION_ROLES);
  if (!auth.ok) {
    return auth.response;
  }

  let body: InitializeBody;
  try {
    body = (await request.json()) as InitializeBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const cartLines = Array.isArray(body.cart_lines) ? body.cart_lines : [];
  const hasCart = cartLines.length > 0;

  const sendEmail = Boolean(body.send_email);
  const sendSms = Boolean(body.send_sms);
  if (!sendEmail && !sendSms) {
    return NextResponse.json(
      { error: "Select at least one delivery channel (email or SMS)." },
      { status: 400 },
    );
  }

  const deliveryEmailRaw =
    typeof body.delivery_email === "string" ? body.delivery_email.trim() : "";
  const deliveryPhoneRaw =
    typeof body.delivery_phone === "string" ? body.delivery_phone.trim() : "";

  const deliveryEmail = deliveryEmailRaw
    ? deliveryEmailRaw.toLowerCase()
    : null;
  const deliveryPhone = normalizeGhanaPhone(deliveryPhoneRaw);

  if (sendEmail && !isValidEmail(deliveryEmail)) {
    return NextResponse.json(
      { error: "A valid delivery_email is required when send_email is true." },
      { status: 400 },
    );
  }

  if (sendSms && !deliveryPhone) {
    return NextResponse.json(
      {
        error:
          "A valid Ghana phone number (e.g. +233…) is required when send_sms is true.",
      },
      { status: 400 },
    );
  }

  // Tenant fund routing: Request Payment links collect customer money owed to
  // the tenant, so every Paystack charge below (cart path AND invoice path)
  // must route into the tenant's settlement subaccount. BLOCK (never silently
  // omit the subaccount) if Payment Settings is not active.
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
  const admin = createAdminClient();
  const siteUrl = resolveSiteUrlFromRequest(request);

  // ── Charge-first POS cart path (Request Payment link) ───────────────────
  if (hasCart) {
    for (const line of cartLines) {
      if (!line.productId || !(line.quantity > 0) || line.unitPrice < 0) {
        return NextResponse.json(
          {
            error:
              "Each cart line needs productId, quantity > 0, and unitPrice >= 0.",
          },
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

    const paymentMethod =
      (typeof body.payment_method === "string" && body.payment_method.trim()) ||
      "POS";
    if (!isRequestPaymentMethod(paymentMethod)) {
      return NextResponse.json(
        {
          error:
            "Request Payment is only available for non-Cash, non-Credit payment methods.",
        },
        { status: 400 },
      );
    }

    const provisionalInvoice = `LINK-PENDING-${crypto.randomUUID().slice(0, 8)}`;

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
        payment_method: paymentMethod,
        delivery_email: deliveryEmail,
        delivery_phone: deliveryPhone,
        send_email: sendEmail,
        send_sms: sendSms,
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
      channels: [...REQUEST_PAYMENT_CHANNELS],
      // Route this charge to the tenant's settlement account (guarded above).
      subaccountCode: settlement.subaccountCode,
      metadata: {
        context: PRODUCT_SALE_PAYSTACK_CONTEXT,
        tenant_id: auth.tenantId,
        invoice_no: provisionalInvoice,
        payment_request_id: paymentRequestId,
        flow: "pos_request_payment_link",
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
        .eq("id", paymentRequestId)
        .eq("tenant_id", auth.tenantId);

      return NextResponse.json({ error: initialized.error }, { status: 502 });
    }

    const amountLabel = amountGhs.toFixed(2);
    const delivery = await deliverPaymentLink({
      sendEmail,
      sendSms,
      deliveryEmail,
      deliveryPhone,
      link: initialized.authorizationUrl,
      amountLabel,
      invoiceLabel: "your POS order",
    });

    const { error: updateError } = await admin
      .from("product_sale_payment_requests")
      .update({
        paystack_reference: initialized.reference,
        authorization_url: initialized.authorizationUrl,
        status: "sent",
        email_sent_at: delivery.emailSentAt,
        sms_sent_at: delivery.smsSentAt,
        email_error: delivery.emailError,
        sms_error: delivery.smsError,
        updated_at: new Date().toISOString(),
      })
      .eq("id", paymentRequestId)
      .eq("tenant_id", auth.tenantId);

    if (updateError) {
      return NextResponse.json(
        {
          error: updateError.message,
          authorization_url: initialized.authorizationUrl,
          reference: initialized.reference,
        },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      payment_request_id: paymentRequestId,
      reference: initialized.reference,
      authorization_url: initialized.authorizationUrl,
      amount_ghs: roundGhs(amountGhs),
      outstanding_ghs: roundGhs(amountGhs),
      invoice_no: provisionalInvoice,
      email_sent: delivery.emailSent,
      sms_sent: delivery.smsSent,
      email_error: delivery.emailError,
      sms_error: delivery.smsError,
      charge_first: true,
    });
  }

  // ── Existing unpaid invoice path (income_ids) ───────────────────────────
  const invoiceNo =
    typeof body.invoice_no === "string" ? body.invoice_no.trim() : "";
  if (!invoiceNo) {
    return NextResponse.json(
      { error: "invoice_no or cart_lines is required" },
      { status: 400 },
    );
  }

  const { data: rows, error: rowsError } = await supabase
    .from("income_register")
    .select(
      "id, invoice_no, amount, amount_received, outstanding_balance, payment_status, sale_status, notes, tenant_id",
    )
    .eq("tenant_id", auth.tenantId)
    .eq("entry_type", "product_sale")
    .eq("invoice_no", invoiceNo)
    .order("date", { ascending: true });

  if (rowsError) {
    return NextResponse.json({ error: rowsError.message }, { status: 500 });
  }

  const activeLines = ((rows as IncomeRow[] | null) ?? []).filter(
    (row) => (row.sale_status ?? "active") !== "voided",
  );

  if (activeLines.length === 0) {
    return NextResponse.json(
      { error: "No active product sale lines found for this invoice." },
      { status: 404 },
    );
  }

  const outstanding = invoiceOutstanding(activeLines);
  if (outstanding <= 0) {
    return NextResponse.json(
      { error: "Invoice has no outstanding balance to collect." },
      { status: 409 },
    );
  }

  const requestedAmount =
    body.amount_ghs == null || body.amount_ghs === undefined
      ? outstanding
      : roundGhs(Number(body.amount_ghs));

  if (!Number.isFinite(requestedAmount) || requestedAmount <= 0) {
    return NextResponse.json(
      { error: "amount_ghs must be greater than zero." },
      { status: 400 },
    );
  }

  if (requestedAmount > outstanding + 0.001) {
    return NextResponse.json(
      {
        error: `amount_ghs cannot exceed outstanding balance (GHS ${outstanding.toFixed(2)}).`,
      },
      { status: 400 },
    );
  }

  const paymentMethod =
    (typeof body.payment_method === "string" && body.payment_method.trim()) ||
    paymentMethodFromNotes(activeLines[0]?.notes) ||
    "POS";

  if (!isRequestPaymentMethod(paymentMethod)) {
    return NextResponse.json(
      {
        error:
          "Request Payment is only available for non-Cash, non-Credit payment methods.",
      },
      { status: 400 },
    );
  }

  const incomeIds = activeLines.map((line) => line.id);
  const paystackEmail = resolvePaystackCustomerEmail({
    deliveryEmail,
    invoiceNo,
  });

  const { data: inserted, error: insertError } = await admin
    .from("product_sale_payment_requests")
    .insert({
      tenant_id: auth.tenantId,
      invoice_no: invoiceNo,
      income_ids: incomeIds,
      amount_requested: requestedAmount,
      currency: "GHS",
      status: "pending",
      payment_method: paymentMethod,
      delivery_email: deliveryEmail,
      delivery_phone: deliveryPhone,
      send_email: sendEmail,
      send_sms: sendSms,
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
  const callbackUrl = `${siteUrl}/pay/product-sale/callback?payment_request_id=${encodeURIComponent(paymentRequestId)}`;

  const initialized = await initializePaystackOneOffTransaction({
    email: paystackEmail,
    amountPesewas: ghsToPesewas(requestedAmount),
    callbackUrl,
    currency: "GHS",
    channels: [...REQUEST_PAYMENT_CHANNELS],
    // Route this charge to the tenant's settlement account (guarded above).
    subaccountCode: settlement.subaccountCode,
    metadata: {
      context: PRODUCT_SALE_PAYSTACK_CONTEXT,
      tenant_id: auth.tenantId,
      invoice_no: invoiceNo,
      payment_request_id: paymentRequestId,
      income_ids: incomeIds,
      flow: "product_sale_request_payment_invoice",
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
      .eq("id", paymentRequestId)
      .eq("tenant_id", auth.tenantId);

    return NextResponse.json({ error: initialized.error }, { status: 502 });
  }

  const amountLabel = requestedAmount.toFixed(2);
  const delivery = await deliverPaymentLink({
    sendEmail,
    sendSms,
    deliveryEmail,
    deliveryPhone,
    link: initialized.authorizationUrl,
    amountLabel,
    invoiceLabel: `invoice ${invoiceNo}`,
  });

  const { error: updateError } = await admin
    .from("product_sale_payment_requests")
    .update({
      paystack_reference: initialized.reference,
      authorization_url: initialized.authorizationUrl,
      status: "sent",
      email_sent_at: delivery.emailSentAt,
      sms_sent_at: delivery.smsSentAt,
      email_error: delivery.emailError,
      sms_error: delivery.smsError,
      updated_at: new Date().toISOString(),
    })
    .eq("id", paymentRequestId)
    .eq("tenant_id", auth.tenantId);

  if (updateError) {
    return NextResponse.json(
      {
        error: updateError.message,
        authorization_url: initialized.authorizationUrl,
        reference: initialized.reference,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    ok: true,
    payment_request_id: paymentRequestId,
    reference: initialized.reference,
    authorization_url: initialized.authorizationUrl,
    amount_ghs: requestedAmount,
    outstanding_ghs: outstanding,
    invoice_no: invoiceNo,
    email_sent: delivery.emailSent,
    sms_sent: delivery.smsSent,
    email_error: delivery.emailError,
    sms_error: delivery.smsError,
    charge_first: false,
  });
}
