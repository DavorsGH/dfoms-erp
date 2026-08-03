import {
  formatUnitStatus,
  type UnitStatus,
} from "../real-estate/properties-utils";
import { rentOutstandingGhs, isActiveLeaseStatus } from "../real-estate/rent-ledger-utils";
import {
  formatReportPeriodLabel,
  getDefaultReportMonthYear,
} from "./finance-reports-utils";

export type ReReportLandlordOption = {
  tenantId: string;
  name: string;
};

export type ReReportPropertyOption = {
  propertyId: string;
  tenantId: string;
  name: string;
};

export type ReReportUnitRow = {
  unitId: string;
  tenantId: string;
  landlordName: string;
  propertyId: string;
  propertyName: string;
  unitNumber: string;
  status: UnitStatus;
};

export type ReReportLedgerRow = {
  entryId: string;
  tenantId: string;
  landlordName: string;
  leaseId: string;
  propertyId: string;
  propertyName: string;
  unitNumber: string;
  lesseeName: string;
  periodStart: string;
  periodEnd: string;
  amountDueGhs: number;
  amountPaidGhs: number;
  creditGhs: number;
  paymentDate: string | null;
  leaseStatus: string;
};

export type ReArrearsBucketKey =
  | "current"
  | "1-30"
  | "31-60"
  | "61+";

export const RE_ARREARS_BUCKET_LABELS: Record<ReArrearsBucketKey, string> = {
  current: "Current (not yet due)",
  "1-30": "1–30 days overdue",
  "31-60": "31–60 days overdue",
  "61+": "61+ days overdue",
};

export function buildAvailableReReportYears(
  ...dateLists: Array<Array<string | null | undefined>>
): number[] {
  const years = new Set<number>();
  const defaults = getDefaultReportMonthYear();
  years.add(defaults.year);

  for (const list of dateLists) {
    for (const value of list) {
      if (!value) continue;
      const year = Number(String(value).slice(0, 4));
      if (Number.isFinite(year) && year >= 2000 && year <= 2100) {
        years.add(year);
      }
    }
  }

  return [...years].sort((a, b) => b - a);
}

export function periodBoundsIso(
  year: number,
  month: number,
): { start: string; end: string } {
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const end = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return { start, end };
}

export function filterUnitsByLandlordProperty(
  units: ReReportUnitRow[],
  landlordId: string,
  propertyId: string,
): ReReportUnitRow[] {
  return units.filter((unit) => {
    if (landlordId && unit.tenantId !== landlordId) return false;
    if (propertyId && unit.propertyId !== propertyId) return false;
    return true;
  });
}

export function filterLedgerByLandlordProperty(
  rows: ReReportLedgerRow[],
  landlordId: string,
  propertyId: string,
): ReReportLedgerRow[] {
  return rows.filter((row) => {
    if (landlordId && row.tenantId !== landlordId) return false;
    if (propertyId && row.propertyId !== propertyId) return false;
    return true;
  });
}

export function propertiesForLandlord(
  properties: ReReportPropertyOption[],
  landlordId: string,
): ReReportPropertyOption[] {
  if (!landlordId) return properties;
  return properties.filter((property) => property.tenantId === landlordId);
}

function roundPct(value: number): number {
  return Math.round(value * 10) / 10;
}

function countUnitStatuses(units: ReReportUnitRow[]) {
  let occupied = 0;
  let vacant = 0;
  let underMaintenance = 0;

  for (const unit of units) {
    if (unit.status === "occupied") occupied += 1;
    else if (unit.status === "vacant") vacant += 1;
    else if (unit.status === "under_maintenance") underMaintenance += 1;
  }

  const total = units.length;
  return { occupied, vacant, underMaintenance, total };
}

/**
 * Vacancy rate = vacant / total.
 * under_maintenance is its own bucket and is never treated as vacant.
 */
export function buildVacancyRateReport(units: ReReportUnitRow[]) {
  const counts = countUnitStatuses(units);
  const vacancyRatePct =
    counts.total === 0 ? 0 : roundPct((counts.vacant / counts.total) * 100);

  const detailRows = [...units]
    .sort((a, b) => {
      const landlordCmp = a.landlordName.localeCompare(b.landlordName);
      if (landlordCmp !== 0) return landlordCmp;
      const propertyCmp = a.propertyName.localeCompare(b.propertyName);
      if (propertyCmp !== 0) return propertyCmp;
      return a.unitNumber.localeCompare(b.unitNumber, undefined, {
        numeric: true,
      });
    })
    .map((unit) => ({
      unitId: unit.unitId,
      landlordName: unit.landlordName,
      propertyName: unit.propertyName,
      unitNumber: unit.unitNumber,
      status: unit.status,
      statusLabel: formatUnitStatus(unit.status),
    }));

  return {
    ...counts,
    vacancyRatePct,
    detailRows,
  };
}

