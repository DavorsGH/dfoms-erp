import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { LandlordType } from "@/app/dashboard/real-estate/landlords-utils";
import {
  formatRentMoney,
  formatRentPeriod,
} from "@/app/dashboard/real-estate/rent-ledger-utils";
import { formatDepositStatus } from "@/app/dashboard/real-estate/leases-utils";
import { createAdminClient } from "@/utils/supabase/admin";
import { fetchEscrowBalanceForLandlord } from "@/utils/payout-management";
import { sendHubtelSms } from "@/utils/hubtel-sms";
import { sendResendEmail, formatResendFrom, type ResendEmailAttachment } from "@/utils/resend-email";
import { normalizeGhanaPhone } from "@/utils/product-sale-paystack";
import { insertLandlordPortalNotification } from "@/utils/landlord-portal-notifications";
import { insertLesseePortalNotification } from "@/utils/lessee-portal-notifications";
import { notifyStaffRentPaymentReceived } from "@/utils/real-estate-staff-notifications";
import { renderRentPaymentReceiptPdfBuffer } from "@/utils/rent-payment-receipt-pdf-server";
import { renderSecurityDepositReceiptPdfBuffer } from "@/utils/security-deposit-receipt-pdf-server";
import { resolveLeaseEmailAttachment } from "@/utils/lease-pdf-server";
import { fetchLeaseDetail } from "@/utils/lease-management";
import { resolveTenantDisplayName } from "@/utils/tenant-display-name";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function resolveResendFromForTenant(
  admin: SupabaseClient,
  tenantId: string,
): Promise<string> {
  return formatResendFrom(await resolveTenantDisplayName(admin, tenantId));
}

async function loadRentReceiptAttachment(options: {
  admin: SupabaseClient;
  tenantId: string;
  entryId: string;
  lesseeId: string;
}): Promise<ResendEmailAttachment | null> {
  const rendered = await renderRentPaymentReceiptPdfBuffer({
    supabase: options.admin,
    tenantId: options.tenantId,
    entryId: options.entryId,
    lesseeId: options.lesseeId,
  });
  if (!rendered.ok) {
    console.error(
      "[real-estate-document-notifications] rent receipt PDF failed:",
      rendered.error,
    );
    return null;
  }
  return {
    filename: `rent-receipt-${rendered.receiptReference}.pdf`,
    content: rendered.buffer,
    contentType: "application/pdf",
  };
}

async function loadDepositReceiptAttachment(options: {
  admin: SupabaseClient;
  tenantId: string;
  depositId: string;
  kind: "collection" | "resolution";
  lesseeId?: string | null;
}): Promise<ResendEmailAttachment | null> {
  const rendered = await renderSecurityDepositReceiptPdfBuffer({
    supabase: options.admin,
    tenantId: options.tenantId,
    depositId: options.depositId,
    kind: options.kind,
    lesseeId: options.lesseeId,
  });
  if (!rendered.ok) {
    console.error(
      "[real-estate-document-notifications] deposit receipt PDF failed:",
      rendered.error,
    );
    return null;
  }
  return {
    filename: `deposit-${rendered.receiptReference}.pdf`,
    content: rendered.buffer,
    contentType: "application/pdf",
  };
}

/**
 * Tenant receipt + landlord notice for a confirmed rent ledger payment (Paystack or manual).
 */
