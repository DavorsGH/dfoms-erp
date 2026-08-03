import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { assertRealEstateLandlordTenant } from "@/utils/property-management";
import { fetchLeasesForLandlord } from "@/utils/lease-management";
import { fetchRentLedgerForLandlord } from "@/utils/rent-ledger-management";
import { fetchMaintenanceRequestsForLandlord } from "@/utils/maintenance-management";
import { fetchInspectionsForLandlord } from "@/utils/inspection-management";
import { normalizePhotoUrls } from "@/app/dashboard/real-estate/properties-utils";
import {
  isLesseeStatus,
  type LesseeActiveLeaseSummary,
  type LesseeDepositSummary,
  type LesseeDetail,
  type LesseeListRow,
  type LesseeStatus,
} from "@/app/dashboard/real-estate/lessees-utils";

export type {
  LesseeDetail,
  LesseeListRow,
  LesseeStatus,
} from "@/app/dashboard/real-estate/lessees-utils";

type LesseeRow = {
  tenant_id: string;
  lessee_id: string;
  full_name: string;
  email: string | null;
  phone: string;
  status: string;
  private_notes: string | null;
  photo_url?: string | null;
  created_at: string;
  updated_at: string;
};

type DepositRow = {
  tenant_id: string;
  deposit_id: string;
  lease_id: string;
  amount_ghs: number | string;
  status: string;
  amount_returned_ghs: number | string | null;
  date_collected: string;
  date_resolved: string | null;
  resolution_notes: string | null;
};

