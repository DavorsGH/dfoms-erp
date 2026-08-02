import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { filterDavorsManagedLandlords } from "@/app/dashboard/real-estate/landlords-utils";
import { isUnitStatus } from "@/app/dashboard/real-estate/properties-utils";
import { fetchLandlordListRows } from "@/utils/landlord-management";
import {
  buildAvailableReReportYears,
  type ReReportLandlordOption,
  type ReReportLedgerRow,
  type ReReportPropertyOption,
  type ReReportUnitRow,
} from "./real-estate-reports-utils";

type UnitDbRow = {
  unit_id: string;
  tenant_id: string;
  property_id: string;
  unit_number: string;
  status: string;
};

type PropertyDbRow = {
  property_id: string;
  tenant_id: string;
  name: string;
};

type LeaseDbRow = {
  lease_id: string;
  tenant_id: string;
  unit_id: string;
  lessee_id: string;
};

type LesseeDbRow = {
  lessee_id: string;
  tenant_id: string;
  full_name: string;
};

type LedgerDbRow = {
  entry_id: string;
  tenant_id: string;
  lease_id: string;
  period_start: string;
  period_end: string;
  amount_due_ghs: number | string;
  amount_paid_ghs: number | string;
  credit_ghs?: number | string | null;
  payment_date: string | null;
};

/**
 * Staff: all Davors-managed landlords.
 * Portal: single logged-in landlord tenant (any landlord_type).
 */
export type ReReportDataScope =
  | { kind: "davors_managed" }
  | { kind: "tenant"; tenantId: string; landlordName: string };

function toNumber(value: number | string | null | undefined): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

async function resolveReportScope(
  admin: SupabaseClient,
  scope: ReReportDataScope,
) {
  if (scope.kind === "tenant") {
    const landlordOptions: ReReportLandlordOption[] = [
      { tenantId: scope.tenantId, name: scope.landlordName },
    ];
    return {
      landlordOptions,
      tenantIds: [scope.tenantId],
      landlordNameById: new Map([[scope.tenantId, scope.landlordName]]),
      landlordsError: null as string | null,
    };
  }

  const { rows: allLandlords, fetchError: landlordsError } =
    await fetchLandlordListRows(admin);
  const landlords = filterDavorsManagedLandlords(allLandlords);
  const landlordOptions: ReReportLandlordOption[] = landlords
    .map((row) => ({ tenantId: row.tenantId, name: row.name }))
    .sort((a, b) => a.name.localeCompare(b.name));
  const tenantIds = landlordOptions.map((row) => row.tenantId);
  const landlordNameById = new Map(
    landlordOptions.map((row) => [row.tenantId, row.name]),
  );

  return {
    landlordOptions,
    tenantIds,
    landlordNameById,
    landlordsError,
  };
}

export async function fetchVacancyOccupancyReportData(
  admin: SupabaseClient,
  scope: ReReportDataScope = { kind: "davors_managed" },
) {
  const { landlordOptions, tenantIds, landlordNameById, landlordsError } =
    await resolveReportScope(admin, scope);

  if (landlordsError) {
    return {
      landlords: landlordOptions,
      properties: [] as ReReportPropertyOption[],
      units: [] as ReReportUnitRow[],
      fetchError: landlordsError,
    };
  }

  if (tenantIds.length === 0) {
    return {
      landlords: landlordOptions,
      properties: [] as ReReportPropertyOption[],
      units: [] as ReReportUnitRow[],
      fetchError: null,
    };
  }

  const [
    { data: properties, error: propertiesError },
    { data: units, error: unitsError },
  ] = await Promise.all([
    admin
      .from("properties")
      .select("property_id, tenant_id, name")
      .in("tenant_id", tenantIds)
      .order("name", { ascending: true }),
    admin
      .from("property_units")
      .select("unit_id, tenant_id, property_id, unit_number, status")
      .in("tenant_id", tenantIds)
      .order("unit_number", { ascending: true }),
  ]);

  if (propertiesError || unitsError) {
    return {
      landlords: landlordOptions,
      properties: [] as ReReportPropertyOption[],
      units: [] as ReReportUnitRow[],
      fetchError: propertiesError?.message ?? unitsError?.message ?? null,
    };
  }

  const propertyOptions: ReReportPropertyOption[] = (
    (properties as PropertyDbRow[] | null) ?? []
  ).map((row) => ({
    propertyId: row.property_id,
    tenantId: row.tenant_id,
    name: row.name,
  }));

  const propertyNameById = new Map(
    propertyOptions.map((row) => [row.propertyId, row.name]),
  );

  const unitRows: ReReportUnitRow[] = [];
  for (const row of (units as UnitDbRow[] | null) ?? []) {
    if (!isUnitStatus(row.status)) continue;
    unitRows.push({
      unitId: row.unit_id,
      tenantId: row.tenant_id,
      landlordName: landlordNameById.get(row.tenant_id) ?? "—",
      propertyId: row.property_id,
      propertyName: propertyNameById.get(row.property_id) ?? "—",
      unitNumber: row.unit_number,
      status: row.status,
    });
  }

  return {
    landlords: landlordOptions,
    properties: propertyOptions,
    units: unitRows,
    fetchError: null,
  };
}