/**
 * Occupancy % by property, with vacant and under_maintenance counts.
 */
export function buildOccupancyReport(units: ReReportUnitRow[]) {
  const byProperty = new Map<
    string,
    {
      propertyId: string;
      landlordName: string;
      propertyName: string;
      occupied: number;
      vacant: number;
      underMaintenance: number;
      total: number;
    }
  >();

  for (const unit of units) {
    const key = `${unit.tenantId}:${unit.propertyId}`;
    const current = byProperty.get(key) ?? {
      propertyId: unit.propertyId,
      landlordName: unit.landlordName,
      propertyName: unit.propertyName,
      occupied: 0,
      vacant: 0,
      underMaintenance: 0,
      total: 0,
    };
    current.total += 1;
    if (unit.status === "occupied") current.occupied += 1;
    else if (unit.status === "vacant") current.vacant += 1;
    else if (unit.status === "under_maintenance") current.underMaintenance += 1;
    byProperty.set(key, current);
  }

  const rows = [...byProperty.values()]
    .map((row) => ({
      ...row,
      occupancyRatePct:
        row.total === 0 ? 0 : roundPct((row.occupied / row.total) * 100),
    }))
    .sort((a, b) => {
      const landlordCmp = a.landlordName.localeCompare(b.landlordName);
      if (landlordCmp !== 0) return landlordCmp;
      return a.propertyName.localeCompare(b.propertyName);
    });

  const totals = countUnitStatuses(units);
  const occupancyRatePct =
    totals.total === 0
      ? 0
      : roundPct((totals.occupied / totals.total) * 100);

  return {
    rows,
    totals: {
      ...totals,
      occupancyRatePct,
    },
  };
}

/**
 * Same aging buckets as landlord portal finance summary:
 * age from period_end vs today; Current when period_end >= today or ageDays <= 0.
 */
export function resolveReArrearsBucket(
  periodEnd: string,
  today: Date = new Date(),
): { bucket: ReArrearsBucketKey; ageDays: number } {
  const todayIso = today.toISOString().slice(0, 10);
  const periodEndDate = new Date(`${periodEnd}T00:00:00`);
  const ageDays = Number.isNaN(periodEndDate.getTime())
    ? 0
    : Math.max(
        0,
        Math.floor(
          (today.getTime() - periodEndDate.getTime()) / (1000 * 60 * 60 * 24),
        ),
      );

  if (periodEnd >= todayIso || ageDays <= 0) {
    return { bucket: "current", ageDays };
  }
  if (ageDays <= 30) {
    return { bucket: "1-30", ageDays };
  }
  if (ageDays <= 60) {
    return { bucket: "31-60", ageDays };
  }
  return { bucket: "61+", ageDays };
}

export function buildArrearsAgingReport(
  ledgerRows: ReReportLedgerRow[],
  today: Date = new Date(),
) {
  const buckets: Record<ReArrearsBucketKey, number> = {
    current: 0,
    "1-30": 0,
    "31-60": 0,
    "61+": 0,
  };

  const detailRows: Array<{
    entryId: string;
    landlordName: string;
    propertyName: string;
    unitNumber: string;
    lesseeName: string;
    leaseId: string;
    periodStart: string;
    periodEnd: string;
    amountDueGhs: number;
    amountPaidGhs: number;
    creditGhs: number;
    outstandingGhs: number;
    ageDays: number;
    bucket: ReArrearsBucketKey;
    bucketLabel: string;
  }> = [];

  let totalOutstandingGhs = 0;

  for (const row of ledgerRows) {
    if (!isActiveLeaseStatus(row.leaseStatus)) {
      continue;
    }

    const outstandingGhs = rentOutstandingGhs(
      row.amountDueGhs,
      row.amountPaidGhs,
      row.creditGhs,
    );
    if (outstandingGhs <= 0) continue;

    const { bucket, ageDays } = resolveReArrearsBucket(row.periodEnd, today);
    buckets[bucket] += outstandingGhs;
    totalOutstandingGhs += outstandingGhs;

    detailRows.push({
      entryId: row.entryId,
      landlordName: row.landlordName,
      propertyName: row.propertyName,
      unitNumber: row.unitNumber,
      lesseeName: row.lesseeName,
      leaseId: row.leaseId,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      amountDueGhs: row.amountDueGhs,
      amountPaidGhs: row.amountPaidGhs,
      creditGhs: row.creditGhs,
      outstandingGhs,
      ageDays,
      bucket,
      bucketLabel: RE_ARREARS_BUCKET_LABELS[bucket],
    });
  }

  detailRows.sort((a, b) => {
    const bucketOrder: ReArrearsBucketKey[] = [
      "61+",
      "31-60",
      "1-30",
      "current",
    ];
    const bucketCmp =
      bucketOrder.indexOf(a.bucket) - bucketOrder.indexOf(b.bucket);
    if (bucketCmp !== 0) return bucketCmp;
    return b.ageDays - a.ageDays;
  });

  return {
    buckets,
    totalOutstandingGhs:
      Math.round((totalOutstandingGhs + Number.EPSILON) * 100) / 100,
    detailRows,
  };
}

