import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { insertLesseePortalNotification } from "@/utils/lessee-portal-notifications";
import { sendResendEmail } from "@/utils/resend-email";
import {
  isRentLedgerStatus,
  resolveRentStatusAfterPayment,
  rentOutstandingGhs,
  type RentLedgerStatus,
} from "@/app/dashboard/real-estate/rent-ledger-utils";
import { roundPayoutMoney } from "@/app/dashboard/real-estate/payouts-utils";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function notifyMaintenanceLandlordDecision(options: {
  email: string | null | undefined;
  fullName: string;
  approved: boolean;
  selfFix: boolean;
  amountGhs: number | null;
  description: string;
  /** When set, also insert lessee portal in-app (if auth_user_id). */
  landlordTenantId?: string | null;
  lesseeId?: string | null;
  requestId?: string | null;
}): Promise<void> {
  const name = options.fullName.trim() || "Tenant";
  const amountLabel =
    options.amountGhs != null
      ? `GHS ${options.amountGhs.toLocaleString("en-GH", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })}`
      : null;

  const sendInApp = async (
    title: string,
    body: string,
  ): Promise<void> => {
    const tenantId = options.landlordTenantId?.trim();
    const lesseeId = options.lesseeId?.trim();
    if (!tenantId || !lesseeId) return;
    await insertLesseePortalNotification({
      landlordTenantId: tenantId,
      lesseeId,
      title,
      body,
      actionUrl: "/portal/repairs",
      context: `maintenance-decision:${options.requestId ?? lesseeId}`,
    });
  };

  if (options.approved) {
    const subject = options.selfFix
      ? "Self-fix repair approved"
      : "Maintenance request approved";
    const creditLine =
      options.selfFix && amountLabel
        ? `Approved self-fix cost ${amountLabel} will be credited against your next rent payment.`
        : null;
    const bodyLines = [
      "Your maintenance / repair request has been approved.",
      `Request: ${options.description}`,
      creditLine,
    ].filter(Boolean) as string[];
    const text = [
      `Hi ${name},`,
      "",
      ...bodyLines,
      "",
      "Davors Facilities",
    ].join("\n");
    const to = options.email?.trim();
    if (to) {
      const result = await sendResendEmail({
        to,
        subject,
        text,
        html: `<p>Hi ${escapeHtml(name)},</p>
<p>Your maintenance / repair request has been <strong>approved</strong>.</p>
<p>Request: ${escapeHtml(options.description)}</p>
${creditLine ? `<p>${escapeHtml(creditLine)}</p>` : ""}
<p>Davors Facilities</p>`,
      });
      if (!result.ok) {
        console.error("[maintenance] approve email failed:", result.error);
      }
    }
    await sendInApp(subject, bodyLines.join("\n"));
    return;
  }

  const subject = "Maintenance request declined";
  const bodyLines = [
    "Your maintenance / repair request was not approved.",
    `Request: ${options.description}`,
  ];
  const text = [
    `Hi ${name},`,
    "",
    ...bodyLines,
    "",
    "Davors Facilities",
  ].join("\n");
  const to = options.email?.trim();
  if (to) {
    const result = await sendResendEmail({
      to,
      subject,
      text,
      html: `<p>Hi ${escapeHtml(name)},</p>
<p>Your maintenance / repair request was <strong>not approved</strong>.</p>
<p>Request: ${escapeHtml(options.description)}</p>
<p>Davors Facilities</p>`,
    });
    if (!result.ok) {
      console.error("[maintenance] reject email failed:", result.error);
    }
  }
  await sendInApp(subject, bodyLines.join("\n"));
}

/**
 * Apply approved self-fix cost as credit_ghs on the next unpaid rent_ledger
 * row for the lease (lowest period_start with outstanding > 0).
 */
export async function applySelfFixRentCredit(
  admin: SupabaseClient,
  options: {
    tenantId: string;
    leaseId: string;
    requestId: string;
    amountGhs: number;
  },
): Promise<{ entryId: string; creditGhs: number; status: RentLedgerStatus }> {
  const amount = roundPayoutMoney(options.amountGhs);
  if (amount <= 0) {
    throw new Error("Self-fix credit amount must be greater than zero.");
  }

  // Self-fix credit stays rent-only — never apply to one_time charges.
  const { data: entries, error } = await admin
    .from("rent_ledger")
    .select(
      "entry_id, amount_due_ghs, amount_paid_ghs, credit_ghs, status, notes, period_start",
    )
    .eq("tenant_id", options.tenantId)
    .eq("lease_id", options.leaseId)
    .eq("charge_type", "rent")
    .neq("status", "paid")
    .order("period_start", { ascending: true })
    .limit(24);

  if (error) {
    throw new Error(error.message);
  }

  const candidates = (entries as Array<{
    entry_id: string;
    amount_due_ghs: number | string;
    amount_paid_ghs: number | string;
    credit_ghs: number | string | null;
    status: string;
    notes: string | null;
    period_start: string;
  }> | null) ?? [];

  let target = candidates.find((row) => {
    if (!isRentLedgerStatus(row.status)) {
      return false;
    }
    const outstanding = rentOutstandingGhs(
      Number(row.amount_due_ghs) || 0,
      Number(row.amount_paid_ghs) || 0,
      Number(row.credit_ghs) || 0,
    );
    return outstanding > 0;
  });

  // Fallback: most recent unpaid row even if outstanding already 0 after prior credits
  if (!target && candidates[0] && isRentLedgerStatus(candidates[0].status)) {
    target = candidates[0];
  }

  if (!target) {
    throw new Error(
      "No unpaid rent ledger period found to apply the self-fix credit. Generate rent for this lease first.",
    );
  }

  const amountDue = roundPayoutMoney(Number(target.amount_due_ghs) || 0);
  const amountPaid = roundPayoutMoney(Number(target.amount_paid_ghs) || 0);
  const existingCredit = roundPayoutMoney(Number(target.credit_ghs) || 0);
  const nextCredit = roundPayoutMoney(existingCredit + amount);
  const nextStatus = resolveRentStatusAfterPayment(
    amountDue,
    amountPaid,
    target.status as RentLedgerStatus,
    nextCredit,
  );
  const nowIso = new Date().toISOString();
  const creditNote = `Self-fix maintenance credit ${amount.toFixed(2)} (request ${options.requestId}).`;
  const nextNotes = [target.notes?.trim() || "", creditNote]
    .filter(Boolean)
    .join("\n");

  const { error: updateError } = await admin
    .from("rent_ledger")
    .update({
      credit_ghs: nextCredit,
      status: nextStatus,
      notes: nextNotes || null,
      updated_at: nowIso,
    })
    .eq("tenant_id", options.tenantId)
    .eq("entry_id", target.entry_id);

  if (updateError) {
    throw new Error(updateError.message);
  }

  return {
    entryId: target.entry_id,
    creditGhs: nextCredit,
    status: nextStatus,
  };
}