export async function notifyRentPaymentSuccess(options: {
  tenantId: string;
  landlordType: LandlordType;
  amountGhs: number;
  periodStart: string;
  periodEnd: string;
  paymentMethod: string;
  escrowBalanceAfterGhs?: number | null;
  lesseeId: string;
  primaryEntryId: string;
  paymentReference?: string | null;
  notifyStaff?: boolean;
}): Promise<void> {
  const admin = createAdminClient();
  const periodLabel = formatRentPeriod(options.periodStart, options.periodEnd);
  const amountLabel = formatRentMoney(options.amountGhs);

  let escrowBalanceAfterGhs = options.escrowBalanceAfterGhs ?? null;
  if (
    escrowBalanceAfterGhs == null &&
    options.landlordType === "davors_managed"
  ) {
    try {
      const { balanceGhs } = await fetchEscrowBalanceForLandlord(
        admin,
        options.tenantId,
      );
      escrowBalanceAfterGhs = balanceGhs;
    } catch {
      escrowBalanceAfterGhs = null;
    }
  }

  const [{ data: lessee }, { data: landlordTenant }] = await Promise.all([
    admin
      .from("lessees")
      .select("full_name, email, phone")
      .eq("tenant_id", options.tenantId)
      .eq("lessee_id", options.lesseeId)
      .maybeSingle(),
    admin
      .from("tenants")
      .select("name, email, phone")
      .eq("id", options.tenantId)
      .maybeSingle(),
  ]);

  const lesseeName = lessee?.full_name?.trim() || "Tenant";
  const landlordName = landlordTenant?.name?.trim() || "Landlord";
  const from = await resolveResendFromForTenant(admin, options.tenantId);

  const receiptAttachment = await loadRentReceiptAttachment({
    admin,
    tenantId: options.tenantId,
    entryId: options.primaryEntryId,
    lesseeId: options.lesseeId,
  });

  const tenantSubject = `Rent payment receipt — ${periodLabel}`;
  const tenantText = [
    `Hi ${lesseeName},`,
    "",
    `We received your rent payment of ${amountLabel}.`,
    `Period: ${periodLabel}`,
    `Method: ${options.paymentMethod}`,
    "",
    receiptAttachment
      ? "Your receipt is attached to this email."
      : "Sign in to the tenant portal to view your receipt.",
    "",
    "Thank you.",
    "Davors Facilities",
  ].join("\n");
  const tenantHtml = `<p>Hi ${escapeHtml(lesseeName)},</p>
<p>We received your rent payment of <strong>${escapeHtml(amountLabel)}</strong>.</p>
<p>Period: ${escapeHtml(periodLabel)}<br/>Method: ${escapeHtml(options.paymentMethod)}</p>
<p>${receiptAttachment ? "Your receipt is attached to this email." : "Sign in to the tenant portal to view your receipt."}</p>
<p>Thank you.<br/>Davors Facilities</p>`;

  const lesseeEmail = asString(lessee?.email);
  if (lesseeEmail) {
    const emailResult = await sendResendEmail({
      to: lesseeEmail,
      subject: tenantSubject,
      html: tenantHtml,
      text: tenantText,
      from,
      attachments: receiptAttachment ? [receiptAttachment] : undefined,
    });
    if (!emailResult.ok) {
      console.error(
        "[real-estate-document-notifications] tenant receipt email failed:",
        emailResult.error,
      );
    }
  }

  const lesseePhone = normalizeGhanaPhone(lessee?.phone);
  if (lesseePhone) {
    const smsResult = await sendHubtelSms({
      to: lesseePhone,
      content: `${landlordName}: Rent payment of ${amountLabel} received for ${periodLabel} via ${options.paymentMethod}. Thank you.`,
      tenantName: landlordName,
      recipientName: lesseeName,
    });
    if (!smsResult.ok) {
      console.error(
        "[real-estate-document-notifications] tenant receipt SMS failed:",
        smsResult.error,
      );
    }
  }

  const tenantInAppBody = [
    `We received your rent payment of ${amountLabel}.`,
    `Period: ${periodLabel}`,
    `Method: ${options.paymentMethod}`,
  ].join("\n");
  await insertLesseePortalNotification({
    landlordTenantId: options.tenantId,
    lesseeId: options.lesseeId,
    title: "Rent payment receipt",
    body: tenantInAppBody,
    actionUrl: `/portal/payments/${options.primaryEntryId}`,
    context: `rent-receipt-tenant:${options.lesseeId}:${periodLabel}`,
  });

  const escrowLine =
    options.landlordType === "davors_managed" && escrowBalanceAfterGhs != null
      ? `Updated escrow balance: ${formatRentMoney(escrowBalanceAfterGhs)}.`
      : null;

  const landlordSubject = `Rent received — ${lesseeName}`;
  const landlordText = [
    `Hi ${landlordName},`,
    "",
    `Rent of ${amountLabel} was received from ${lesseeName}.`,
    `Period: ${periodLabel}`,
    `Method: ${options.paymentMethod}`,
    escrowLine,
    "",
    receiptAttachment ? "The payment receipt is attached." : "",
    "",
    "Davors Facilities",
  ]
    .filter(Boolean)
    .join("\n");
  const landlordHtml = `<p>Hi ${escapeHtml(landlordName)},</p>
<p>Rent of <strong>${escapeHtml(amountLabel)}</strong> was received from ${escapeHtml(lesseeName)}.</p>
<p>Period: ${escapeHtml(periodLabel)}<br/>Method: ${escapeHtml(options.paymentMethod)}${
    escrowLine ? `<br/>${escapeHtml(escrowLine)}` : ""
  }</p>
${receiptAttachment ? "<p>The payment receipt is attached.</p>" : ""}
<p>Davors Facilities</p>`;

  const landlordEmail = asString(landlordTenant?.email);
  if (landlordEmail) {
    const emailResult = await sendResendEmail({
      to: landlordEmail,
      subject: landlordSubject,
      html: landlordHtml,
      text: landlordText,
      from,
      attachments: receiptAttachment ? [receiptAttachment] : undefined,
    });
    if (!emailResult.ok) {
      console.error(
        "[real-estate-document-notifications] landlord notice email failed:",
        emailResult.error,
      );
    }
  }

  const landlordPhone = normalizeGhanaPhone(landlordTenant?.phone);
  if (landlordPhone) {
    const smsParts = [
      `${landlordName}: Rent ${amountLabel} received from ${lesseeName} (${periodLabel}) via ${options.paymentMethod}.`,
    ];
    if (escrowLine) {
      smsParts.push(escrowLine);
    }
    const smsResult = await sendHubtelSms({
      to: landlordPhone,
      content: smsParts.join(" "),
      tenantName: landlordName,
      recipientName: landlordName,
    });
    if (!smsResult.ok) {
      console.error(
        "[real-estate-document-notifications] landlord notice SMS failed:",
        smsResult.error,
      );
    }
  }

  const landlordInAppBody = [
    `Rent of ${amountLabel} was received from ${lesseeName}.`,
    `Period: ${periodLabel}`,
    `Method: ${options.paymentMethod}`,
    escrowLine,
  ]
    .filter(Boolean)
    .join("\n");
  await insertLandlordPortalNotification({
    landlordTenantId: options.tenantId,
    title: "Rent payment received",
    body: landlordInAppBody,
    actionUrl: "/landlord-portal/finance/rent-ledger",
    context: `rent-receipt-landlord:${options.lesseeId}:${periodLabel}`,
  });

  if (options.notifyStaff !== false) {
    try {
      const { data: entry } = await admin
        .from("rent_ledger")
        .select("lease_id")
        .eq("tenant_id", options.tenantId)
        .eq("entry_id", options.primaryEntryId)
        .maybeSingle();

      await notifyStaffRentPaymentReceived({
        landlordTenantId: options.tenantId,
        leaseId: entry?.lease_id ?? "",
        entryId: options.primaryEntryId,
        amountGhs: options.amountGhs,
        periodStart: options.periodStart,
        periodEnd: options.periodEnd,
        paymentMethod: options.paymentMethod,
        reference: options.paymentReference?.trim() || options.primaryEntryId,
      });
    } catch (error) {
      console.error(
        "[real-estate-document-notifications] staff notification failed:",
        error instanceof Error ? error.message : error,
      );
    }
  }
}

