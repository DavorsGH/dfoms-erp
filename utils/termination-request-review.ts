import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { terminateLeaseEarly } from "@/utils/lease-management";
import { sendResendEmail } from "@/utils/resend-email";
import { formatLeaseDate } from "@/app/dashboard/real-estate/leases-utils";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function notifyTenantTerminationDecision(options: {
  email: string | null | undefined;
  fullName: string;
  approved: boolean;
  reason: string | null;
}): Promise<void> {
  const to = options.email?.trim();
  if (!to) {
    return;
  }

  const name = options.fullName.trim() || "Tenant";
  if (options.approved) {
    const subject = "Early lease termination approved";
    const text = [
      `Hi ${name},`,
      "",
      "Your request to end your lease early has been approved.",
      options.reason ? `Reason on file: ${options.reason}` : null,
      "",
      "Your lease is now terminated. Contact your property manager about your security deposit.",
      "",
      "Davors Facilities",
    ]
      .filter(Boolean)
      .join("\n");
    const result = await sendResendEmail({
      to,
      subject,
      text,
      html: `<p>Hi ${escapeHtml(name)},</p>
<p>Your request to end your lease early has been <strong>approved</strong>.</p>
${options.reason ? `<p>Reason on file: ${escapeHtml(options.reason)}</p>` : ""}
<p>Your lease is now terminated. Contact your property manager about your security deposit.</p>
<p>Davors Facilities</p>`,
    });
    if (!result.ok) {
      console.error(
        "[termination-request] approve email failed:",
        result.error,
      );
    }
    return;
  }

  const subject = "Early lease termination request declined";
  const text = [
    `Hi ${name},`,
    "",
    "Your request to end your lease early was not approved. Your lease continues as normal.",
    "",
    "Davors Facilities",
  ].join("\n");
  const result = await sendResendEmail({
    to,
    subject,
    text,
    html: `<p>Hi ${escapeHtml(name)},</p>
<p>Your request to end your lease early was <strong>not approved</strong>. Your lease continues as normal.</p>
<p>Davors Facilities</p>`,
  });
  if (!result.ok) {
    console.error("[termination-request] reject email failed:", result.error);
  }
}

export type ReviewTerminationRequestResult =
  | { ok: true; action: "approve" | "reject"; depositId?: string | null }
  | { ok: false; error: string; status: number };

/**
 * Staff / landlord-portal approve/reject of a tenant early-termination request.
 * Approve calls terminateLeaseEarly (same effect as Terminate Lease Early).
 */
export async function reviewTerminationRequest(
  admin: SupabaseClient,
  options: {
    tenantId: string;
    leaseId: string;
    action: "approve" | "reject";
  },
): Promise<ReviewTerminationRequestResult> {
  const leaseId = options.leaseId.trim();
  if (!leaseId) {
    return { ok: false, error: "lease_id is required", status: 400 };
  }
  if (options.action !== "approve" && options.action !== "reject") {
    return {
      ok: false,
      error: "action must be approve or reject.",
      status: 400,
    };
  }

  const { data: lease, error: leaseError } = await admin
    .from("leases")
    .select(
      "lease_id, lessee_id, status, pending_termination_reason, termination_request_status, end_date",
    )
    .eq("tenant_id", options.tenantId)
    .eq("lease_id", leaseId)
    .maybeSingle();

  if (leaseError) {
    return { ok: false, error: leaseError.message, status: 400 };
  }
  if (!lease) {
    return { ok: false, error: "Lease not found.", status: 404 };
  }
  if (lease.termination_request_status !== "pending_staff_approval") {
    return {
      ok: false,
      error: "No pending termination request to review.",
      status: 400,
    };
  }

  const { data: lessee } = await admin
    .from("lessees")
    .select("full_name, email")
    .eq("tenant_id", options.tenantId)
    .eq("lessee_id", lease.lessee_id)
    .maybeSingle();

  const pendingReason =
    (lease.pending_termination_reason as string | null)?.trim() || null;

  if (options.action === "reject") {
    const now = new Date().toISOString();
    const { error } = await admin
      .from("leases")
      .update({
        pending_termination_reason: null,
        termination_request_status: "rejected",
        updated_at: now,
      })
      .eq("tenant_id", options.tenantId)
      .eq("lease_id", leaseId);

    if (error) {
      return { ok: false, error: error.message, status: 400 };
    }

    await notifyTenantTerminationDecision({
      email: lessee?.email,
      fullName: lessee?.full_name ?? "Tenant",
      approved: false,
      reason: pendingReason,
    });

    return { ok: true, action: "reject" };
  }

  if (lease.status !== "active") {
    return {
      ok: false,
      error: "Only active leases can be terminated early.",
      status: 400,
    };
  }

  const terminationReason =
    pendingReason ||
    `Tenant-requested early termination approved (lease end was ${formatLeaseDate(lease.end_date)}).`;

  try {
    const result = await terminateLeaseEarly(admin, {
      tenantId: options.tenantId,
      leaseId,
      terminationReason,
      markRequestApproved: true,
    });

    await notifyTenantTerminationDecision({
      email: lessee?.email,
      fullName: lessee?.full_name ?? "Tenant",
      approved: true,
      reason: pendingReason,
    });

    return {
      ok: true,
      action: "approve",
      depositId: result.depositId,
    };
  } catch (error) {
    return {
      ok: false,
      error:
        error instanceof Error
          ? error.message
          : "Unable to approve termination request.",
      status: 400,
    };
  }
}
