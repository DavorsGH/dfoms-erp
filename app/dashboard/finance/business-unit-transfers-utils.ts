import { getMonthEndDate } from "./capital-contributions-utils";
import {
  addAmountToMonth,
  createEmptyMonthlyTotals,
  FULL_YEAR_INDEX,
  getEntryMonthIndex,
  type MonthlyTotals,
} from "./profit-loss-utils";

export const BUSINESS_UNIT_TRANSFER_SELECT =
  "id, tenant_id, transfer_date, from_business_unit_id, to_business_unit_id, amount, description, reference, created_at, created_by, updated_at";

export type BusinessUnitTransferRecord = {
  id: string;
  tenant_id: string;
  transfer_date: string;
  from_business_unit_id: string;
  to_business_unit_id: string;
  amount: number;
  description: string;
  reference: string | null;
  created_at?: string;
  created_by?: string | null;
  updated_at?: string;
};

export type InterUnitTransferCashScope =
  | { mode: "exclude" }
  | { mode: "unit"; businessUnitId: string };

export function resolveInterUnitTransferCashScope(args: {
  viewAllBusinessUnits: boolean;
  activeBusinessUnitId: string | null;
}): InterUnitTransferCashScope {
  if (args.viewAllBusinessUnits || !args.activeBusinessUnitId) {
    return { mode: "exclude" };
  }
  return { mode: "unit", businessUnitId: args.activeBusinessUnitId };
}

export function interUnitTransferScopeFromReadScope(
  buScope: { mode: "all" | "default" | "unit"; id?: string },
): InterUnitTransferCashScope {
  if (buScope.mode === "unit" && buScope.id) {
    return { mode: "unit", businessUnitId: buScope.id };
  }
  return { mode: "exclude" };
}

function roundCurrency(value: number): number {
  return Math.round(value * 100) / 100;
}

function roundMonthlyTotals(totals: MonthlyTotals): MonthlyTotals {
  return totals.map((value) => roundCurrency(value));
}

function transferDateOnOrBefore(date: string, asOf: string): boolean {
  return date.slice(0, 10) <= asOf.slice(0, 10);
}

export function calculateInterUnitTransferNetForUnitAsOf(
  transfers: BusinessUnitTransferRecord[],
  businessUnitId: string,
  asOfDate: string,
): number {
  let net = 0;
  for (const row of transfers) {
    if (!transferDateOnOrBefore(row.transfer_date, asOfDate)) {
      continue;
    }
    const amount = Number(row.amount) || 0;
    if (row.to_business_unit_id === businessUnitId) {
      net += amount;
    }
    if (row.from_business_unit_id === businessUnitId) {
      net -= amount;
    }
  }
  return roundCurrency(net);
}

export type InterUnitDueLinesByMonth = {
  dueFromOtherBusinessUnits: MonthlyTotals;
  dueToOtherBusinessUnits: MonthlyTotals;
};

export function calculateInterUnitDueLinesByMonth(
  transfers: BusinessUnitTransferRecord[],
  businessUnitId: string,
  financialYear: number,
): InterUnitDueLinesByMonth {
  const dueFromOtherBusinessUnits = createEmptyMonthlyTotals();
  const dueToOtherBusinessUnits = createEmptyMonthlyTotals();

  for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
    const monthEnd = getMonthEndDate(financialYear, monthIndex + 1);
    const net = calculateInterUnitTransferNetForUnitAsOf(
      transfers,
      businessUnitId,
      monthEnd,
    );
    if (net < 0) {
      dueFromOtherBusinessUnits[monthIndex] = roundCurrency(Math.abs(net));
    } else if (net > 0) {
      dueToOtherBusinessUnits[monthIndex] = roundCurrency(net);
    }
  }

  dueFromOtherBusinessUnits[FULL_YEAR_INDEX] = dueFromOtherBusinessUnits[11];
  dueToOtherBusinessUnits[FULL_YEAR_INDEX] = dueToOtherBusinessUnits[11];

  return {
    dueFromOtherBusinessUnits: roundMonthlyTotals(dueFromOtherBusinessUnits),
    dueToOtherBusinessUnits: roundMonthlyTotals(dueToOtherBusinessUnits),
  };
}