export async function notifySecurityDepositCollected(options: {
  tenantId: string;
  depositId: string;
  leaseId: string;
}): Promise<void> {
  const admin = createAdminClient();
  const { detail } = await fetchLeaseDetail(
    admin,
    options.tenantId,
    options.leaseId,
  );
  if (!detail) {
    return;
  }

  const attachment = await loadDepositReceiptAttachment({
    admin,
    tenantId: options.tenantId,
    depositId: options.depositId,
    kind: "collection",
    lesseeId: detail.lesseeId,
  });

  const amountLabel = formatRentMoney(detail.deposit?.amountGhs ?? 0);
  const unitLabel = `${detail.propertyName} · ${detail.unitNumber}`;
  const from = await resolveResendFromForTenant(admin, options.tenantId);

  const tenantSubject = `Security deposit receipt — ${unitLabel}`;
  const tenantText = [
    `Hi ${detail.lesseeName},`,
    "",
    `We recorded your security deposit of ${amountLabel} for ${unitLabel}.`,
    attachment
      ? "Your deposit collection receipt is attached."
      : "Sign in to the tenant portal to view your receipt.",
    "",
    "Davors Facilities",
  ].join("\n");
  const tenantHtml = `<p>Hi ${escapeHtml(detail.lesseeName)},</p>
<p>We recorded your security deposit of <strong>${escapeHtml(amountLabel)}</strong> for ${escapeHtml(unitLabel)}.</p>
<p>${attachment ? "Your deposit collection receipt is attached." : "Sign in to the tenant portal to view your receipt."}</p>
<p>Davors Facilities</p>`;

  if (detail.lesseeEmail) {
    const emailResult = await sendResendEmail({
      to: detail.lesseeEmail,
      subject: tenantSubject,
      html: tenantHtml,
      text: tenantText,
      from,
      attachments: attachment ? [attachment] : undefined,
    });
    if (!emailResult.ok) {
      console.error(
        "[real-estate-document-notifications] deposit collection tenant email failed:",
        emailResult.error,
      );
    }
  }

  await insertLesseePortalNotification({
    landlordTenantId: options.tenantId,
    lesseeId: detail.lesseeId,
    title: "Security deposit collected",
    body: `Security deposit of ${amountLabel} recorded for ${unitLabel}.`,
    actionUrl: `/portal/deposits/${options.depositId}`,
    context: `deposit-collected:${options.depositId}`,
  });

  const { data: landlordTenant } = await admin
    .from("tenants")
    .select("name, email")
    .eq("id", options.tenantId)
    .maybeSingle();

  const landlordEmail = asString(landlordTenant?.email);
  if (landlordEmail) {
    const landlordName = landlordTenant?.name?.trim() || "Landlord";
    const landlordSubject = `Security deposit collected — ${detail.lesseeName}`;
    const landlordText = [
      `Hi ${landlordName},`,
      "",
      `A security deposit of ${amountLabel} was collected from ${detail.lesseeName} for ${unitLabel}.`,
      attachment ? "The collection receipt is attached." : "",
      "",
      "Davors Facilities",
    ]
      .filter(Boolean)
      .join("\n");
    const landlordHtml = `<p>Hi ${escapeHtml(landlordName)},</p>
<p>A security deposit of <strong>${escapeHtml(amountLabel)}</strong> was collected from ${escapeHtml(detail.lesseeName)} for ${escapeHtml(unitLabel)}.</p>
${attachment ? "<p>The collection receipt is attached.</p>" : ""}
<p>Davors Facilities</p>`;

    const emailResult = await sendResendEmail({
      to: landlordEmail,
      subject: landlordSubject,
      html: landlordHtml,
      text: landlordText,
      from,
      attachments: attachment ? [attachment] : undefined,
    });
    if (!emailResult.ok) {
      console.error(
        "[real-estate-document-notifications] deposit collection landlord email failed:",
        emailResult.error,
      );
    }
  }

  await insertLandlordPortalNotification({
    landlordTenantId: options.tenantId,
    title: "Security deposit collected",
    body: `Deposit of ${amountLabel} collected from ${detail.lesseeName} (${unitLabel}).`,
    actionUrl: `/landlord-portal/finance/deposits/${options.depositId}`,
    context: `deposit-collected-landlord:${options.depositId}`,
  });
}

