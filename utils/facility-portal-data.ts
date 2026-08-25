import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { FacilityManagerPortalSession } from "@/utils/facility-portal-auth";
import type {
  FacilityCollectionListRow,
  FacilityComplaintListRow,
  FacilityInspectionListRow,
  FacilityOutstandingLedgerRow,
  FacilityPortalDashboardSummary,
  FacilityPropertyOption,
  FacilityServiceRecordRow,
  FacilityUnitOption,
} from "@/utils/facility-portal-types";
import {
  formatLesseeComplaintDate,
  formatLesseeComplaintRaisedBy,
  formatLesseeComplaintStatus,
  isLesseeComplaintRaisedBy,
  isLesseeComplaintStatus,
} from "@/app/dashboard/real-estate/complaints-utils";
import {
  formatInspectionDate,
  formatInspectionType,
  isInspectionType,
  normalizeInspectionChecklist,
} from "@/app/dashboard/real-estate/inspections-utils";
import {
  formatRentLedgerStatus,
  rentOutstandingGhs,
} from "@/app/dashboard/real-estate/rent-ledger-utils";
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
  FacilityCollectionListRow,
  FacilityComplaintListRow,
  FacilityInspectionListRow,
  FacilityOutstandingLedgerRow,
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

async function fetchFacilityScopeLeaseIds(
  admin: SupabaseClient,
  session: FacilityManagerPortalSession,
): Promise<string[]> {
  if (session.assignedPropertyIds.length === 0) {
    return [];
  }
  const { data: units } = await admin
    .from("property_units")
    .select("unit_id")
    .eq("tenant_id", session.tenantId)
    .in("property_id", session.assignedPropertyIds);
  const unitIds = (units ?? []).map((u) => u.unit_id as string);
  if (unitIds.length === 0) {
    return [];
  }
  const { data: leases } = await admin
    .from("leases")
    .select("lease_id")
    .eq("tenant_id", session.tenantId)
    .in("unit_id", unitIds);
  return (leases ?? []).map((l) => l.lease_id as string);
}

export async function assertFacilityComplaintOnAssignedProperty(
  admin: SupabaseClient,
  session: FacilityManagerPortalSession,
  complaintId: string,
): Promise<
  | { ok: true; complaintId: string; leaseId: string; raisedBy: string }
  | { ok: false; error: string; status: number }
> {
  const { data: complaint, error } = await admin
    .from("lessee_complaints")
    .select("complaint_id, lease_id, raised_by")
    .eq("tenant_id", session.tenantId)
    .eq("complaint_id", complaintId)
    .maybeSingle();

  if (error) {
    return { ok: false, error: error.message, status: 400 };
  }
  if (!complaint) {
    return { ok: false, error: "Complaint not found.", status: 404 };
  }

  const leaseCheck = await assertFacilityLeaseOnAssignedProperty(
    admin,
    session,
    complaint.lease_id as string,
  );
  if (!leaseCheck.ok) {
    return { ok: false, error: leaseCheck.error, status: leaseCheck.status };
  }

  return {
    ok: true,
    complaintId: complaint.complaint_id as string,
    leaseId: complaint.lease_id as string,
    raisedBy: String(complaint.raised_by ?? "tenant"),
  };
}

