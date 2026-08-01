import { NextResponse } from "next/server";
import { requireDavorsPlatformSuperAdmin } from "@/utils/admin-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { assertDavorsManagedLandlord } from "@/utils/maintenance-management";
import { isLesseeComplaintStatus } from "@/app/dashboard/real-estate/complaints-utils";
import { sendResendEmail } from "@/utils/resend-email";

type UpdateBody = {
  tenant_id?: string;
  complaint_id?: string;
  status?: string;
  staff_response?: string | null;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export async function POST(request: Request) {
  const auth = await requireDavorsPlatformSuperAdmin();
  if (!auth.ok) {
    return auth.response;
  }

  let body: UpdateBody;
  try {
    body = (await request.json()) as UpdateBody;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const complaintId = body.complaint_id?.trim() ?? "";
  const status = body.status?.trim() ?? "";
  if (!complaintId) {
    return NextResponse.json(
      { error: "complaint_id is required" },
      { status: 400 },
    );
  }
  if (!isLesseeComplaintStatus(status)) {
    return NextResponse.json(
      { error: "Invalid complaint status." },
      { status: 400 },
    );
  }

  const staffResponse =
    typeof body.staff_response === "string"
      ? body.staff_response.trim() || null
      : null;

  const admin = createAdminClient();
  const landlord = await assertDavorsManagedLandlord(admin, body.tenant_id ?? "");
  if (!landlord.ok) {
    return NextResponse.json(
      { error: landlord.error },
      { status: landlord.status },
    );
  }

  const { data: existing, error: existingError } = await admin
    .from("lessee_complaints")
    .select("complaint_id, lessee_id, subject, status")
    .eq("tenant_id", landlord.tenantId)
    .eq("complaint_id", complaintId)
    .maybeSingle();

  if (existingError) {
    return NextResponse.json({ error: existingError.message }, { status: 400 });
  }
  if (!existing) {
    return NextResponse.json({ error: "Complaint not found." }, { status: 404 });
  }

  const nowIso = new Date().toISOString();
  const becameResolved =
    (status === "resolved" || status === "rejected") &&
    existing.status !== status;

  const { error: updateError } = await admin
    .from("lessee_complaints")
    .update({
      status,
      staff_response: staffResponse,
      date_resolved: becameResolved ? nowIso : null,
      updated_at: nowIso,
    })
    .eq("tenant_id", landlord.tenantId)
    .eq("complaint_id", complaintId);

  if (updateError) {
    return NextResponse.json({ error: updateError.message }, { status: 400 });
  }

  if (becameResolved) {
    const { data: lessee } = await admin
      .from("lessees")
      .select("full_name, email")
      .eq("tenant_id", landlord.tenantId)
      .eq("lessee_id", existing.lessee_id)
      .maybeSingle();

    const email = lessee?.email?.trim();
    if (email) {
      const name = lessee?.full_name?.trim() || "Tenant";
      const approved = status === "resolved";
      const subject = approved
        ? "Your complaint was resolved"
        : "Update on your complaint";
      const responseLine = staffResponse
        ? `Staff response: ${staffResponse}`
        : null;
      void sendResendEmail({
        to: email,
        subject,
        text: [
          `Hi ${name},`,
          "",
          `Regarding your complaint “${existing.subject}”: status is now ${status}.`,
          responseLine,
          "",
          "Davors Facilities",
        ]
          .filter(Boolean)
          .join("\n"),
        html: `<p>Hi ${escapeHtml(name)},</p>
<p>Regarding your complaint “${escapeHtml(existing.subject)}”: status is now <strong>${escapeHtml(status)}</strong>.</p>
${staffResponse ? `<p>Staff response: ${escapeHtml(staffResponse)}</p>` : ""}
<p>Davors Facilities</p>`,
      }).then((result) => {
        if (!result.ok) {
          console.error("[complaints] notify failed:", result.error);
        }
      });
    }
  }

  return NextResponse.json({ success: true, status });
}