export async function notifySecurityDepositResolved(options: {
  tenantId: string;
  depositId: string;
  leaseId: string;
  status: string;
}): Promise<void> {
  const admin = createAdminClient();
  const { detail } = await fetchLeaseDetail(
    admin,
    options.tenantId,
    options.leaseId,
  );
  if (!detail) {
    return;
  }

  const attachment = await loadDepositReceiptAttachment({
    admin,
    tenantId: options.tenantId,
    depositId: options.depositId,
    kind: "resolution",
    lesseeId: detail.lesseeId,
  });

  const statusLabel = formatDepositStatus(
    options.status as "returned" | "forfeited" | "partially_forfeited",
  );
  const unitLabel = `${detail.propertyName} · ${detail.unitNumber}`;
  const returnedLabel =
    detail.deposit?.amountReturnedGhs != null
      ? formatRentMoney(detail.deposit.amountReturnedGhs)
      : "—";
  const from = await resolveResendFromForTenant(admin, options.tenantId);

  const tenantSubject = `Security deposit resolution — ${unitLabel}`;
  const tenantText = [
    `Hi ${detail.lesseeName},`,
    "",
    `Your security deposit for ${unitLabel} has been resolved as: ${statusLabel}.`,
    `Amount returned: ${returnedLabel}.`,
    attachment
      ? "The resolution receipt is attached."
      : "Sign in to the tenant portal for details.",
    "",
    "Davors Facilities",
  ].join("\n");
  const tenantHtml = `<p>Hi ${escapeHtml(detail.lesseeName)},</p>
<p>Your security deposit for ${escapeHtml(unitLabel)} has been resolved as: <strong>${escapeHtml(statusLabel)}</strong>.</p>
<p>Amount returned: ${escapeHtml(returnedLabel)}.</p>
<p>${attachment ? "The resolution receipt is attached." : "Sign in to the tenant portal for details."}</p>
<p>Davors Facilities</p>`;

  if (detail.lesseeEmail) {
    const emailResult = await sendResendEmail({
      to: detail.lesseeEmail,
      subject: tenantSubject,
      html: tenantHtml,
      text: tenantText,
      from,
      attachments: attachment ? [attachment] : undefined,
    });
    if (!emailResult.ok) {
      console.error(
        "[real-estate-document-notifications] deposit resolution tenant email failed:",
        emailResult.error,
      );
    }
  }

  await insertLesseePortalNotification({
    landlordTenantId: options.tenantId,
    lesseeId: detail.lesseeId,
    title: "Security deposit resolved",
    body: `Deposit resolved (${statusLabel}). Amount returned: ${returnedLabel}.`,
    actionUrl: `/portal/deposits/${options.depositId}`,
    context: `deposit-resolved:${options.depositId}`,
  });

  const { data: landlordTenant } = await admin
    .from("tenants")
    .select("name, email")
    .eq("id", options.tenantId)
    .maybeSingle();

  const landlordEmail = asString(landlordTenant?.email);
  if (landlordEmail) {
    const landlordName = landlordTenant?.name?.trim() || "Landlord";
    const landlordSubject = `Security deposit resolved — ${detail.lesseeName}`;
    const landlordText = [
      `Hi ${landlordName},`,
      "",
      `The security deposit for ${detail.lesseeName} (${unitLabel}) was resolved as ${statusLabel}.`,
      `Amount returned: ${returnedLabel}.`,
      attachment ? "The resolution receipt is attached." : "",
      "",
      "Davors Facilities",
    ]
      .filter(Boolean)
      .join("\n");

    const emailResult = await sendResendEmail({
      to: landlordEmail,
      subject: landlordSubject,
      html: `<p>Hi ${escapeHtml(landlordName)},</p>
<p>The security deposit for ${escapeHtml(detail.lesseeName)} (${escapeHtml(unitLabel)}) was resolved as <strong>${escapeHtml(statusLabel)}</strong>.</p>
<p>Amount returned: ${escapeHtml(returnedLabel)}.</p>
${attachment ? "<p>The resolution receipt is attached.</p>" : ""}
<p>Davors Facilities</p>`,
      text: landlordText,
      from,
      attachments: attachment ? [attachment] : undefined,
    });
    if (!emailResult.ok) {
      console.error(
        "[real-estate-document-notifications] deposit resolution landlord email failed:",
        emailResult.error,
      );
    }
  }

  await insertLandlordPortalNotification({
    landlordTenantId: options.tenantId,
    title: "Security deposit resolved",
    body: `Deposit for ${detail.lesseeName} resolved (${statusLabel}).`,
    actionUrl: `/landlord-portal/finance/deposits/${options.depositId}`,
    context: `deposit-resolved-landlord:${options.depositId}`,
  });
}

