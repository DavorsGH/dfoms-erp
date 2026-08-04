import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { assertDavorsManagedLandlord } from "@/utils/maintenance-management";
import { insertLesseePortalNotification } from "@/utils/lessee-portal-notifications";
import { sendResendEmail } from "@/utils/resend-email";
import {
  isLesseeComplaintRaisedBy,
  isLesseeComplaintStatus,
  type LesseeComplaintListRow,
  type LesseeComplaintRaisedBy,
  type LesseeComplaintStatus,
} from "@/app/dashboard/real-estate/complaints-utils";
import {
  notifyStaffLandlordRaisedComplaint,
  notifyStaffNewComplaint,
  notifyStaffTenantComplaintResponse,
} from "@/utils/real-estate-staff-notifications";

export type { LesseeComplaintListRow } from "@/app/dashboard/real-estate/complaints-utils";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export type UpdateLesseeComplaintResult =
  | { ok: true; status: LesseeComplaintStatus }
  | { ok: false; error: string; status: number };

export type CreateLesseeComplaintResult =
  | { ok: true; complaintId: string }
  | { ok: false; error: string; status: number };

export type RespondLesseeComplaintAsTenantResult =
  | { ok: true; status: LesseeComplaintStatus }
  | { ok: false; error: string; status: number };

export type AcknowledgeLesseeComplaintResult =
  | { ok: true; acknowledgedAt: string }
  | { ok: false; error: string; status: number };

/**
 * Insert a complaint. Uses staff_response for the non-filer party's reply
 * (landlord/staff when tenant raised; tenant when landlord raised).
 */
export async function createLesseeComplaint(
  admin: SupabaseClient,
  options: {
    tenantId: string;
    leaseId: string;
    lesseeId: string;
    subject: string;
    description: string;
    raisedBy: LesseeComplaintRaisedBy;
    lesseeName?: string | null;
    landlordName?: string | null;
  },
): Promise<CreateLesseeComplaintResult> {
  const subject = options.subject.trim();
  const description = options.description.trim();
  const leaseId = options.leaseId.trim();
  if (!leaseId) {
    return { ok: false, error: "lease_id is required", status: 400 };
  }
  if (!subject) {
    return { ok: false, error: "subject is required", status: 400 };
  }
  if (!description) {
    return { ok: false, error: "description is required", status: 400 };
  }

  const { data: lease, error: leaseError } = await admin
    .from("leases")
    .select("lease_id, lessee_id")
    .eq("tenant_id", options.tenantId)
    .eq("lease_id", leaseId)
    .maybeSingle();

  if (leaseError) {
    return { ok: false, error: leaseError.message, status: 400 };
  }
  if (!lease || lease.lessee_id !== options.lesseeId) {
    return { ok: false, error: "Lease not found for this tenant.", status: 404 };
  }

  const nowIso = new Date().toISOString();
  const complaintId = crypto.randomUUID();

  const { error: insertError } = await admin.from("lessee_complaints").insert({
    tenant_id: options.tenantId,
    complaint_id: complaintId,
    lease_id: leaseId,
    lessee_id: options.lesseeId,
    subject,
    description,
    status: "submitted",
    raised_by: options.raisedBy,
    staff_response: null,
    date_reported: nowIso,
    date_resolved: null,
    created_at: nowIso,
    updated_at: nowIso,
  });

  if (insertError) {
    return { ok: false, error: insertError.message, status: 400 };
  }

  if (options.raisedBy === "tenant") {
    await notifyStaffNewComplaint({
      landlordTenantId: options.tenantId,
      leaseId,
      complaintId,
      subject,
      description,
      lesseeName: options.lesseeName,
    });
  } else {
    const lesseeName = options.lesseeName?.trim() || "Tenant";
    void insertLesseePortalNotification({
      landlordTenantId: options.tenantId,
      lesseeId: options.lesseeId,
      title: "New complaint from your landlord",
      body: [
        `Your landlord filed a complaint: “${subject}”.`,
        description,
        "Open Complaints to respond.",
      ].join("\n"),
      actionUrl: "/portal/complaints",
      context: `complaint-landlord-raised:${complaintId}`,
    });
    await notifyStaffLandlordRaisedComplaint({
      landlordTenantId: options.tenantId,
      leaseId,
      complaintId,
      subject,
      description,
      lesseeName,
      landlordName: options.landlordName,
    });
  }

  return { ok: true, complaintId };
}