export function calculateInterUnitTransferCashInflowsByMonth(
  transfers: BusinessUnitTransferRecord[],
  businessUnitId: string,
  financialYear: number,
): MonthlyTotals {
  const totals = createEmptyMonthlyTotals();

  for (const row of transfers) {
    if (row.to_business_unit_id !== businessUnitId) {
      continue;
    }
    const monthIndex = getEntryMonthIndex(row.transfer_date, financialYear);
    if (monthIndex === null) {
      continue;
    }
    addAmountToMonth(totals, monthIndex, Number(row.amount) || 0);
  }

  return roundMonthlyTotals(totals);
}

export function calculateInterUnitTransferCashOutflowsByMonth(
  transfers: BusinessUnitTransferRecord[],
  businessUnitId: string,
  financialYear: number,
): MonthlyTotals {
  const totals = createEmptyMonthlyTotals();

  for (const row of transfers) {
    if (row.from_business_unit_id !== businessUnitId) {
      continue;
    }
    const monthIndex = getEntryMonthIndex(row.transfer_date, financialYear);
    if (monthIndex === null) {
      continue;
    }
    addAmountToMonth(totals, monthIndex, Number(row.amount) || 0);
  }

  return roundMonthlyTotals(totals);
}

export type InterUnitPairSummary = {
  debtorUnitId: string;
  creditorUnitId: string;
  amount: number;
  label: string;
};

export function buildInterUnitPairSummaries(
  transfers: BusinessUnitTransferRecord[],
  unitNameById: Map<string, string>,
  asOfDate: string,
): InterUnitPairSummary[] {
  const unitIds = new Set<string>();
  for (const row of transfers) {
    if (!transferDateOnOrBefore(row.transfer_date, asOfDate)) {
      continue;
    }
    unitIds.add(row.from_business_unit_id);
    unitIds.add(row.to_business_unit_id);
  }

  const ids = [...unitIds].sort();
  const summaries: InterUnitPairSummary[] = [];

  for (let i = 0; i < ids.length; i += 1) {
    for (let j = i + 1; j < ids.length; j += 1) {
      const unitA = ids[i]!;
      const unitB = ids[j]!;
      const flowAToB = transfers.reduce((sum, row) => {
        if (
          !transferDateOnOrBefore(row.transfer_date, asOfDate) ||
          row.from_business_unit_id !== unitA ||
          row.to_business_unit_id !== unitB
        ) {
          return sum;
        }
        return sum + (Number(row.amount) || 0);
      }, 0);
      const flowBToA = transfers.reduce((sum, row) => {
        if (
          !transferDateOnOrBefore(row.transfer_date, asOfDate) ||
          row.from_business_unit_id !== unitB ||
          row.to_business_unit_id !== unitA
        ) {
          return sum;
        }
        return sum + (Number(row.amount) || 0);
      }, 0);
      const netFromAToB = roundCurrency(flowAToB - flowBToA);
      if (netFromAToB === 0) {
        continue;
      }
      const creditorId = netFromAToB > 0 ? unitA : unitB;
      const debtorId = netFromAToB > 0 ? unitB : unitA;
      const amount = roundCurrency(Math.abs(netFromAToB));
      const debtorName = unitNameById.get(debtorId) ?? debtorId;
      const creditorName = unitNameById.get(creditorId) ?? creditorId;
      summaries.push({
        debtorUnitId: debtorId,
        creditorUnitId: creditorId,
        amount,
        label: `${debtorName} owes ${creditorName}`,
      });
    }
  }

  return summaries.sort((left, right) => left.label.localeCompare(right.label));
}

export function normalizeBusinessUnitTransferRecord(
  row: BusinessUnitTransferRecord,
): BusinessUnitTransferRecord {
  return {
    ...row,
    amount: Number(row.amount) || 0,
    description: row.description ?? "",
    reference: row.reference?.trim() ? row.reference.trim() : null,
  };
}