export async function fetchFacilityComplaints(
  admin: SupabaseClient,
  session: FacilityManagerPortalSession,
): Promise<{ rows: FacilityComplaintListRow[]; error: string | null }> {
  const leaseIds = await fetchFacilityScopeLeaseIds(admin, session);
  if (leaseIds.length === 0) {
    return { rows: [], error: null };
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
        "complaint_id, lease_id, lessee_id, subject, description, status, raised_by, staff_response, date_reported",
      )
      .eq("tenant_id", session.tenantId)
      .in("lease_id", leaseIds)
      .order("date_reported", { ascending: false }),
    admin
      .from("leases")
      .select("lease_id, unit_id, lessee_id")
      .eq("tenant_id", session.tenantId)
      .in("lease_id", leaseIds),
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

  if (complaintsError) {
    return { rows: [], error: complaintsError.message };
  }
  if (leasesError || unitsError || propertiesError || lesseesError) {
    return {
      rows: [],
      error:
        leasesError?.message ??
        unitsError?.message ??
        propertiesError?.message ??
        lesseesError?.message ??
        "Unable to load complaints.",
    };
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
      {
        unitNumber: String(u.unit_number ?? ""),
        propertyId: u.property_id as string,
      },
    ]),
  );
  const leaseById = new Map(
    (leases ?? []).map((l) => [
      l.lease_id as string,
      { unitId: l.unit_id as string, lesseeId: l.lessee_id as string },
    ]),
  );
  const lesseeById = new Map(
    (lessees ?? []).map((l) => [
      l.lessee_id as string,
      String(l.full_name ?? "Lessee"),
    ]),
  );

  const rows: FacilityComplaintListRow[] = [];
  for (const row of complaints ?? []) {
    if (!isLesseeComplaintStatus(String(row.status))) {
      continue;
    }
    const lease = leaseById.get(row.lease_id as string);
    const unit = lease ? unitById.get(lease.unitId) : undefined;
    const propertyName = unit
      ? (propertyById.get(unit.propertyId) ?? "Property")
      : "Property";
    const unitLabel = unit?.unitNumber
      ? `${propertyName} / Unit ${unit.unitNumber}`
      : propertyName;
    const raisedBy = isLesseeComplaintRaisedBy(String(row.raised_by))
      ? row.raised_by
      : "tenant";
    const status = row.status as string;

    rows.push({
      complaintId: row.complaint_id as string,
      leaseId: row.lease_id as string,
      lesseeName: lease
        ? (lesseeById.get(lease.lesseeId) ?? "Lessee")
        : "Lessee",
      unitLabel,
      subject: String(row.subject ?? ""),
      description: String(row.description ?? ""),
      status,
      statusLabel: formatLesseeComplaintStatus(status),
      raisedBy,
      raisedByLabel: formatLesseeComplaintRaisedBy(
        raisedBy as "tenant" | "landlord",
      ),
      staffResponse: row.staff_response
        ? String(row.staff_response)
        : null,
      dateReported: String(row.date_reported ?? ""),
      dateLabel: formatLesseeComplaintDate(String(row.date_reported ?? "")),
      isOpen: status === "submitted" || status === "in_progress",
    });
  }

  return { rows, error: null };
}

export async function fetchFacilityInspections(
  admin: SupabaseClient,
  session: FacilityManagerPortalSession,
): Promise<{ rows: FacilityInspectionListRow[]; error: string | null }> {
  const leaseIds = await fetchFacilityScopeLeaseIds(admin, session);
  if (leaseIds.length === 0) {
    return { rows: [], error: null };
  }

  const [
    { data: inspections, error: inspectionsError },
    { data: leases, error: leasesError },
    { data: units, error: unitsError },
    { data: properties, error: propertiesError },
    { data: lessees, error: lesseesError },
  ] = await Promise.all([
    admin
      .from("inspections")
      .select(
        "inspection_id, lease_id, inspection_type, inspection_date, conducted_by, checklist, notes",
      )
      .eq("tenant_id", session.tenantId)
      .in("lease_id", leaseIds)
      .order("inspection_date", { ascending: false }),
    admin
      .from("leases")
      .select("lease_id, unit_id, lessee_id")
      .eq("tenant_id", session.tenantId)
      .in("lease_id", leaseIds),
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

  if (inspectionsError) {
    return { rows: [], error: inspectionsError.message };
  }
  if (leasesError || unitsError || propertiesError || lesseesError) {
    return {
      rows: [],
      error:
        leasesError?.message ??
        unitsError?.message ??
        propertiesError?.message ??
        lesseesError?.message ??
        "Unable to load inspections.",
    };
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
      {
        unitNumber: String(u.unit_number ?? ""),
        propertyId: u.property_id as string,
      },
    ]),
  );
  const leaseById = new Map(
    (leases ?? []).map((l) => [
      l.lease_id as string,
      { unitId: l.unit_id as string, lesseeId: l.lessee_id as string },
    ]),
  );
  const lesseeById = new Map(
    (lessees ?? []).map((l) => [
      l.lessee_id as string,
      String(l.full_name ?? "Lessee"),
    ]),
  );

  const rows: FacilityInspectionListRow[] = [];
  for (const row of inspections ?? []) {
    if (!isInspectionType(String(row.inspection_type))) {
      continue;
    }
    const lease = leaseById.get(row.lease_id as string);
    const unit = lease ? unitById.get(lease.unitId) : undefined;
    const propertyName = unit
      ? (propertyById.get(unit.propertyId) ?? "Property")
      : "Property";
    const unitLabel = unit?.unitNumber
      ? `${propertyName} / Unit ${unit.unitNumber}`
      : propertyName;
    const checklist = normalizeInspectionChecklist(row.checklist);

    rows.push({
      inspectionId: row.inspection_id as string,
      leaseId: row.lease_id as string,
      lesseeName: lease
        ? (lesseeById.get(lease.lesseeId) ?? "Lessee")
        : "Lessee",
      unitLabel,
      inspectionType: row.inspection_type as string,
      inspectionTypeLabel: formatInspectionType(row.inspection_type as string),
      inspectionDate: String(row.inspection_date ?? ""),
      dateLabel: formatInspectionDate(String(row.inspection_date ?? "")),
      conductedBy: row.conducted_by ? String(row.conducted_by) : null,
      notes: row.notes ? String(row.notes) : null,
      checklistItemCount: checklist.length,
    });
  }

  return { rows, error: null };
}