async function sendLeaseDocumentEmails(options: {
  tenantId: string;
  leaseId: string;
  tenantSubject: string;
  tenantIntro: string;
  landlordSubject: string;
  landlordIntro: string;
  lesseePortalTitle: string;
  lesseePortalBody: string;
  landlordPortalTitle: string;
  landlordPortalBody: string;
  contextSuffix: string;
}): Promise<void> {
  const admin = createAdminClient();
  const { detail } = await fetchLeaseDetail(
    admin,
    options.tenantId,
    options.leaseId,
  );
  if (!detail) {
    return;
  }

  const attachment = await resolveLeaseEmailAttachment({
    supabase: admin,
    tenantId: options.tenantId,
    leaseId: options.leaseId,
  });

  const unitLabel = `${detail.propertyName} · ${detail.unitNumber}`;
  const attachmentNote = attachment
    ? "The tenancy agreement is attached to this email."
    : "Sign in to your portal to review the tenancy agreement.";
  const from = await resolveResendFromForTenant(admin, options.tenantId);

  if (detail.lesseeEmail) {
    const tenantText = [
      `Hi ${detail.lesseeName},`,
      "",
      options.tenantIntro,
      `Property: ${unitLabel}`,
      "",
      attachmentNote,
      "",
      "Davors Facilities",
    ].join("\n");

    const emailResult = await sendResendEmail({
      to: detail.lesseeEmail,
      subject: options.tenantSubject,
      html: `<p>Hi ${escapeHtml(detail.lesseeName)},</p>
<p>${escapeHtml(options.tenantIntro)}</p>
<p>Property: ${escapeHtml(unitLabel)}</p>
<p>${escapeHtml(attachmentNote)}</p>
<p>Davors Facilities</p>`,
      text: tenantText,
      from,
      attachments: attachment ? [attachment] : undefined,
    });
    if (!emailResult.ok) {
      console.error(
        "[real-estate-document-notifications] lease tenant email failed:",
        emailResult.error,
      );
    }
  }

  await insertLesseePortalNotification({
    landlordTenantId: options.tenantId,
    lesseeId: detail.lesseeId,
    title: options.lesseePortalTitle,
    body: options.lesseePortalBody,
    actionUrl: "/portal/dashboard",
    context: `lease-tenant:${options.leaseId}:${options.contextSuffix}`,
  });

  const { data: landlordTenant } = await admin
    .from("tenants")
    .select("name, email")
    .eq("id", options.tenantId)
    .maybeSingle();

  const landlordEmail = asString(landlordTenant?.email);
  if (landlordEmail) {
    const landlordName = landlordTenant?.name?.trim() || "Landlord";
    const landlordText = [
      `Hi ${landlordName},`,
      "",
      options.landlordIntro,
      `Tenant: ${detail.lesseeName}`,
      `Property: ${unitLabel}`,
      "",
      attachmentNote,
      "",
      "Davors Facilities",
    ].join("\n");

    const emailResult = await sendResendEmail({
      to: landlordEmail,
      subject: options.landlordSubject,
      html: `<p>Hi ${escapeHtml(landlordName)},</p>
<p>${escapeHtml(options.landlordIntro)}</p>
<p>Tenant: ${escapeHtml(detail.lesseeName)}<br/>Property: ${escapeHtml(unitLabel)}</p>
<p>${escapeHtml(attachmentNote)}</p>
<p>Davors Facilities</p>`,
      text: landlordText,
      from,
      attachments: attachment ? [attachment] : undefined,
    });
    if (!emailResult.ok) {
      console.error(
        "[real-estate-document-notifications] lease landlord email failed:",
        emailResult.error,
      );
    }
  }

  await insertLandlordPortalNotification({
    landlordTenantId: options.tenantId,
    title: options.landlordPortalTitle,
    body: options.landlordPortalBody,
    actionUrl: `/landlord-portal/real-estate/leases/${options.leaseId}`,
    context: `lease-landlord:${options.leaseId}:${options.contextSuffix}`,
  });
}

