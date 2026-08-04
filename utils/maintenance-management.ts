import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { assertRealEstateLandlordTenant } from "@/utils/property-management";
import {
  isLandlordApprovalStatus,
  isMaintenanceReportedBy,
  isMaintenanceStatus,
  normalizePhotoUrls,
  type ActiveLeaseOption,
  type MaintenanceLandlordApprovalStatus,
  type MaintenanceListRow,
  type MaintenanceReportedBy,
  type MaintenanceStatus,
} from "@/app/dashboard/real-estate/maintenance-utils";

export type { ActiveLeaseOption, MaintenanceListRow } from "@/app/dashboard/real-estate/maintenance-utils";

type MaintenanceRequestRow = {
  tenant_id: string;
  request_id: string;
  lease_id: string;
  reported_by: string;
  description: string;
  status: string;
  cost_ghs: number | string | null;
  landlord_approval_status: string;
  date_reported: string;
  date_resolved: string | null;
  photo_urls: unknown;
  completion_photo_urls: unknown;
  tenant_self_fix?: boolean | null;
  proposed_cost_ghs?: number | string | null;
  rent_credit_entry_id?: string | null;
};

function toNumber(value: number | string | null | undefined): number | null {
  if (value == null || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export async function assertDavorsManagedLandlord(
  admin: SupabaseClient,
  tenantId: string,
): Promise<
  | { ok: true; tenantId: string; name: string }
  | { ok: false; error: string; status: number }
> {
  const landlord = await assertRealEstateLandlordTenant(admin, tenantId);
  if (!landlord.ok) {
    return landlord;
  }

  const { data, error } = await admin
    .from("landlords")
    .select("tenant_id, landlord_type")
    .eq("tenant_id", landlord.tenantId)
    .maybeSingle();

  if (error) {
    return { ok: false, error: error.message, status: 400 };
  }
  if (!data) {
    return { ok: false, error: "Landlord record not found.", status: 404 };
  }
  if (data.landlord_type !== "davors_managed") {
    return {
      ok: false,
      error: "This action is only available for Davors-managed landlords.",
      status: 400,
    };
  }

  return { ok: true, tenantId: landlord.tenantId, name: landlord.name };
}

export async function fetchActiveLeaseOptionsForLandlord(
  admin: SupabaseClient,
  tenantId: string,
): Promise<{ leases: ActiveLeaseOption[]; fetchError: string | null }> {
  const landlord = await assertDavorsManagedLandlord(admin, tenantId);
  if (!landlord.ok) {
    return { leases: [], fetchError: landlord.error };
  }

  const [
    { data: leases, error: leasesError },
    { data: units, error: unitsError },
    { data: properties, error: propertiesError },
    { data: lessees, error: lesseesError },
  ] = await Promise.all([
    admin
      .from("leases")
      .select("lease_id, unit_id, lessee_id")
      .eq("tenant_id", landlord.tenantId)
      .eq("status", "active")
      .order("created_at", { ascending: false }),
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

  if (leasesError) {
    return { leases: [], fetchError: leasesError.message };
  }
  if (unitsError) {
    return { leases: [], fetchError: unitsError.message };
  }
  if (propertiesError) {
    return { leases: [], fetchError: propertiesError.message };
  }
  if (lesseesError) {
    return { leases: [], fetchError: lesseesError.message };
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

  const options: ActiveLeaseOption[] = (
    (leases as Array<{
      lease_id: string;
      unit_id: string;
      lessee_id: string;
    }> | null) ?? []
  ).map((row) => {
    const unit = unitById.get(row.unit_id);
    const propertyName = unit
      ? (propertyNameById.get(unit.property_id) ?? "—")
      : "—";
    const unitNumber = unit?.unit_number ?? "—";
    const lesseeName = lesseeNameById.get(row.lessee_id) ?? "—";
    return {
      leaseId: row.lease_id,
      label: `${lesseeName} · ${propertyName} / Unit ${unitNumber}`,
    };
  });

  return { leases: options, fetchError: null };
}

export async function fetchMaintenanceRequestsForLandlord(
  admin: SupabaseClient,
  tenantId: string,
): Promise<{ rows: MaintenanceListRow[]; fetchError: string | null }> {
  const landlord = await assertDavorsManagedLandlord(admin, tenantId);
  if (!landlord.ok) {
    return { rows: [], fetchError: landlord.error };
  }

  const [
    { data: requests, error: requestsError },
    { data: leases, error: leasesError },
    { data: units, error: unitsError },
    { data: properties, error: propertiesError },
    { data: lessees, error: lesseesError },
  ] = await Promise.all([
    admin
      .from("maintenance_requests")
      .select(
        "tenant_id, request_id, lease_id, reported_by, description, status, cost_ghs, landlord_approval_status, date_reported, date_resolved, photo_urls, completion_photo_urls, tenant_self_fix, proposed_cost_ghs, rent_credit_entry_id",
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

  if (requestsError) {
    return { rows: [], fetchError: requestsError.message };
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

  const rows: MaintenanceListRow[] = [];
  for (const row of (requests as MaintenanceRequestRow[] | null) ?? []) {
    if (!isMaintenanceStatus(row.status)) {
      continue;
    }
    if (!isLandlordApprovalStatus(row.landlord_approval_status)) {
      continue;
    }
    if (!isMaintenanceReportedBy(row.reported_by)) {
      continue;
    }

    const lease = leaseById.get(row.lease_id);
    const unit = lease ? unitById.get(lease.unit_id) : undefined;
    const propertyName = unit
      ? (propertyNameById.get(unit.property_id) ?? "—")
      : "—";
    const unitNumber = unit?.unit_number ?? "—";

    rows.push({
      requestId: row.request_id,
      tenantId: row.tenant_id,
      leaseId: row.lease_id,
      lesseeName: lease
        ? (lesseeNameById.get(lease.lessee_id) ?? "—")
        : "—",
      unitLabel: `${propertyName} / Unit ${unitNumber}`,
      description: row.description,
      status: row.status as MaintenanceStatus,
      costGhs: toNumber(row.cost_ghs),
      landlordApprovalStatus:
        row.landlord_approval_status as MaintenanceLandlordApprovalStatus,
      dateReported: row.date_reported,
      dateResolved: row.date_resolved,
      reportedBy: row.reported_by as MaintenanceReportedBy,
      tenantSelfFix: Boolean(row.tenant_self_fix),
      proposedCostGhs: toNumber(row.proposed_cost_ghs),
      rentCreditEntryId: row.rent_credit_entry_id?.trim() || null,
      photoUrls: normalizePhotoUrls(row.photo_urls),
      completionPhotoUrls: normalizePhotoUrls(row.completion_photo_urls),
    });
  }

  return { rows, fetchError: null };
}

export async function fetchMaintenanceRequestsForLessee(
  admin: SupabaseClient,
  tenantId: string,
  lesseeId: string,
): Promise<{ rows: MaintenanceListRow[]; fetchError: string | null }> {
  const { data: leases, error: leasesError } = await admin
    .from("leases")
    .select("lease_id")
    .eq("tenant_id", tenantId)
    .eq("lessee_id", lesseeId);

  if (leasesError) {
    return { rows: [], fetchError: leasesError.message };
  }

  const leaseIds = (
    (leases as Array<{ lease_id: string }> | null) ?? []
  ).map((row) => row.lease_id);

  if (leaseIds.length === 0) {
    return { rows: [], fetchError: null };
  }

  const { data: requests, error: requestsError } = await admin
    .from("maintenance_requests")
    .select(
      "tenant_id, request_id, lease_id, reported_by, description, status, cost_ghs, landlord_approval_status, date_reported, date_resolved, photo_urls, completion_photo_urls, tenant_self_fix, proposed_cost_ghs, rent_credit_entry_id",
    )
    .eq("tenant_id", tenantId)
    .in("lease_id", leaseIds)
    .order("date_reported", { ascending: false });

  if (requestsError) {
    return { rows: [], fetchError: requestsError.message };
  }

  const rows: MaintenanceListRow[] = [];
  for (const row of (requests as MaintenanceRequestRow[] | null) ?? []) {
    if (!isMaintenanceStatus(row.status)) {
      continue;
    }
    if (!isLandlordApprovalStatus(row.landlord_approval_status)) {
      continue;
    }
    if (!isMaintenanceReportedBy(row.reported_by)) {
      continue;
    }

    rows.push({
      requestId: row.request_id,
      tenantId: row.tenant_id,
      leaseId: row.lease_id,
      lesseeName: "—",
      unitLabel: "—",
      description: row.description,
      status: row.status as MaintenanceStatus,
      costGhs: toNumber(row.cost_ghs),
      landlordApprovalStatus:
        row.landlord_approval_status as MaintenanceLandlordApprovalStatus,
      dateReported: row.date_reported,
      dateResolved: row.date_resolved,
      reportedBy: row.reported_by as MaintenanceReportedBy,
      tenantSelfFix: Boolean(row.tenant_self_fix),
      proposedCostGhs: toNumber(row.proposed_cost_ghs),
      rentCreditEntryId: row.rent_credit_entry_id?.trim() || null,
      photoUrls: normalizePhotoUrls(row.photo_urls),
      completionPhotoUrls: normalizePhotoUrls(row.completion_photo_urls),
    });
  }

  return { rows, fetchError: null };
}
