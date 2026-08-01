import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { assertDavorsManagedLandlord } from "@/utils/maintenance-management";
import {
  isLesseeComplaintStatus,
  type LesseeComplaintListRow,
  type LesseeComplaintStatus,
} from "@/app/dashboard/real-estate/complaints-utils";

export type { LesseeComplaintListRow } from "@/app/dashboard/real-estate/complaints-utils";

type ComplaintRow = {
  tenant_id: string;
  complaint_id: string;
  lease_id: string;
  lessee_id: string;
  subject: string;
  description: string;
  status: string;
  staff_response: string | null;
  date_reported: string;
  date_resolved: string | null;
};

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
        "tenant_id, complaint_id, lease_id, lessee_id, subject, description, status, staff_response, date_reported, date_resolved",
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
      staffResponse: row.staff_response,
      dateReported: row.date_reported,
      dateResolved: row.date_resolved,
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
      "tenant_id, complaint_id, lease_id, lessee_id, subject, description, status, staff_response, date_reported, date_resolved",
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
      staffResponse: row.staff_response,
      dateReported: row.date_reported,
      dateResolved: row.date_resolved,
    });
  }

  return { rows, fetchError: null };
}