export async function notifyLeaseSent(options: {
  tenantId: string;
  leaseId: string;
}): Promise<void> {
  await sendLeaseDocumentEmails({
    tenantId: options.tenantId,
    leaseId: options.leaseId,
    tenantSubject: "Tenancy agreement for your review",
    tenantIntro:
      "Your tenancy agreement has been sent for review and acknowledgment.",
    landlordSubject: "Tenancy agreement sent to tenant",
    landlordIntro:
      "The tenancy agreement has been marked as sent for tenant acknowledgment.",
    lesseePortalTitle: "Tenancy agreement sent",
    lesseePortalBody: "Please review and acknowledge your tenancy agreement.",
    landlordPortalTitle: "Tenancy agreement sent",
    landlordPortalBody: "The lease was sent to the tenant for acknowledgment.",
    contextSuffix: "sent",
  });
}

export async function notifyLeaseFullySigned(options: {
  tenantId: string;
  leaseId: string;
}): Promise<void> {
  await sendLeaseDocumentEmails({
    tenantId: options.tenantId,
    leaseId: options.leaseId,
    tenantSubject: "Tenancy agreement fully acknowledged",
    tenantIntro:
      "All parties have acknowledged the tenancy agreement. A copy is attached for your records.",
    landlordSubject: "Tenancy agreement fully acknowledged",
    landlordIntro:
      "The tenancy agreement has been fully acknowledged by all parties.",
    lesseePortalTitle: "Tenancy agreement acknowledged",
    lesseePortalBody:
      "Your tenancy agreement has been fully acknowledged by all parties.",
    landlordPortalTitle: "Tenancy agreement acknowledged",
    landlordPortalBody:
      "The tenancy agreement is fully acknowledged by landlord and tenant.",
    contextSuffix: "signed",
  });
}