/**
 * Tenant reply to a landlord-raised complaint (response only; cannot resolve).
 */
export async function respondToLesseeComplaintAsTenant(
  admin: SupabaseClient,
  options: {
    tenantId: string;
    lesseeId: string;
    complaintId: string;
    response: string;
  },
): Promise<RespondLesseeComplaintAsTenantResult> {
  const complaintId = options.complaintId.trim();
  const response = options.response.trim();
  if (!complaintId) {
    return { ok: false, error: "complaint_id is required", status: 400 };
  }
  if (!response) {
    return { ok: false, error: "response is required", status: 400 };
  }

  const { data: existing, error: existingError } = await admin
    .from("lessee_complaints")
    .select("complaint_id, lease_id, lessee_id, subject, status, raised_by")
    .eq("tenant_id", options.tenantId)
    .eq("complaint_id", complaintId)
    .maybeSingle();

  if (existingError) {
    return { ok: false, error: existingError.message, status: 400 };
  }
  if (!existing) {
    return { ok: false, error: "Complaint not found.", status: 404 };
  }
  if (existing.lessee_id !== options.lesseeId) {
    return { ok: false, error: "Access denied.", status: 403 };
  }
  if (existing.raised_by !== "landlord") {
    return {
      ok: false,
      error: "Only landlord-raised complaints can be answered here.",
      status: 400,
    };
  }
  if (existing.status === "resolved" || existing.status === "rejected") {
    return {
      ok: false,
      error: "This complaint is already closed.",
      status: 400,
    };
  }

  const nextStatus: LesseeComplaintStatus =
    existing.status === "submitted" ? "in_progress" : existing.status;
  const nowIso = new Date().toISOString();

  const { error: updateError } = await admin
    .from("lessee_complaints")
    .update({
      status: nextStatus,
      staff_response: response,
      updated_at: nowIso,
    })
    .eq("tenant_id", options.tenantId)
    .eq("complaint_id", complaintId);

  if (updateError) {
    return { ok: false, error: updateError.message, status: 400 };
  }

  const { data: lessee } = await admin
    .from("lessees")
    .select("full_name")
    .eq("tenant_id", options.tenantId)
    .eq("lessee_id", existing.lessee_id)
    .maybeSingle();

  await notifyStaffTenantComplaintResponse({
    landlordTenantId: options.tenantId,
    leaseId: existing.lease_id,
    complaintId,
    subject: existing.subject,
    response,
    lesseeName:
      typeof lessee?.full_name === "string" ? lessee.full_name : null,
  });

  return { ok: true, status: nextStatus };
}

/**
 * Landlord/staff status/response update. Same as before: landlord or staff
 * closes complaints (resolved/rejected); tenants cannot close via this path.
 */