export async function fetchFacilityInspectionLeaseOptions(
  admin: SupabaseClient,
  session: FacilityManagerPortalSession,
): Promise<{ leases: ActiveLeaseOption[]; error: string | null }> {
  return fetchFacilityActiveLeaseOptions(admin, session);
}

const FM_COLLECTION_METHOD_LABELS: Record<string, string> = {
  cash: "Cash",
  momo: "Mobile Money",
  bank_transfer: "Bank Transfer",
};

const FM_COLLECTION_STATUS_LABELS: Record<string, string> = {
  pending_landlord_confirmation: "Pending confirmation",
  confirmed: "Confirmed",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

export async function fetchFacilityOutstandingRentLedger(
  admin: SupabaseClient,
  session: FacilityManagerPortalSession,
): Promise<{ rows: FacilityOutstandingLedgerRow[]; error: string | null }> {
  if (!session.canCollectRent && !session.canCollectCharges) {
    return { rows: [], error: null };
  }

  const leaseIds = await fetchFacilityScopeLeaseIds(admin, session);
  if (leaseIds.length === 0) {
    return { rows: [], error: null };
  }

  const [
    { data: ledgerRows, error: ledgerError },
    { data: leases, error: leasesError },
    { data: units, error: unitsError },
    { data: properties, error: propertiesError },
    { data: lessees, error: lesseesError },
    { data: pendingCollections, error: pendingError },
  ] = await Promise.all([
    admin
      .from("rent_ledger")
      .select(
        "entry_id, lease_id, charge_type, description, period_start, period_end, amount_due_ghs, amount_paid_ghs, credit_ghs, status",
      )
      .eq("tenant_id", session.tenantId)
      .in("lease_id", leaseIds)
      .neq("status", "paid")
      .order("period_start", { ascending: false }),
    admin
      .from("leases")
      .select("lease_id, unit_id, lessee_id, status")
      .eq("tenant_id", session.tenantId)
      .in("lease_id", leaseIds)
      .eq("status", "active"),
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
    admin
      .from("facility_manager_collections")
      .select("rent_ledger_entry_id")
      .eq("tenant_id", session.tenantId)
      .eq("status", "pending_landlord_confirmation"),
  ]);

  if (ledgerError) {
    return { rows: [], error: ledgerError.message };
  }
  if (leasesError || unitsError || propertiesError || lesseesError) {
    return {
      rows: [],
      error:
        leasesError?.message ??
        unitsError?.message ??
        propertiesError?.message ??
        lesseesError?.message ??
        "Unable to load outstanding ledger.",
    };
  }
  if (pendingError) {
    return { rows: [], error: pendingError.message };
  }

  const pendingEntryIds = new Set(
    (pendingCollections ?? []).map((r) => r.rent_ledger_entry_id as string),
  );

  const propertyById = new Map(
    (properties ?? []).map((p) => [
      p.property_id as string,
      String(p.name ?? "Property"),
    ]),
  );
  const unitById = new Map(
    (units ?? []).map((u) => [
      u.unit_id as string,
      {
        unitNumber: String(u.unit_number ?? ""),
        propertyId: u.property_id as string,
      },
    ]),
  );
  const leaseById = new Map(
    (leases ?? []).map((l) => [
      l.lease_id as string,
      { unitId: l.unit_id as string, lesseeId: l.lessee_id as string },
    ]),
  );
  const lesseeById = new Map(
    (lessees ?? []).map((l) => [
      l.lessee_id as string,
      String(l.full_name ?? "Lessee"),
    ]),
  );

  const rows: FacilityOutstandingLedgerRow[] = [];
  for (const row of ledgerRows ?? []) {
    const lease = leaseById.get(row.lease_id as string);
    if (!lease) {
      continue;
    }
    const chargeType = String(row.charge_type ?? "rent");
    const isRent = chargeType === "rent";
    const isCharge = chargeType === "one_time";
    if (isRent && !session.canCollectRent) {
      continue;
    }
    if (isCharge && !session.canCollectCharges) {
      continue;
    }
    if (!isRent && !isCharge) {
      continue;
    }

    const unit = unitById.get(lease.unitId);
    const propertyId = unit?.propertyId ?? "";
    const propertyName = unit
      ? (propertyById.get(unit.propertyId) ?? "Property")
      : "Property";
    const unitLabel = unit?.unitNumber
      ? `${propertyName} / Unit ${unit.unitNumber}`
      : propertyName;

    const amountDue = toNumber(row.amount_due_ghs as number | string | null) ?? 0;
    const amountPaid = toNumber(row.amount_paid_ghs as number | string | null) ?? 0;
    const credit = toNumber(row.credit_ghs as number | string | null) ?? 0;
    const outstanding = rentOutstandingGhs(amountDue, amountPaid, credit);
    if (outstanding <= 0) {
      continue;
    }

    rows.push({
      entryId: row.entry_id as string,
      leaseId: row.lease_id as string,
      propertyId,
      lesseeName: lesseeById.get(lease.lesseeId) ?? "Lessee",
      unitLabel,
      chargeType,
      description: row.description ? String(row.description) : null,
      periodStart: String(row.period_start ?? ""),
      periodEnd: String(row.period_end ?? ""),
      amountDueGhs: amountDue,
      amountPaidGhs: amountPaid,
      outstandingGhs: outstanding,
      status: String(row.status ?? ""),
      statusLabel: formatRentLedgerStatus(String(row.status ?? "")),
      hasPendingCollection: pendingEntryIds.has(row.entry_id as string),
    });
  }

  return { rows, error: null };
}

export async function fetchFacilityManagerCollections(
  admin: SupabaseClient,
  session: FacilityManagerPortalSession,
): Promise<{ rows: FacilityCollectionListRow[]; error: string | null }> {
  if (!session.canCollectRent && !session.canCollectCharges) {
    return { rows: [], error: null };
  }

  const { data: collections, error: collectionsError } = await admin
    .from("facility_manager_collections")
    .select(
      "collection_id, rent_ledger_entry_id, property_id, lease_id, amount_ghs, payment_method, collected_at, notes, status, rejection_reason",
    )
    .eq("tenant_id", session.tenantId)
    .eq("facility_manager_id", session.facilityManagerId)
    .order("collected_at", { ascending: false });

  if (collectionsError) {
    return { rows: [], error: collectionsError.message };
  }

  const entryIds = (collections ?? []).map(
    (r) => r.rent_ledger_entry_id as string,
  );
  const leaseIds = (collections ?? []).map((r) => r.lease_id as string);

  const [
    { data: ledgerRows },
    { data: leases },
    { data: units },
    { data: properties },
    { data: lessees },
  ] = await Promise.all([
    entryIds.length
      ? admin
          .from("rent_ledger")
          .select("entry_id, description, charge_type")
          .eq("tenant_id", session.tenantId)
          .in("entry_id", entryIds)
      : Promise.resolve({ data: [] }),
    leaseIds.length
      ? admin
          .from("leases")
          .select("lease_id, unit_id, lessee_id")
          .eq("tenant_id", session.tenantId)
          .in("lease_id", leaseIds)
      : Promise.resolve({ data: [] }),
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

  const ledgerById = new Map(
    (ledgerRows ?? []).map((r) => [
      r.entry_id as string,
      {
        description: r.description ? String(r.description) : null,
        chargeType: String(r.charge_type ?? "rent"),
      },
    ]),
  );
  const propertyById = new Map(
    (properties ?? []).map((p) => [
      p.property_id as string,
      String(p.name ?? "Property"),
    ]),
  );
  const unitById = new Map(
    (units ?? []).map((u) => [
      u.unit_id as string,
      {
        unitNumber: String(u.unit_number ?? ""),
        propertyId: u.property_id as string,
      },
    ]),
  );
  const leaseById = new Map(
    (leases ?? []).map((l) => [
      l.lease_id as string,
      { unitId: l.unit_id as string, lesseeId: l.lessee_id as string },
    ]),
  );
  const lesseeById = new Map(
    (lessees ?? []).map((l) => [
      l.lessee_id as string,
      String(l.full_name ?? "Lessee"),
    ]),
  );

  const rows: FacilityCollectionListRow[] = (collections ?? []).map((row) => {
    const lease = leaseById.get(row.lease_id as string);
    const unit = lease ? unitById.get(lease.unitId) : undefined;
    const propertyName =
      propertyById.get(row.property_id as string) ?? "Property";
    const unitLabel = unit?.unitNumber
      ? `${propertyName} / Unit ${unit.unitNumber}`
      : propertyName;
    const ledger = ledgerById.get(row.rent_ledger_entry_id as string);
    const method = String(row.payment_method ?? "");
    const status = String(row.status ?? "");
    const collectedAt = String(row.collected_at ?? "");

    return {
      collectionId: row.collection_id as string,
      rentLedgerEntryId: row.rent_ledger_entry_id as string,
      propertyId: row.property_id as string,
      propertyName,
      leaseId: row.lease_id as string,
      lesseeName: lease
        ? (lesseeById.get(lease.lesseeId) ?? "Lessee")
        : "Lessee",
      unitLabel,
      amountGhs: toNumber(row.amount_ghs as number | string | null) ?? 0,
      paymentMethod: method,
      paymentMethodLabel:
        FM_COLLECTION_METHOD_LABELS[method] ?? method.replace(/_/g, " "),
      collectedAt,
      collectedAtLabel: formatMaintenanceDate(collectedAt),
      notes: row.notes ? String(row.notes) : null,
      status,
      statusLabel:
        FM_COLLECTION_STATUS_LABELS[status] ?? status.replace(/_/g, " "),
      rejectionReason: row.rejection_reason
        ? String(row.rejection_reason)
        : null,
      ledgerDescription: ledger?.description ?? null,
    };
  });

  return { rows, error: null };
}

export async function assertFacilityRentLedgerEntryOnAssignedProperty(
  admin: SupabaseClient,
  session: FacilityManagerPortalSession,
  entryId: string,
): Promise<
  | {
      ok: true;
      entryId: string;
      leaseId: string;
      propertyId: string;
      chargeType: string;
      outstandingGhs: number;
    }
  | { ok: false; error: string; status: number }
> {
  const { data: entry, error } = await admin
    .from("rent_ledger")
    .select(
      "entry_id, lease_id, charge_type, amount_due_ghs, amount_paid_ghs, credit_ghs, status",
    )
    .eq("tenant_id", session.tenantId)
    .eq("entry_id", entryId)
    .maybeSingle();

  if (error) {
    return { ok: false, error: error.message, status: 400 };
  }
  if (!entry) {
    return { ok: false, error: "Rent ledger entry not found.", status: 404 };
  }
  if (entry.status === "paid") {
    return { ok: false, error: "This entry is already fully paid.", status: 400 };
  }

  const chargeType = String(entry.charge_type ?? "rent");
  const isRent = chargeType === "rent";
  const isCharge = chargeType === "one_time";
  if (isRent && !session.canCollectRent) {
    return {
      ok: false,
      error: "You do not have permission to collect rent.",
      status: 403,
    };
  }
  if (isCharge && !session.canCollectCharges) {
    return {
      ok: false,
      error: "You do not have permission to collect charges.",
      status: 403,
    };
  }
  if (!isRent && !isCharge) {
    return { ok: false, error: "Unsupported charge type.", status: 400 };
  }

  const leaseCheck = await assertFacilityLeaseOnAssignedProperty(
    admin,
    session,
    entry.lease_id as string,
    { requireActive: true },
  );
  if (!leaseCheck.ok) {
    return { ok: false, error: leaseCheck.error, status: leaseCheck.status };
  }

  const amountDue = toNumber(entry.amount_due_ghs as number | string | null) ?? 0;
  const amountPaid = toNumber(entry.amount_paid_ghs as number | string | null) ?? 0;
  const credit = toNumber(entry.credit_ghs as number | string | null) ?? 0;
  const outstanding = rentOutstandingGhs(amountDue, amountPaid, credit);
  if (outstanding <= 0) {
    return { ok: false, error: "Nothing outstanding on this entry.", status: 400 };
  }

  return {
    ok: true,
    entryId: entry.entry_id as string,
    leaseId: entry.lease_id as string,
    propertyId: leaseCheck.propertyId,
    chargeType,
    outstandingGhs: outstanding,
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
      .eq("status", "pending_landlord_confirmation");
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
