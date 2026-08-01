import { NextResponse } from "next/server";
import { requireDavorsPlatformSuperAdmin } from "@/utils/admin-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { assertRealEstateLandlordTenant } from "@/utils/property-management";
import { terminateLeaseEarly } from "@/utils/lease-management";
import { sendResendEmail } from "@/utils/resend-email";
import { formatLeaseDate } from "@/app/dashboard/real-estate/leases-utils";

type TerminationRequestBody = {
  tenant_id?: string;
  lease_id?: string;
  action?: "approve" | "reject";
};

async function notifyTenantTerminationDecision(options: {
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

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Staff approve/reject of a tenant-submitted early termination request.
 * Approve calls terminateLeaseEarly (same effect as Terminate Lease Early).
 */
export async function POST(request: Request) {
  const auth = await requireDavorsPlatformSuperAdmin();
  if (!auth.ok) {
    return auth.response;
  }

  let body: TerminationRequestBody;
  try {
    body = (await request.json()) as TerminationRequestBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const leaseId = body.lease_id?.trim() ?? "";
  const action = body.action;
  if (!leaseId) {
    return NextResponse.json({ error: "lease_id is required" }, { status: 400 });
  }
  if (action !== "approve" && action !== "reject") {
    return NextResponse.json(
      { error: "action must be approve or reject." },
      { status: 400 },
    );
  }

  const admin = createAdminClient();
  const landlord = await assertRealEstateLandlordTenant(
    admin,
    body.tenant_id ?? "",
  );
  if (!landlord.ok) {
    return NextResponse.json(
      { error: landlord.error },
      { status: landlord.status },
    );
  }

  const { data: lease, error: leaseError } = await admin
    .from("leases")
    .select(
      "lease_id, lessee_id, status, pending_termination_reason, termination_request_status, end_date",
    )
    .eq("tenant_id", landlord.tenantId)
    .eq("lease_id", leaseId)
    .maybeSingle();

  if (leaseError) {
    return NextResponse.json({ error: leaseError.message }, { status: 400 });
  }
  if (!lease) {
    return NextResponse.json({ error: "Lease not found." }, { status: 404 });
  }
  if (lease.termination_request_status !== "pending_staff_approval") {
    return NextResponse.json(
      { error: "No pending termination request to review." },
      { status: 400 },
    );
  }

  const { data: lessee } = await admin
    .from("lessees")
    .select("full_name, email")
    .eq("tenant_id", landlord.tenantId)
    .eq("lessee_id", lease.lessee_id)
    .maybeSingle();

  const pendingReason =
    (lease.pending_termination_reason as string | null)?.trim() || null;

  if (action === "reject") {
    const now = new Date().toISOString();
    const { error } = await admin
      .from("leases")
      .update({
        pending_termination_reason: null,
        termination_request_status: "rejected",
        updated_at: now,
      })
      .eq("tenant_id", landlord.tenantId)
      .eq("lease_id", leaseId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    await notifyTenantTerminationDecision({
      email: lessee?.email,
      fullName: lessee?.full_name ?? "Tenant",
      approved: false,
      reason: pendingReason,
    });

    return NextResponse.json({ success: true, action: "reject" });
  }

  if (lease.status !== "active") {
    return NextResponse.json(
      { error: "Only active leases can be terminated early." },
      { status: 400 },
    );
  }

  const terminationReason =
    pendingReason ||
    `Tenant-requested early termination approved (lease end was ${formatLeaseDate(lease.end_date)}).`;

  try {
    const result = await terminateLeaseEarly(admin, {
      tenantId: landlord.tenantId,
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

    return NextResponse.json({
      success: true,
      action: "approve",
      deposit_id: result.depositId,
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "Unable to approve termination request.",
      },
      { status: 400 },
    );
  }
}