/** Best-effort wrapper — never throws. */
export function voidNotifyRentPaymentSuccess(
  options: Parameters<typeof notifyRentPaymentSuccess>[0],
): void {
  void notifyRentPaymentSuccess(options).catch((error) => {
    console.error(
      "[real-estate-document-notifications] rent payment notify failed:",
      error instanceof Error ? error.message : error,
    );
  });
}

export function voidNotifySecurityDepositCollected(
  options: Parameters<typeof notifySecurityDepositCollected>[0],
): void {
  void notifySecurityDepositCollected(options).catch((error) => {
    console.error(
      "[real-estate-document-notifications] deposit collected notify failed:",
      error instanceof Error ? error.message : error,
    );
  });
}

export function voidNotifySecurityDepositResolved(
  options: Parameters<typeof notifySecurityDepositResolved>[0],
): void {
  void notifySecurityDepositResolved(options).catch((error) => {
    console.error(
      "[real-estate-document-notifications] deposit resolved notify failed:",
      error instanceof Error ? error.message : error,
    );
  });
}

export function voidNotifyLeaseSent(
  options: Parameters<typeof notifyLeaseSent>[0],
): void {
  void notifyLeaseSent(options).catch((error) => {
    console.error(
      "[real-estate-document-notifications] lease sent notify failed:",
      error instanceof Error ? error.message : error,
    );
  });
}

export function voidNotifyLeaseFullySigned(
  options: Parameters<typeof notifyLeaseFullySigned>[0],
): void {
  void notifyLeaseFullySigned(options).catch((error) => {
    console.error(
      "[real-estate-document-notifications] lease signed notify failed:",
      error instanceof Error ? error.message : error,
    );
  });
}