export async function updateLesseeComplaint(
  admin: SupabaseClient,
  options: {
    tenantId: string;
    complaintId: string;
    status: string;
    staffResponse: string | null;
  },
): Promise<UpdateLesseeComplaintResult> {
  const complaintId = options.complaintId.trim();
  const status = options.status.trim();
  if (!complaintId) {
    return { ok: false, error: "complaint_id is required", status: 400 };
  }
  if (!isLesseeComplaintStatus(status)) {
    return { ok: false, error: "Invalid complaint status.", status: 400 };
  }

  const staffResponse =
    typeof options.staffResponse === "string"
      ? options.staffResponse.trim() || null
      : null;

  const { data: existing, error: existingError } = await admin
    .from("lessee_complaints")
    .select(
      "complaint_id, lessee_id, subject, status, raised_by, staff_response",
    )
    .eq("tenant_id", options.tenantId)
    .eq("complaint_id", complaintId)
    .maybeSingle();

  if (existingError) {
    return { ok: false, error: existingError.message, status: 400 };
  }
  if (!existing) {
    return { ok: false, error: "Complaint not found.", status: 404 };
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
    .eq("tenant_id", options.tenantId)
    .eq("complaint_id", complaintId);

  if (updateError) {
    return { ok: false, error: updateError.message, status: 400 };
  }

  const raisedBy =
    existing.raised_by === "landlord" ? "landlord" : "tenant";
  const previousResponse =
    typeof existing.staff_response === "string"
      ? existing.staff_response.trim() || null
      : null;
  const responseChanged =
    staffResponse != null && staffResponse !== previousResponse;

  if (
    raisedBy === "tenant" &&
    !becameResolved &&
    responseChanged &&
    staffResponse
  ) {
    const { data: lessee } = await admin
      .from("lessees")
      .select("full_name, email")
      .eq("tenant_id", options.tenantId)
      .eq("lessee_id", existing.lessee_id)
      .maybeSingle();

    const name = lessee?.full_name?.trim() || "Tenant";
    const title = "Response to your complaint";
    const inAppBody = [
      `Regarding your complaint “${existing.subject}”, you have a new response:`,
      staffResponse,
    ].join("\n");

    const email = lessee?.email?.trim();
    if (email) {
      void sendResendEmail({
        to: email,
        subject: title,
        text: [`Hi ${name},`, "", inAppBody, "", "Davors Facilities"].join("\n"),
        html: `<p>Hi ${escapeHtml(name)},</p>
<p>${escapeHtml(inAppBody.replace(/\n/g, " "))}</p>
<p><strong>Response:</strong> ${escapeHtml(staffResponse)}</p>
<p>Davors Facilities</p>`,
      }).then((result) => {
        if (!result.ok) {
          console.error("[complaints] response notify failed:", result.error);
        }
      });
    }

    void insertLesseePortalNotification({
      landlordTenantId: options.tenantId,
      lesseeId: existing.lessee_id,
      title,
      body: inAppBody,
      actionUrl: "/portal/complaints",
      context: `complaint-response:${complaintId}`,
    });
  }

  if (becameResolved) {
    const { data: lessee } = await admin
      .from("lessees")
      .select("full_name, email")
      .eq("tenant_id", options.tenantId)
      .eq("lessee_id", existing.lessee_id)
      .maybeSingle();

    const name = lessee?.full_name?.trim() || "Tenant";
    const approved = status === "resolved";
    const subject =
      raisedBy === "tenant"
        ? approved
          ? "Your complaint was resolved"
          : "Update on your complaint"
        : approved
          ? "Landlord complaint closed"
          : "Update on landlord complaint";
    const responseLabel =
      raisedBy === "tenant" ? "Landlord response" : "Resolution note";
    const responseLine = staffResponse
      ? `${responseLabel}: ${staffResponse}`
      : null;
    const inAppBody =
      raisedBy === "tenant"
        ? [
            `Regarding your complaint “${existing.subject}”: status is now ${status}.`,
            responseLine,
            approved
              ? "Open Complaints in your portal to acknowledge the resolution."
              : null,
          ]
            .filter(Boolean)
            .join("\n")
        : [
            `Regarding the complaint about you (“${existing.subject}”): status is now ${status}.`,
            responseLine,
          ]
            .filter(Boolean)
            .join("\n");

    const email = lessee?.email?.trim();
    if (email) {
      void sendResendEmail({
        to: email,
        subject,
        text: [
          `Hi ${name},`,
          "",
          inAppBody,
          "",
          "Davors Facilities",
        ]
          .filter(Boolean)
          .join("\n"),
        html: `<p>Hi ${escapeHtml(name)},</p>
<p>${escapeHtml(inAppBody.replace(/\n/g, " "))}</p>
${staffResponse ? `<p>${escapeHtml(responseLabel)}: ${escapeHtml(staffResponse)}</p>` : ""}
<p>Davors Facilities</p>`,
      }).then((result) => {
        if (!result.ok) {
          console.error("[complaints] notify failed:", result.error);
        }
      });
    }

    void insertLesseePortalNotification({
      landlordTenantId: options.tenantId,
      lesseeId: existing.lessee_id,
      title: subject,
      body: inAppBody,
      actionUrl: "/portal/complaints",
      context: `complaint-status:${complaintId}`,
    });
  }

  return { ok: true, status };
}

/**
 * Tenant confirms satisfaction with resolution of their own complaint.
 */
export async function acknowledgeLesseeComplaint(
  admin: SupabaseClient,
  options: {
    tenantId: string;
    lesseeId: string;
    complaintId: string;
  },
): Promise<AcknowledgeLesseeComplaintResult> {
  const complaintId = options.complaintId.trim();
  if (!complaintId) {
    return { ok: false, error: "complaint_id is required", status: 400 };
  }

  const { data: existing, error: existingError } = await admin
    .from("lessee_complaints")
    .select(
      "complaint_id, lessee_id, subject, status, raised_by, tenant_acknowledged_at",
    )
    .eq("tenant_id", options.tenantId)
    .eq("complaint_id", complaintId)
    .maybeSingle();

  if (existingError) {
    return { ok: false, error: existingError.message, status: 400 };
  }
  if (!existing) {
    return { ok: false, error: "Complaint not found.", status: 404 };
  }
  if (existing.lessee_id !== options.lesseeId) {
    return { ok: false, error: "Access denied.", status: 403 };
  }
  if (existing.raised_by !== "tenant") {
    return {
      ok: false,
      error: "Only your own complaints can be acknowledged here.",
      status: 400,
    };
  }
  if (existing.status !== "resolved") {
    return {
      ok: false,
      error: "Only resolved complaints can be acknowledged.",
      status: 400,
    };
  }
  if (existing.tenant_acknowledged_at) {
    return {
      ok: false,
      error: "This complaint has already been acknowledged.",
      status: 400,
    };
  }

  const nowIso = new Date().toISOString();
  const { error: updateError } = await admin
    .from("lessee_complaints")
    .update({
      tenant_acknowledged_at: nowIso,
      updated_at: nowIso,
    })
    .eq("tenant_id", options.tenantId)
    .eq("complaint_id", complaintId);

  if (updateError) {
    return { ok: false, error: updateError.message, status: 400 };
  }

  return { ok: true, acknowledgedAt: nowIso };
}

type ComplaintRow = {
  tenant_id: string;
  complaint_id: string;
  lease_id: string;
  lessee_id: string;
  subject: string;
  description: string;
  status: string;
  raised_by: string;
  staff_response: string | null;
  date_reported: string;
  date_resolved: string | null;
  tenant_acknowledged_at: string | null;
};

function mapRaisedBy(value: string): LesseeComplaintRaisedBy {
  return isLesseeComplaintRaisedBy(value) ? value : "tenant";
}

export async function fetchComplaintsForLandlord(
  admin: SupabaseClient,
  tenantId: string,
): Promise<{ rows: LesseeComplaintListRow[]; fetchError: string | null }> {
  const landlord = await assertDavorsManagedLandlord(admin, tenantId);
  if (!landlord.ok) {
    return { rows: [], fetchError: landlord.error };
  }

  const [
    { data: complaints, error: complaintsError },
    { data: leases, error: leasesError },
    { data: units, error: unitsError },
    { data: properties, error: propertiesError },
    { data: lessees, error: lesseesError },
  ] = await Promise.all([
    admin
      .from("lessee_complaints")
      .select(
        "tenant_id, complaint_id, lease_id, lessee_id, subject, description, status, raised_by, staff_response, date_reported, date_resolved, tenant_acknowledged_at",
      )
      .eq("tenant_id", landlord.tenantId)
      .order("date_reported", { ascending: false }),
    admin
      .from("leases")
      .select("lease_id, unit_id, lessee_id")
      .eq("tenant_id", landlord.tenantId),
    admin
      .from("property_units")
      .select("unit_id, unit_number, property_id")
      .eq("tenant_id", landlord.tenantId),
    admin
      .from("properties")
      .select("property_id, name")
      .eq("tenant_id", landlord.tenantId),
    admin
      .from("lessees")
      .select("lessee_id, full_name")
      .eq("tenant_id", landlord.tenantId),
  ]);

  if (complaintsError) {
    return { rows: [], fetchError: complaintsError.message };
  }
  if (leasesError) {
    return { rows: [], fetchError: leasesError.message };
  }
  if (unitsError) {
    return { rows: [], fetchError: unitsError.message };
  }
  if (propertiesError) {
    return { rows: [], fetchError: propertiesError.message };
  }
  if (lesseesError) {
    return { rows: [], fetchError: lesseesError.message };
  }

  const propertyNameById = new Map(
    ((properties as Array<{ property_id: string; name: string }> | null) ?? []).map(
      (row) => [row.property_id, row.name],
    ),
  );
  const unitById = new Map(
    (
      (units as Array<{
        unit_id: string;
        unit_number: string;
        property_id: string;
      }> | null) ?? []
    ).map((row) => [row.unit_id, row]),
  );
  const lesseeNameById = new Map(
    ((lessees as Array<{ lessee_id: string; full_name: string }> | null) ?? []).map(
      (row) => [row.lessee_id, row.full_name],
    ),
  );
  const leaseById = new Map(
    (
      (leases as Array<{
        lease_id: string;
        unit_id: string;
        lessee_id: string;
      }> | null) ?? []
    ).map((row) => [row.lease_id, row]),
  );

  const rows: LesseeComplaintListRow[] = [];
  for (const row of (complaints as ComplaintRow[] | null) ?? []) {
    if (!isLesseeComplaintStatus(row.status)) {
      continue;
    }
    const lease = leaseById.get(row.lease_id);
    const unit = lease ? unitById.get(lease.unit_id) : undefined;
    const propertyName = unit
      ? (propertyNameById.get(unit.property_id) ?? "—")
      : "—";
    const unitNumber = unit?.unit_number ?? "—";

    rows.push({
      complaintId: row.complaint_id,
      tenantId: row.tenant_id,
      leaseId: row.lease_id,
      lesseeId: row.lessee_id,
      lesseeName: lesseeNameById.get(row.lessee_id) ?? "—",
      unitLabel: `${propertyName} / Unit ${unitNumber}`,
      subject: row.subject,
      description: row.description,
      status: row.status as LesseeComplaintStatus,
      raisedBy: mapRaisedBy(row.raised_by),
      staffResponse: row.staff_response,
      dateReported: row.date_reported,
      dateResolved: row.date_resolved,
      tenantAcknowledgedAt: row.tenant_acknowledged_at,
    });
  }

  return { rows, fetchError: null };
}

export async function fetchComplaintsForLessee(
  admin: SupabaseClient,
  tenantId: string,
  lesseeId: string,
): Promise<{ rows: LesseeComplaintListRow[]; fetchError: string | null }> {
  const { data: complaints, error: complaintsError } = await admin
    .from("lessee_complaints")
    .select(
      "tenant_id, complaint_id, lease_id, lessee_id, subject, description, status, raised_by, staff_response, date_reported, date_resolved, tenant_acknowledged_at",
    )
    .eq("tenant_id", tenantId)
    .eq("lessee_id", lesseeId)
    .order("date_reported", { ascending: false });

  if (complaintsError) {
    return { rows: [], fetchError: complaintsError.message };
  }

  const rows: LesseeComplaintListRow[] = [];
  for (const row of (complaints as ComplaintRow[] | null) ?? []) {
    if (!isLesseeComplaintStatus(row.status)) {
      continue;
    }
    rows.push({
      complaintId: row.complaint_id,
      tenantId: row.tenant_id,
      leaseId: row.lease_id,
      lesseeId: row.lessee_id,
      lesseeName: "—",
      unitLabel: "—",
      subject: row.subject,
      description: row.description,
      status: row.status as LesseeComplaintStatus,
      raisedBy: mapRaisedBy(row.raised_by),
      staffResponse: row.staff_response,
      dateReported: row.date_reported,
      dateResolved: row.date_resolved,
      tenantAcknowledgedAt: row.tenant_acknowledged_at,
    });
  }

  return { rows, fetchError: null };
}