/**
 * Income by property for a calendar month:
 * - Due: rent_ledger rows whose period_start falls in the month
 * - Collected: amount_paid where payment_date falls in the month
 * - Outstanding: rentOutstandingGhs on Due rows
 * - Collection %: Collected / Due
 */
export function buildIncomeByPropertyReport(
  ledgerRows: ReReportLedgerRow[],
  year: number,
  month: number,
) {
  const { start, end } = periodBoundsIso(year, month);
  const byProperty = new Map<
    string,
    {
      propertyId: string;
      landlordName: string;
      propertyName: string;
      dueGhs: number;
      collectedGhs: number;
      outstandingGhs: number;
    }
  >();

  function ensure(row: ReReportLedgerRow) {
    const key = `${row.tenantId}:${row.propertyId}`;
    const current = byProperty.get(key) ?? {
      propertyId: row.propertyId,
      landlordName: row.landlordName,
      propertyName: row.propertyName,
      dueGhs: 0,
      collectedGhs: 0,
      outstandingGhs: 0,
    };
    byProperty.set(key, current);
    return current;
  }

  for (const row of ledgerRows) {
    const inPeriod =
      row.periodStart >= start && row.periodStart <= end;
    const paidInPeriod =
      !!row.paymentDate &&
      row.paymentDate >= start &&
      row.paymentDate <= end;

    if (!inPeriod && !paidInPeriod) continue;

    const current = ensure(row);
    if (inPeriod) {
      current.dueGhs += row.amountDueGhs;
      if (isActiveLeaseStatus(row.leaseStatus)) {
        current.outstandingGhs += rentOutstandingGhs(
          row.amountDueGhs,
          row.amountPaidGhs,
          row.creditGhs,
        );
      }
    }
    if (paidInPeriod) {
      current.collectedGhs += row.amountPaidGhs;
    }
  }

  const rows = [...byProperty.values()]
    .map((row) => {
      const dueGhs =
        Math.round((row.dueGhs + Number.EPSILON) * 100) / 100;
      const collectedGhs =
        Math.round((row.collectedGhs + Number.EPSILON) * 100) / 100;
      const outstandingGhs =
        Math.round((row.outstandingGhs + Number.EPSILON) * 100) / 100;
      const collectionPct =
        dueGhs === 0 ? 0 : roundPct((collectedGhs / dueGhs) * 100);
      return {
        ...row,
        dueGhs,
        collectedGhs,
        outstandingGhs,
        collectionPct,
      };
    })
    .sort((a, b) => {
      const landlordCmp = a.landlordName.localeCompare(b.landlordName);
      if (landlordCmp !== 0) return landlordCmp;
      return a.propertyName.localeCompare(b.propertyName);
    });

  const totals = rows.reduce(
    (acc, row) => {
      acc.dueGhs += row.dueGhs;
      acc.collectedGhs += row.collectedGhs;
      acc.outstandingGhs += row.outstandingGhs;
      return acc;
    },
    { dueGhs: 0, collectedGhs: 0, outstandingGhs: 0 },
  );

  const dueGhs = Math.round((totals.dueGhs + Number.EPSILON) * 100) / 100;
  const collectedGhs =
    Math.round((totals.collectedGhs + Number.EPSILON) * 100) / 100;
  const outstandingGhs =
    Math.round((totals.outstandingGhs + Number.EPSILON) * 100) / 100;

  return {
    periodLabel: formatReportPeriodLabel(year, month),
    rows,
    totals: {
      dueGhs,
      collectedGhs,
      outstandingGhs,
      collectionPct:
        dueGhs === 0 ? 0 : roundPct((collectedGhs / dueGhs) * 100),
    },
  };
}