export async function fetchArrearsIncomeReportData(
  admin: SupabaseClient,
  scope: ReReportDataScope = { kind: "davors_managed" },
) {
  const { landlordOptions, tenantIds, landlordNameById, landlordsError } =
    await resolveReportScope(admin, scope);

  if (landlordsError) {
    return {
      landlords: landlordOptions,
      properties: [] as ReReportPropertyOption[],
      ledgerRows: [] as ReReportLedgerRow[],
      availableYears: buildAvailableReReportYears(),
      fetchError: landlordsError,
    };
  }

  if (tenantIds.length === 0) {
    return {
      landlords: landlordOptions,
      properties: [] as ReReportPropertyOption[],
      ledgerRows: [] as ReReportLedgerRow[],
      availableYears: buildAvailableReReportYears(),
      fetchError: null,
    };
  }

  const [
    { data: properties, error: propertiesError },
    { data: units, error: unitsError },
    { data: leases, error: leasesError },
    { data: lessees, error: lesseesError },
    { data: ledger, error: ledgerError },
  ] = await Promise.all([
    admin
      .from("properties")
      .select("property_id, tenant_id, name")
      .in("tenant_id", tenantIds)
      .order("name", { ascending: true }),
    admin
      .from("property_units")
      .select("unit_id, tenant_id, property_id, unit_number, status")
      .in("tenant_id", tenantIds),
    admin
      .from("leases")
      .select("lease_id, tenant_id, unit_id, lessee_id")
      .in("tenant_id", tenantIds),
    admin
      .from("lessees")
      .select("lessee_id, tenant_id, full_name")
      .in("tenant_id", tenantIds),
    admin
      .from("rent_ledger")
      .select(
        "entry_id, tenant_id, lease_id, period_start, period_end, amount_due_ghs, amount_paid_ghs, credit_ghs, payment_date",
      )
      .in("tenant_id", tenantIds)
      .order("period_start", { ascending: false }),
  ]);

  const fetchError =
    propertiesError?.message ??
    unitsError?.message ??
    leasesError?.message ??
    lesseesError?.message ??
    ledgerError?.message ??
    null;

  if (fetchError) {
    return {
      landlords: landlordOptions,
      properties: [] as ReReportPropertyOption[],
      ledgerRows: [] as ReReportLedgerRow[],
      availableYears: buildAvailableReReportYears(),
      fetchError,
    };
  }

  const propertyOptions: ReReportPropertyOption[] = (
    (properties as PropertyDbRow[] | null) ?? []
  ).map((row) => ({
    propertyId: row.property_id,
    tenantId: row.tenant_id,
    name: row.name,
  }));

  const propertyNameById = new Map(
    propertyOptions.map((row) => [row.propertyId, row.name]),
  );

  const unitById = new Map(
    ((units as UnitDbRow[] | null) ?? []).map((row) => [
      row.unit_id,
      {
        unitNumber: row.unit_number,
        propertyId: row.property_id,
      },
    ]),
  );

  const lesseeNameById = new Map(
    ((lessees as LesseeDbRow[] | null) ?? []).map((row) => [
      row.lessee_id,
      row.full_name,
    ]),
  );

  const leaseById = new Map(
    ((leases as LeaseDbRow[] | null) ?? []).map((row) => [
      row.lease_id,
      {
        unitId: row.unit_id,
        lesseeId: row.lessee_id,
      },
    ]),
  );

  const ledgerRows: ReReportLedgerRow[] = [];
  for (const row of (ledger as LedgerDbRow[] | null) ?? []) {
    const lease = leaseById.get(row.lease_id);
    const unit = lease ? unitById.get(lease.unitId) : undefined;
    const propertyId = unit?.propertyId ?? "";
    ledgerRows.push({
      entryId: row.entry_id,
      tenantId: row.tenant_id,
      landlordName: landlordNameById.get(row.tenant_id) ?? "—",
      leaseId: row.lease_id,
      propertyId,
      propertyName: propertyNameById.get(propertyId) ?? "—",
      unitNumber: unit?.unitNumber ?? "—",
      lesseeName: lease
        ? (lesseeNameById.get(lease.lesseeId) ?? "—")
        : "—",
      periodStart: row.period_start,
      periodEnd: row.period_end,
      amountDueGhs: toNumber(row.amount_due_ghs),
      amountPaidGhs: toNumber(row.amount_paid_ghs),
      creditGhs: toNumber(row.credit_ghs),
      paymentDate: row.payment_date,
    });
  }

  return {
    landlords: landlordOptions,
    properties: propertyOptions,
    ledgerRows,
    availableYears: buildAvailableReReportYears(
      ledgerRows.map((row) => row.periodStart),
      ledgerRows.map((row) => row.paymentDate),
    ),
    fetchError: null,
  };
}
