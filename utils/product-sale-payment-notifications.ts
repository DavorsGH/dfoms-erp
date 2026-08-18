import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { sendHubtelSms } from "@/utils/hubtel-sms";
import { normalizeGhanaPhone } from "@/utils/product-sale-paystack";
import { sendResendEmail } from "@/utils/resend-email";
import { tryDebitSmsCredit } from "@/utils/sms-credit";
import { createAdminClient } from "@/utils/supabase/admin";
import { notifyTenantAdminsAndDirectors } from "@/utils/tenant-admin-director-notifications";
import { fireTransactionalNotification } from "@/utils/transactional-notification-trigger";
import { resolveTenantDisplayName } from "@/utils/tenant-display-name";

type TenantOwnerContacts = {
  name: string | null;
  email: string | null;
  phone: string | null;
};

function roundMoney(value: number): number {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function formatMoneyLabel(value: number): string {
  return `GHS ${roundMoney(value).toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatOutstandingLabel(outstanding: number): string {
  if (outstanding <= 0) {
    return "fully paid";
  }
  return formatMoneyLabel(outstanding);
}

async function hasActivePaymentReceivedRule(
  admin: SupabaseClient,
  tenantId: string,
): Promise<boolean> {
  const { data, error } = await admin
    .from("transactional_notification_rules")
    .select("id, template_id, is_active")
    .eq("tenant_id", tenantId)
    .eq("event_type", "payment_received")
    .maybeSingle();

  if (error) {
    console.error(
      "[product-sale-payment-notifications] rule lookup failed:",
      error.message,
    );
    return false;
  }

  return Boolean(data && data.is_active === true && data.template_id);
}

async function loadTenantOwnerContacts(
  admin: SupabaseClient,
  tenantId: string,
): Promise<TenantOwnerContacts> {
  const { data, error } = await admin
    .from("tenants")
    .select("name, email, phone")
    .eq("id", tenantId)
    .maybeSingle();

  if (error) {
    console.error(
      "[product-sale-payment-notifications] owner contact lookup failed:",
      error.message,
    );
    return { name: null, email: null, phone: null };
  }

  return {
    name: typeof data?.name === "string" ? data.name.trim() || null : null,
    email: typeof data?.email === "string" ? data.email.trim() || null : null,
    phone: typeof data?.phone === "string" ? data.phone.trim() || null : null,
  };
}

async function sendFallbackPaymentReceivedToCustomer(options: {
  tenantId: string;
  tenantName: string;
  customerName: string;
  email: string | null;
  phone: string | null;
  invoiceNo: string;
  amountReceivedLabel: string;
  outstandingLabel: string;
  paymentReference: string;
}): Promise<boolean> {
  const subject = `Payment received — invoice ${options.invoiceNo}`;
  const lead = `We received ${options.amountReceivedLabel} toward invoice ${options.invoiceNo}. Remaining balance: ${options.outstandingLabel}.`;

  const text = [
    `Hi ${options.customerName},`,
    "",
    lead,
    options.paymentReference
      ? `Reference: ${options.paymentReference}`
      : "",
    "",
    "Thank you.",
  ]
    .filter(Boolean)
    .join("\n");

  const html = `<p>Hi ${escapeHtml(options.customerName)},</p>
<p>${escapeHtml(lead)}</p>
${options.paymentReference ? `<p>Reference: ${escapeHtml(options.paymentReference)}</p>` : ""}
<p>Thank you.</p>`;

  let sent = false;

  const email = (options.email ?? "").trim();
  if (email) {
    const result = await sendResendEmail({
      to: email,
      subject,
      html,
      text,
    });
    if (result.ok) {
      sent = true;
    } else {
      console.error(
        "[product-sale-payment-notifications] fallback email failed:",
        result.error,
      );
    }
  }

  const phone = normalizeGhanaPhone(options.phone);
  if (phone) {
    const creditOk = await tryDebitSmsCredit(options.tenantId);
    if (creditOk) {
      const sms = `Davors: Received ${options.amountReceivedLabel} on invoice ${options.invoiceNo}. Balance: ${options.outstandingLabel}.`;
      const result = await sendHubtelSms({
        to: phone,
        content: sms,
        tenantName: options.tenantName,
        recipientName: options.customerName,
      });
      if (result.ok) {
        sent = true;
      } else {
        console.error(
          "[product-sale-payment-notifications] fallback SMS failed:",
          result.error,
        );
      }
    }
  }

  return sent;
}

async function notifyBusinessOwnerPaymentReceived(options: {
  tenantId: string;
  tenantName: string;
  ownerName: string | null;
  email: string | null;
  phone: string | null;
  customerName: string;
  invoiceNo: string;
  amountReceivedLabel: string;
  outstandingLabel: string;
}): Promise<void> {
  const email = (options.email ?? "").trim();
  const phone = normalizeGhanaPhone(options.phone);
  if (!email && !phone) {
    console.warn(
      `[product-sale-payment-notifications] owner notify skipped for tenant ${options.tenantId}: no tenants.email/phone (Workspace Settings).`,
    );
    return;
  }

  const ownerName = options.ownerName?.trim() || "Business owner";
  const subject = `Payment received — ${options.customerName} — invoice ${options.invoiceNo}`;
  const lead = `${options.customerName} paid ${options.amountReceivedLabel} on invoice ${options.invoiceNo}. Remaining balance: ${options.outstandingLabel}.`;

  const text = [
    `Hi ${ownerName},`,
    "",
    lead,
    "",
    "The customer was also notified.",
  ].join("\n");

  const html = `<p>Hi ${escapeHtml(ownerName)},</p>
<p>${escapeHtml(lead)}</p>
<p>The customer was also notified.</p>`;

  if (email) {
    try {
      const result = await sendResendEmail({
        to: email,
        subject,
        html,
        text,
      });
      if (!result.ok) {
        console.error(
          "[product-sale-payment-notifications] owner email failed:",
          result.error,
        );
      }
    } catch (err) {
      console.error(
        "[product-sale-payment-notifications] owner email failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }

  if (phone) {
    try {
      const sms = `Davors: ${options.customerName} paid ${options.amountReceivedLabel} on invoice ${options.invoiceNo}. Balance: ${options.outstandingLabel}.`;
      const result = await sendHubtelSms({
        to: phone,
        content: sms,
        tenantName: options.tenantName,
        recipientName: ownerName,
      });
      if (!result.ok) {
        console.error(
          "[product-sale-payment-notifications] owner SMS failed:",
          result.error,
        );
      }
    } catch (err) {
      console.error(
        "[product-sale-payment-notifications] owner SMS failed:",
        err instanceof Error ? err.message : err,
      );
    }
  }
}

export type NotifyProductSalePaymentReceivedOptions = {
  tenantId: string;
  incomeId: string;
  clientId: string | null;
  customerNameFallback: string | null;
  invoiceNo: string;
  amountReceived: number;
  outstandingAfter: number;
  paymentReference?: string | null;
};

/**
 * Best-effort notifications after a manual product sale payment is recorded.
 * Customer leg mirrors due-date reminder resolution; owner gets workspace
 * email/SMS plus Admin/Director in-app bell.
 */
export async function notifyProductSalePaymentReceived(
  options: NotifyProductSalePaymentReceivedOptions,
): Promise<void> {
  const admin = createAdminClient();
  const tenantName = await resolveTenantDisplayName(admin, options.tenantId);
  const amountReceivedLabel = formatMoneyLabel(options.amountReceived);
  const outstandingLabel = formatOutstandingLabel(options.outstandingAfter);
  const invoiceNo =
    options.invoiceNo.trim() || options.incomeId.slice(0, 8);
  const paymentReference = (options.paymentReference ?? "").trim();

  const clientId = options.clientId?.trim() || null;
  let customerName =
    options.customerNameFallback?.trim() || clientId || "Customer";
  let customerEmail: string | null = null;
  let customerPhone: string | null = null;

  if (clientId) {
    const { data: customer, error: customerError } = await admin
      .from("customers")
      .select("client_id, client_name, email, phone")
      .eq("tenant_id", options.tenantId)
      .eq("client_id", clientId)
      .maybeSingle();

    if (customerError) {
      console.error(
        "[product-sale-payment-notifications] customer lookup failed:",
        customerError.message,
      );
    } else if (customer) {
      customerName =
        customer.client_name?.trim() ||
        options.customerNameFallback?.trim() ||
        clientId;
      customerEmail = customer.email;
      customerPhone = customer.phone;
    }
  }

  const variables: Record<string, string> = {
    customer_name: customerName,
    invoice_no: invoiceNo,
    amount: amountReceivedLabel,
    outstanding_balance: outstandingLabel,
    payment_reference: paymentReference,
  };

  if (clientId) {
    const useTransactional = await hasActivePaymentReceivedRule(
      admin,
      options.tenantId,
    );

    if (useTransactional) {
      await fireTransactionalNotification(
        options.tenantId,
        "payment_received",
        clientId,
        variables,
      );
    } else {
      await sendFallbackPaymentReceivedToCustomer({
        tenantId: options.tenantId,
        tenantName,
        customerName,
        email: customerEmail,
        phone: customerPhone,
        invoiceNo,
        amountReceivedLabel,
        outstandingLabel,
        paymentReference,
      });
    }
  } else {
    console.warn(
      `[product-sale-payment-notifications] customer notify skipped for income ${options.incomeId}: no client_id.`,
    );
  }

  const owner = await loadTenantOwnerContacts(admin, options.tenantId);
  await notifyBusinessOwnerPaymentReceived({
    tenantId: options.tenantId,
    tenantName,
    ownerName: owner.name,
    email: owner.email,
    phone: owner.phone,
    customerName,
    invoiceNo,
    amountReceivedLabel,
    outstandingLabel,
  });

  const adminBody = `${customerName} — ${amountReceivedLabel} received on invoice ${invoiceNo}. Remaining: ${outstandingLabel}.`;
  await notifyTenantAdminsAndDirectors(
    options.tenantId,
    "Payment received",
    adminBody,
    "/dashboard/crm/product-sales",
  );
}
