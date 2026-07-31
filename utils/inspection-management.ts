import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { assertDavorsManagedLandlord } from "@/utils/maintenance-management";
import {
  isInspectionType,
  normalizeInspectionChecklist,
  normalizePhotoUrls,
  type InspectionLeaseOption,
  type InspectionListRow,
  type InspectionType,
} from "@/app/dashboard/real-estate/inspections-utils";

export type {
  InspectionLeaseOption,
  InspectionListRow,
} from "@/app/dashboard/real-estate/inspections-utils";

/** Leases eligible for inspections: active, or ended within the last 90 days. */
const RECENTLY_ENDED_DAYS = 90;

type InspectionRow = {
  tenant_id: string;
  inspection_id: string;
  lease_id: string;
  inspection_type: string;
  inspection_date: string;
  conducted_by: string | null;
  checklist: unknown;
  photo_urls: unknown;
  notes: string | null;
};

function isRecentlyEnded(
  endDate: string | null | undefined,
  terminatedAt: string | null | undefined,
  cutoffIsoDate: string,
): boolean {
  const candidates = [endDate, terminatedAt]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.slice(0, 10));
  return candidates.some((value) => value >= cutoffIsoDate);
}

export async function fetchInspectionLeaseOptionsForLandlord(
  admin: SupabaseClient,
  tenantId: string,
): Promise<{ leases: InspectionLeaseOption[]; fetchError: string | null }> {
  const landlord = await assertDavorsManagedLandlord(admin, tenantId);
  if (!landlord.ok) {
    return { leases: [], fetchError: landlord.error };
  }

  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RECENTLY_ENDED_DAYS);
  const cutoffIsoDate = cutoff.toISOString().slice(0, 10);

  const [
    { data: leases, error: leasesError },
    { data: units, error: unitsError },
    { data: properties, error: propertiesError },
    { data: lessees, error: lesseesError },
  ] = await Promise.all([
    admin
      .from("leases")
      .select(
        "lease_id, unit_id, lessee_id, status, end_date, terminated_at, created_at",
      )
      .eq("tenant_id", landlord.tenantId)
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

  const options: InspectionLeaseOption[] = [];
  for (const row of (leases as Array<{
    lease_id: string;
    unit_id: string;
    lessee_id: string;
    status: string;
    end_date: string | null;
    terminated_at: string | null;
  }> | null) ?? []) {
    const isActive = row.status === "active";
    const isEnded =
      row.status === "terminated_early" || row.status === "expired";
    if (
      !isActive &&
      !(isEnded && isRecentlyEnded(row.end_date, row.terminated_at, cutoffIsoDate))
    ) {
      continue;
    }

    const unit = unitById.get(row.unit_id);
    const propertyName = unit
      ? (propertyNameById.get(unit.property_id) ?? "—")
      : "—";
    const unitNumber = unit?.unit_number ?? "—";
    const lesseeName = lesseeNameById.get(row.lessee_id) ?? "—";
    const statusLabel = isActive ? "Active" : "Ended";
    options.push({
      leaseId: row.lease_id,
      label: `${lesseeName} · ${propertyName} / Unit ${unitNumber} (${statusLabel})`,
    });
  }

  return { leases: options, fetchError: null };
}

export async function fetchInspectionsForLandlord(
  admin: SupabaseClient,
  tenantId: string,
): Promise<{ rows: InspectionListRow[]; fetchError: string | null }> {
  const landlord = await assertDavorsManagedLandlord(admin, tenantId);
  if (!landlord.ok) {
    return { rows: [], fetchError: landlord.error };
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
        "tenant_id, inspection_id, lease_id, inspection_type, inspection_date, conducted_by, checklist, photo_urls, notes",
      )
      .eq("tenant_id", landlord.tenantId)
      .order("inspection_date", { ascending: false }),
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

  if (inspectionsError) {
    return { rows: [], fetchError: inspectionsError.message };
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

  const rows: InspectionListRow[] = [];
  for (const row of (inspections as InspectionRow[] | null) ?? []) {
    if (!isInspectionType(row.inspection_type)) {
      continue;
    }

    const lease = leaseById.get(row.lease_id);
    const unit = lease ? unitById.get(lease.unit_id) : undefined;
    const propertyName = unit
      ? (propertyNameById.get(unit.property_id) ?? "—")
      : "—";
    const unitNumber = unit?.unit_number ?? "—";

    rows.push({
      inspectionId: row.inspection_id,
      tenantId: row.tenant_id,
      leaseId: row.lease_id,
      lesseeName: lease
        ? (lesseeNameById.get(lease.lessee_id) ?? "—")
        : "—",
      unitLabel: `${propertyName} / Unit ${unitNumber}`,
      inspectionType: row.inspection_type as InspectionType,
      inspectionDate: row.inspection_date,
      conductedBy: row.conducted_by,
      notes: row.notes,
      checklist: normalizeInspectionChecklist(row.checklist),
      photoUrls: normalizePhotoUrls(row.photo_urls),
    });
  }

  return { rows, fetchError: null };
}