function toNumber(value: number | string | null | undefined): number | null {
  if (value == null || value === "") {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function mapLessee(row: LesseeRow): LesseeListRow | null {
  if (!isLesseeStatus(row.status)) {
    return null;
  }

  return {
    lesseeId: row.lessee_id,
    tenantId: row.tenant_id,
    fullName: row.full_name,
    phone: row.phone,
    email: row.email,
    status: row.status,
    privateNotes: row.private_notes,
    createdAt: row.created_at,
  };
}

export async function fetchLesseesForLandlord(
  admin: SupabaseClient,
  tenantId: string,
): Promise<{ rows: LesseeListRow[]; fetchError: string | null }> {
  const landlord = await assertRealEstateLandlordTenant(admin, tenantId);
  if (!landlord.ok) {
    return { rows: [], fetchError: landlord.error };
  }

  const { data, error } = await admin
    .from("lessees")
    .select(
      "tenant_id, lessee_id, full_name, email, phone, status, private_notes, created_at, updated_at",
    )
    .eq("tenant_id", landlord.tenantId)
    .order("created_at", { ascending: false });

  if (error) {
    return { rows: [], fetchError: error.message };
  }

  const rows: LesseeListRow[] = [];
  for (const row of (data as LesseeRow[] | null) ?? []) {
    const mapped = mapLessee(row);
    if (mapped) {
      rows.push(mapped);
    }
  }

  return { rows, fetchError: null };
}

/**
 * Full tenant (lessee) detail for staff: profile + related lease records.
 * Reuses landlord-scoped rent/maintenance/inspection fetchers, then filters
 * to this lessee’s lease IDs.
 */
export async function fetchLesseeDetail(
  admin: SupabaseClient,
  tenantId: string,
  lesseeId: string,
): Promise<{ detail: LesseeDetail | null; fetchError: string | null }> {
  const landlord = await assertRealEstateLandlordTenant(admin, tenantId);
  if (!landlord.ok) {
    return { detail: null, fetchError: landlord.error };
  }

  const trimmedLesseeId = lesseeId.trim();
  if (!trimmedLesseeId) {
    return { detail: null, fetchError: "lessee_id is required" };
  }

  const { data: lessee, error: lesseeError } = await admin
    .from("lessees")
    .select(
      "tenant_id, lessee_id, full_name, email, phone, status, private_notes, photo_url, created_at, updated_at",
    )
    .eq("tenant_id", landlord.tenantId)
    .eq("lessee_id", trimmedLesseeId)
    .maybeSingle();

  if (lesseeError) {
    return { detail: null, fetchError: lesseeError.message };
  }
  if (!lessee) {
    return { detail: null, fetchError: null };
  }

  const lesseeRow = lessee as LesseeRow;
  if (!isLesseeStatus(lesseeRow.status)) {
    return { detail: null, fetchError: "Invalid lessee status on record." };
  }

  const [
    leasesResult,
    rentResult,
    maintenanceResult,
    inspectionsResult,
  ] = await Promise.all([
    fetchLeasesForLandlord(admin, landlord.tenantId),
    fetchRentLedgerForLandlord(admin, landlord.tenantId, {
      activeLeasesOnly: false,
    }),
    fetchMaintenanceRequestsForLandlord(admin, landlord.tenantId),
    fetchInspectionsForLandlord(admin, landlord.tenantId),
  ]);

  if (leasesResult.fetchError) {
    return { detail: null, fetchError: leasesResult.fetchError };
  }
  if (rentResult.fetchError) {
    return { detail: null, fetchError: rentResult.fetchError };
  }
  if (maintenanceResult.fetchError) {
    return { detail: null, fetchError: maintenanceResult.fetchError };
  }
  if (inspectionsResult.fetchError) {
    return { detail: null, fetchError: inspectionsResult.fetchError };
  }

  const lesseeLeases = leasesResult.rows.filter(
    (row) => row.lesseeId === trimmedLesseeId,
  );

  // Enrich with propertyId for hero photo / property links (not on LeaseListRow).
  const unitIds = [...new Set(lesseeLeases.map((row) => row.unitId))];
  const unitPropertyById = new Map<
    string,
    { propertyId: string; unitNumber: string }
  >();

  if (unitIds.length > 0) {
    const { data: units, error: unitsError } = await admin
      .from("property_units")
      .select("unit_id, unit_number, property_id")
      .eq("tenant_id", landlord.tenantId)
      .in("unit_id", unitIds);

    if (unitsError) {
      return { detail: null, fetchError: unitsError.message };
    }

    for (const unit of (units as Array<{
      unit_id: string;
      unit_number: string;
      property_id: string;
    }> | null) ?? []) {
      unitPropertyById.set(unit.unit_id, {
        propertyId: unit.property_id,
        unitNumber: unit.unit_number,
      });
    }
  }

  const leaseSummaries: LesseeActiveLeaseSummary[] = lesseeLeases.map(
    (row) => {
      const unitMeta = unitPropertyById.get(row.unitId);
      return {
        leaseId: row.leaseId,
        unitId: row.unitId,
        unitNumber: row.unitNumber,
        propertyId: unitMeta?.propertyId ?? null,
        propertyName: row.propertyName,
        startDate: row.startDate,
        endDate: row.endDate,
        rentAmountGhs: row.rentAmountGhs,
        status: row.status,
      };
    },
  );

  const activeLease =
    leaseSummaries.find((row) => row.status === "active") ??
    leaseSummaries[0] ??
    null;

  const leaseIds = new Set(leaseSummaries.map((row) => row.leaseId));
  const unitLabelByLeaseId = new Map(
    leaseSummaries.map((row) => [
      row.leaseId,
      `${row.propertyName} — ${row.unitNumber}`,
    ]),
  );

  const rentLedger = rentResult.rows.filter((row) => leaseIds.has(row.leaseId));
  const maintenance = maintenanceResult.rows.filter((row) =>
    leaseIds.has(row.leaseId),
  );
  const inspections = inspectionsResult.rows.filter((row) =>
    leaseIds.has(row.leaseId),
  );

  // No landlord-scoped deposit list utility exists — query by lease IDs.
  const deposits: LesseeDepositSummary[] = [];
  if (leaseIds.size > 0) {
    const { data: depositRows, error: depositsError } = await admin
      .from("security_deposits")
      .select(
        "tenant_id, deposit_id, lease_id, amount_ghs, status, amount_returned_ghs, date_collected, date_resolved, resolution_notes",
      )
      .eq("tenant_id", landlord.tenantId)
      .in("lease_id", [...leaseIds])
      .order("created_at", { ascending: false });

    if (depositsError) {
      return { detail: null, fetchError: depositsError.message };
    }

    for (const row of (depositRows as DepositRow[] | null) ?? []) {
      deposits.push({
        depositId: row.deposit_id,
        leaseId: row.lease_id,
        unitLabel: unitLabelByLeaseId.get(row.lease_id) ?? "—",
        amountGhs: toNumber(row.amount_ghs) ?? 0,
        status: row.status,
        amountReturnedGhs: toNumber(row.amount_returned_ghs),
        dateCollected: row.date_collected,
        dateResolved: row.date_resolved,
        resolutionNotes: row.resolution_notes,
      });
    }
  }

  let propertyHeroPhotoUrl: string | null = null;
  let propertyHeroPropertyId: string | null = null;
  let propertyHeroPropertyName: string | null = null;

  if (activeLease?.propertyId) {
    propertyHeroPropertyId = activeLease.propertyId;
    propertyHeroPropertyName = activeLease.propertyName;
    const { data: property, error: propertyError } = await admin
      .from("properties")
      .select("property_id, name, photo_urls")
      .eq("tenant_id", landlord.tenantId)
      .eq("property_id", activeLease.propertyId)
      .maybeSingle();

    if (propertyError) {
      return { detail: null, fetchError: propertyError.message };
    }

    const urls = normalizePhotoUrls(property?.photo_urls);
    propertyHeroPhotoUrl = urls[0] ?? null;
    if (property?.name) {
      propertyHeroPropertyName = property.name as string;
    }
  }

  return {
    detail: {
      lesseeId: lesseeRow.lessee_id,
      tenantId: lesseeRow.tenant_id,
      landlordName: landlord.name,
      fullName: lesseeRow.full_name,
      phone: lesseeRow.phone,
      email: lesseeRow.email,
      status: lesseeRow.status,
      privateNotes: lesseeRow.private_notes,
      createdAt: lesseeRow.created_at,
      updatedAt: lesseeRow.updated_at,
      photoUrl: lesseeRow.photo_url?.trim() || null,
      propertyHeroPhotoUrl,
      propertyHeroPropertyId,
      propertyHeroPropertyName,
      activeLease,
      leases: leaseSummaries,
      deposits,
      rentLedger,
      maintenance,
      inspections,
    },
    fetchError: null,
  };
}
