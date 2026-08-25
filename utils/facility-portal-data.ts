import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { FacilityManagerPortalSession } from "@/utils/facility-portal-auth";
import type {
  FacilityPortalDashboardSummary,
  FacilityPropertyOption,
  FacilityServiceRecordRow,
  FacilityUnitOption,
} from "@/utils/facility-portal-types";
import {
  formatMaintenanceDate,
  formatMaintenanceLandlordApproval,
  formatMaintenanceMoney,
  formatMaintenanceStatus,
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

export type {
  FacilityPortalDashboardSummary,
  FacilityPropertyOption,
  FacilityServiceRecordRow,
  FacilityUnitOption,
} from "@/utils/facility-portal-types";

function toNumber(value: number | string | null | undefined): number | null {
  if (value == null || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

export function facilityManagerHasProperty(
  session: FacilityManagerPortalSession,
  propertyId: string,
): boolean {
  return session.assignedPropertyIds.includes(propertyId);
}

/**
 * Resolve active leases whose units sit on the FM's assigned properties.
 */
export async function fetchFacilityActiveLeaseOptions(
  admin: SupabaseClient,
  session: FacilityManagerPortalSession,
): Promise<{ leases: ActiveLeaseOption[]; error: string | null }> {
  if (session.assignedPropertyIds.length === 0) {
    return { leases: [], error: null };
  }

  const [
    { data: units, error: unitsError },
    { data: properties, error: propertiesError },
    { data: lessees, error: lesseesError },
  ] = await Promise.all([
    admin
      .from("property_units")
      .select("unit_id, unit_number, property_id")
      .eq("tenant_id", session.tenantId)
      .in("property_id", session.assignedPropertyIds),
    admin
      .from("properties")
      .select("property_id, name")
      .eq("tenant_id", session.tenantId)
      .in("property_id", session.assignedPropertyIds),
    admin
      .from("lessees")
      .select("lessee_id, full_name")
      .eq("tenant_id", session.tenantId),
  ]);

  if (unitsError) {
    return { leases: [], error: unitsError.message };
  }
  if (propertiesError) {
    return { leases: [], error: propertiesError.message };
  }
  if (lesseesError) {
    return { leases: [], error: lesseesError.message };
  }

  const unitIds = (units ?? []).map((u) => u.unit_id as string);
  if (unitIds.length === 0) {
    return { leases: [], error: null };
  }

  const { data: leases, error: leasesError } = await admin
    .from("leases")
    .select("lease_id, unit_id, lessee_id")
    .eq("tenant_id", session.tenantId)
    .eq("status", "active")
    .in("unit_id", unitIds)
    .order("created_at", { ascending: false });

  if (leasesError) {
    return { leases: [], error: leasesError.message };
  }

  const unitById = new Map(
    (units ?? []).map((u) => [
      u.unit_id as string,
      {
        unitNumber: String(u.unit_number ?? ""),
        propertyId: u.property_id as string,
      },
    ]),
  );
  const propertyById = new Map(
    (properties ?? []).map((p) => [
      p.property_id as string,
      String(p.name ?? "Property"),
    ]),
  );
  const lesseeById = new Map(
    (lessees ?? []).map((l) => [
      l.lessee_id as string,
      String(l.full_name ?? "Lessee"),
    ]),
  );

  const options: ActiveLeaseOption[] = (leases ?? []).map((lease) => {
    const unit = unitById.get(lease.unit_id as string);
    const propertyName = unit
      ? (propertyById.get(unit.propertyId) ?? "Property")
      : "Property";
    const unitLabel = unit?.unitNumber
      ? `${propertyName} / Unit ${unit.unitNumber}`
      : propertyName;
    const lesseeName =
      lesseeById.get(lease.lessee_id as string) ?? "Lessee";
    return {
      leaseId: lease.lease_id as string,
      label: `${lesseeName} · ${unitLabel}`,
    };
  });

  return { leases: options, error: null };
}

export async function assertFacilityLeaseOnAssignedProperty(
  admin: SupabaseClient,
  session: FacilityManagerPortalSession,
  leaseId: string,
  options?: { requireActive?: boolean },
): Promise<
  | { ok: true; leaseId: string; propertyId: string; status: string }
  | { ok: false; error: string; status: number }
> {
  const requireActive = options?.requireActive ?? false;

  const { data: lease, error } = await admin
    .from("leases")
    .select("lease_id, unit_id, status")
    .eq("tenant_id", session.tenantId)
    .eq("lease_id", leaseId)
    .maybeSingle();

  if (error) {
    return { ok: false, error: error.message, status: 400 };
  }
  if (!lease) {
    return { ok: false, error: "Lease not found.", status: 404 };
  }
  if (requireActive && lease.status !== "active") {
    return {
      ok: false,
      error: "Maintenance requests can only be created for active leases.",
      status: 400,
    };
  }

  const { data: unit, error: unitError } = await admin
    .from("property_units")
    .select("unit_id, property_id")
    .eq("tenant_id", session.tenantId)
    .eq("unit_id", lease.unit_id)
    .maybeSingle();

  if (unitError) {
    return { ok: false, error: unitError.message, status: 400 };
  }
  if (!unit) {
    return { ok: false, error: "Unit not found for lease.", status: 404 };
  }
  if (!facilityManagerHasProperty(session, unit.property_id as string)) {
    return {
      ok: false,
      error: "You are not assigned to this property.",
      status: 403,
    };
  }

  return {
    ok: true,
    leaseId: lease.lease_id as string,
    propertyId: unit.property_id as string,
    status: String(lease.status ?? ""),
  };
}

export async function fetchFacilityAssignedProperties(
  admin: SupabaseClient,
  session: FacilityManagerPortalSession,
): Promise<{ properties: FacilityPropertyOption[]; error: string | null }> {
  if (session.assignedPropertyIds.length === 0) {
    return { properties: [], error: null };
  }

  const { data, error } = await admin
    .from("properties")
    .select("property_id, name")
    .eq("tenant_id", session.tenantId)
    .in("property_id", session.assignedPropertyIds)
    .order("name", { ascending: true });

  if (error) {
    return { properties: [], error: error.message };
  }

  return {
    properties: (data ?? []).map((row) => ({
      propertyId: row.property_id as string,
      name: String(row.name ?? "Property"),
    })),
    error: null,
  };
}

export async function fetchFacilityAssignedUnits(
  admin: SupabaseClient,
  session: FacilityManagerPortalSession,
): Promise<{ units: FacilityUnitOption[]; error: string | null }> {
  if (session.assignedPropertyIds.length === 0) {
    return { units: [], error: null };
  }

  const { data, error } = await admin
    .from("property_units")
    .select("unit_id, unit_number, property_id")
    .eq("tenant_id", session.tenantId)
    .in("property_id", session.assignedPropertyIds)
    .order("unit_number", { ascending: true });

  if (error) {
    return { units: [], error: error.message };
  }

  return {
    units: (data ?? []).map((row) => ({
      unitId: row.unit_id as string,
      propertyId: row.property_id as string,
      label: `Unit ${String(row.unit_number ?? "")}`,
    })),
    error: null,
  };
}

export async function fetchFacilityMaintenanceRequests(
  admin: SupabaseClient,
  session: FacilityManagerPortalSession,
): Promise<{ rows: MaintenanceListRow[]; error: string | null }> {
  if (session.assignedPropertyIds.length === 0) {
    return { rows: [], error: null };
  }

  const { data: units, error: unitsError } = await admin
    .from("property_units")
    .select("unit_id, unit_number, property_id")
    .eq("tenant_id", session.tenantId)
    .in("property_id", session.assignedPropertyIds);

  if (unitsError) {
    return { rows: [], error: unitsError.message };
  }

  const unitIds = (units ?? []).map((u) => u.unit_id as string);
  if (unitIds.length === 0) {
    return { rows: [], error: null };
  }

  const { data: leases, error: leasesError } = await admin
    .from("leases")
    .select("lease_id, unit_id, lessee_id")
    .eq("tenant_id", session.tenantId)
    .in("unit_id", unitIds);

  if (leasesError) {
    return { rows: [], error: leasesError.message };
  }

  const leaseIds = (leases ?? []).map((l) => l.lease_id as string);
  if (leaseIds.length === 0) {
    return { rows: [], error: null };
  }

  const [
    { data: requests, error: requestsError },
    { data: properties, error: propertiesError },
    { data: lessees, error: lesseesError },
  ] = await Promise.all([
    admin
      .from("maintenance_requests")
      .select(
        "tenant_id, request_id, lease_id, reported_by, description, status, cost_ghs, landlord_approval_status, date_reported, date_resolved, photo_urls, completion_photo_urls, tenant_self_fix, proposed_cost_ghs, rent_credit_entry_id",
      )
      .eq("tenant_id", session.tenantId)
      .in("lease_id", leaseIds)
      .order("date_reported", { ascending: false }),
    admin
      .from("properties")
      .select("property_id, name")
      .eq("tenant_id", session.tenantId)
      .in("property_id", session.assignedPropertyIds),
    admin
      .from("lessees")
      .select("lessee_id, full_name")
      .eq("tenant_id", session.tenantId),
  ]);

  if (requestsError) {
    return { rows: [], error: requestsError.message };
  }
  if (propertiesError) {
    return { rows: [], error: propertiesError.message };
  }
  if (lesseesError) {
    return { rows: [], error: lesseesError.message };
  }

  const unitById = new Map(
    (units ?? []).map((u) => [
      u.unit_id as string,
      {
        unitNumber: String(u.unit_number ?? ""),
        propertyId: u.property_id as string,
      },
    ]),
  );
  const propertyById = new Map(
    (properties ?? []).map((p) => [
      p.property_id as string,
      String(p.name ?? "Property"),
    ]),
  );
  const leaseById = new Map(
    (leases ?? []).map((l) => [
      l.lease_id as string,
      {
        unitId: l.unit_id as string,
        lesseeId: l.lessee_id as string,
      },
    ]),
  );
  const lesseeById = new Map(
    (lessees ?? []).map((l) => [
      l.lessee_id as string,
      String(l.full_name ?? "Lessee"),
    ]),
  );

  const rows: MaintenanceListRow[] = [];
  for (const row of requests ?? []) {
    const lease = leaseById.get(row.lease_id as string);
    if (!lease) {
      continue;
    }
    const unit = unitById.get(lease.unitId);
    const propertyName = unit
      ? (propertyById.get(unit.propertyId) ?? "Property")
      : "Property";
    const unitLabel = unit?.unitNumber
      ? `${propertyName} / Unit ${unit.unitNumber}`
      : propertyName;

    const status = isMaintenanceStatus(String(row.status))
      ? (row.status as MaintenanceStatus)
      : "submitted";
    const landlordApprovalStatus = isLandlordApprovalStatus(
      String(row.landlord_approval_status),
    )
      ? (row.landlord_approval_status as MaintenanceLandlordApprovalStatus)
      : "pending";
    const reportedBy = isMaintenanceReportedBy(String(row.reported_by))
      ? (row.reported_by as MaintenanceReportedBy)
      : "staff";

    rows.push({
      requestId: row.request_id as string,
      tenantId: row.tenant_id as string,
      leaseId: row.lease_id as string,
      lesseeName: lesseeById.get(lease.lesseeId) ?? "Lessee",
      unitLabel,
      description: String(row.description ?? ""),
      status,
      costGhs: toNumber(row.cost_ghs as number | string | null),
      landlordApprovalStatus,
      dateReported: String(row.date_reported ?? ""),
      dateResolved: row.date_resolved
        ? String(row.date_resolved)
        : null,
      reportedBy,
      tenantSelfFix: Boolean(row.tenant_self_fix),
      proposedCostGhs: toNumber(
        row.proposed_cost_ghs as number | string | null,
      ),
      rentCreditEntryId: row.rent_credit_entry_id
        ? String(row.rent_credit_entry_id)
        : null,
      photoUrls: normalizePhotoUrls(row.photo_urls),
      completionPhotoUrls: normalizePhotoUrls(row.completion_photo_urls),
    });
  }

  return { rows, error: null };
}

export async function fetchFacilityServiceRecords(
  admin: SupabaseClient,
  session: FacilityManagerPortalSession,
): Promise<{
  rows: FacilityServiceRecordRow[];
  totalCostGhs: number;
  error: string | null;
}> {
  if (session.assignedPropertyIds.length === 0) {
    return { rows: [], totalCostGhs: 0, error: null };
  }

  const [
    { data: records, error: recordsError },
    { data: properties, error: propertiesError },
    { data: units, error: unitsError },
  ] = await Promise.all([
    admin
      .from("property_service_records")
      .select(
        "record_id, property_id, unit_id, service_type, service_date, cost_ghs, notes",
      )
      .eq("tenant_id", session.tenantId)
      .in("property_id", session.assignedPropertyIds)
      .order("service_date", { ascending: false }),
    admin
      .from("properties")
      .select("property_id, name")
      .eq("tenant_id", session.tenantId)
      .in("property_id", session.assignedPropertyIds),
    admin
      .from("property_units")
      .select("unit_id, unit_number, property_id")
      .eq("tenant_id", session.tenantId)
      .in("property_id", session.assignedPropertyIds),
  ]);

  if (recordsError) {
    return { rows: [], totalCostGhs: 0, error: recordsError.message };
  }
  if (propertiesError) {
    return { rows: [], totalCostGhs: 0, error: propertiesError.message };
  }
  if (unitsError) {
    return { rows: [], totalCostGhs: 0, error: unitsError.message };
  }

  const propertyById = new Map(
    (properties ?? []).map((p) => [
      p.property_id as string,
      String(p.name ?? "Property"),
    ]),
  );
  const unitById = new Map(
    (units ?? []).map((u) => [
      u.unit_id as string,
      `Unit ${String(u.unit_number ?? "")}`,
    ]),
  );

  let totalCostGhs = 0;
  const rows: FacilityServiceRecordRow[] = (records ?? []).map((row) => {
    const cost = toNumber(row.cost_ghs as number | string | null);
    if (cost != null) {
      totalCostGhs += cost;
    }
    return {
      recordId: row.record_id as string,
      propertyId: row.property_id as string,
      propertyName:
        propertyById.get(row.property_id as string) ?? "Property",
      unitId: row.unit_id ? (row.unit_id as string) : null,
      unitLabel: row.unit_id
        ? (unitById.get(row.unit_id as string) ?? null)
        : null,
      serviceType: String(row.service_type ?? ""),
      serviceDate: String(row.service_date ?? ""),
      costGhs: cost,
      notes: row.notes ? String(row.notes) : null,
    };
  });

  return { rows, totalCostGhs, error: null };
}

export async function fetchFacilityPortalDashboardSummary(
  admin: SupabaseClient,
  session: FacilityManagerPortalSession,
): Promise<{ summary: FacilityPortalDashboardSummary; error: string | null }> {
  const empty: FacilityPortalDashboardSummary = {
    assignedPropertyCount: session.assignedPropertyIds.length,
    propertyNames: [],
    openMaintenanceCount: 0,
    pendingComplaintsCount: 0,
    upcomingInspectionsCount: 0,
    servicesLoggedThisMonth: 0,
    servicesCostThisMonthGhs: 0,
    pendingCollectionsCount: 0,
  };

  if (session.assignedPropertyIds.length === 0) {
    return { summary: empty, error: null };
  }

  const { properties, error: propertiesError } =
    await fetchFacilityAssignedProperties(admin, session);
  if (propertiesError) {
    return { summary: empty, error: propertiesError };
  }

  const now = new Date();
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

  const { rows: maintenanceRows, error: maintenanceError } =
    await fetchFacilityMaintenanceRequests(admin, session);
  if (maintenanceError) {
    return {
      summary: {
        ...empty,
        propertyNames: properties.map((p) => p.name),
      },
      error: maintenanceError,
    };
  }

  const openMaintenanceCount = maintenanceRows.filter(
    (row) => row.status !== "completed" && row.status !== "rejected",
  ).length;

  let pendingComplaintsCount = 0;
  let upcomingInspectionsCount = 0;
  let servicesLoggedThisMonth = 0;
  let servicesCostThisMonthGhs = 0;
  let pendingCollectionsCount = 0;

  const { data: unitsForScope } = await admin
    .from("property_units")
    .select("unit_id")
    .eq("tenant_id", session.tenantId)
    .in("property_id", session.assignedPropertyIds);
  const scopeUnitIds = (unitsForScope ?? []).map((u) => u.unit_id as string);
  let scopeLeaseIds: string[] = [];
  if (scopeUnitIds.length > 0) {
    const { data: scopeLeases } = await admin
      .from("leases")
      .select("lease_id")
      .eq("tenant_id", session.tenantId)
      .in("unit_id", scopeUnitIds);
    scopeLeaseIds = (scopeLeases ?? []).map((l) => l.lease_id as string);
  }

  if (session.canManageComplaints && scopeLeaseIds.length > 0) {
    const { count } = await admin
      .from("lessee_complaints")
      .select("complaint_id", { count: "exact", head: true })
      .eq("tenant_id", session.tenantId)
      .in("lease_id", scopeLeaseIds)
      .in("status", ["submitted", "in_progress"]);
    pendingComplaintsCount = count ?? 0;
  }

  if (session.canManageInspections && scopeLeaseIds.length > 0) {
    const { count } = await admin
      .from("inspections")
      .select("inspection_id", { count: "exact", head: true })
      .eq("tenant_id", session.tenantId)
      .in("lease_id", scopeLeaseIds);
    upcomingInspectionsCount = count ?? 0;
  }

  if (session.canLogServices) {
    const { data: serviceRows } = await admin
      .from("property_service_records")
      .select("record_id, cost_ghs")
      .eq("tenant_id", session.tenantId)
      .in("property_id", session.assignedPropertyIds)
      .gte("service_date", monthStart);
    servicesLoggedThisMonth = serviceRows?.length ?? 0;
    for (const row of serviceRows ?? []) {
      const cost = toNumber(row.cost_ghs as number | string | null);
      if (cost != null) {
        servicesCostThisMonthGhs += cost;
      }
    }
  }

  if (session.canCollectRent || session.canCollectCharges) {
    const { count } = await admin
      .from("facility_manager_collections")
      .select("collection_id", { count: "exact", head: true })
      .eq("tenant_id", session.tenantId)
      .eq("facility_manager_id", session.facilityManagerId)
      .eq("status", "pending");
    pendingCollectionsCount = count ?? 0;
  }

  return {
    summary: {
      assignedPropertyCount: properties.length,
      propertyNames: properties.map((p) => p.name),
      openMaintenanceCount,
      pendingComplaintsCount,
      upcomingInspectionsCount,
      servicesLoggedThisMonth,
      servicesCostThisMonthGhs,
      pendingCollectionsCount,
    },
    error: null,
  };
}

export {
  formatMaintenanceDate,
  formatMaintenanceLandlordApproval,
  formatMaintenanceMoney,
  formatMaintenanceStatus,
};
