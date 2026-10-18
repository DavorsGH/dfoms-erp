import {
  addAmountToMonth,
  createEmptyMonthlyTotals,
  getEntryMonthIndex,
  type MonthlyTotals,
} from "@/app/dashboard/finance/profit-loss-utils";
import { inventoryMovementAmountFromQtyCost } from "@/lib/inventory/inventory-movement-amount";
import { resolveBalanceSheetEntryMonthIndex } from "@/lib/finance/balance-sheet-reference-date";
import {
  extractYearFromDate,
  MIN_FINANCE_YEAR,
} from "@/app/dashboard/finance/finance-year-utils";

export type InventoryStockAdjustmentKind =
  | "opening_balance"
  | "found_stock"
  | "correction"
  | "write_off";

export type InventoryStockAdjustmentSource = "finished" | "raw";

export type InventoryStockAdjustmentRow = {
  id?: string;
  source: InventoryStockAdjustmentSource;
  adjustment_type: InventoryStockAdjustmentKind;
  /** Business date (created_at or explicit). */
  effective_date: string;
  quantity_delta: number;
  cost_per_unit: number;
  business_unit_id: string | null;
  /** When register link exists: signed GHS movement (matches income/expense amount). */
  booked_signed_amount?: number;
};

function roundCurrency(value: number): number {
  return Math.round(Number(value || 0) * 100) / 100;
}

export function inventoryAdjustmentSignedValue(
  row: Pick<
    InventoryStockAdjustmentRow,
    "quantity_delta" | "cost_per_unit" | "booked_signed_amount"
  >,
): number {
  if (row.booked_signed_amount != null && Number.isFinite(row.booked_signed_amount)) {
    return roundCurrency(Number(row.booked_signed_amount));
  }
  return inventoryMovementAmountFromQtyCost(
    Number(row.quantity_delta) || 0,
    Number(row.cost_per_unit) || 0,
  );
}

export type InventoryAdjustmentPlKind = "opening_equity" | "gain" | "loss" | "none";

export function classifyInventoryAdjustmentPlKind(
  row: Pick<
    InventoryStockAdjustmentRow,
    "adjustment_type" | "quantity_delta" | "cost_per_unit"
  >,
): InventoryAdjustmentPlKind {
  const signed = inventoryAdjustmentSignedValue(row);
  if (signed === 0) {
    return "none";
  }

  switch (row.adjustment_type) {
    case "opening_balance":
      return "opening_equity";
    case "found_stock":
      return "gain";
    case "write_off":
      return "loss";
    case "correction":
      return signed > 0 ? "gain" : "loss";
    default:
      return "none";
  }
}

export function inventoryAdjustmentPlAmount(row: InventoryStockAdjustmentRow): number {
  const signed = inventoryAdjustmentSignedValue(row);
  const kind = classifyInventoryAdjustmentPlKind(row);
  if (kind === "loss") {
    return roundCurrency(Math.abs(signed));
  }
  if (kind === "gain") {
    return roundCurrency(Math.abs(signed));
  }
  if (kind === "opening_equity") {
    return roundCurrency(Math.abs(signed));
  }
  return 0;
}

function adjustmentMonthIndex(
  effectiveDate: string,
  financialYear: number,
  referenceDate?: Date,
): number | null {
  return resolveBalanceSheetEntryMonthIndex(
    effectiveDate,
    financialYear,
    referenceDate,
  );
}

export function calculateInventoryAdjustmentAssetDeltaByMonth(
  adjustments: InventoryStockAdjustmentRow[],
  financialYear: number,
  goLiveDate: string | null,
  referenceDate?: Date,
): MonthlyTotals {
  const totals = createEmptyMonthlyTotals();
  if (!goLiveDate) {
    return totals;
  }

  const goLive = goLiveDate.slice(0, 10);

  for (const row of adjustments) {
    const effective = String(row.effective_date ?? "").slice(0, 10);
    if (!effective || effective < goLive) {
      continue;
    }
    const monthIndex = adjustmentMonthIndex(effective, financialYear, referenceDate);
    if (monthIndex === null) {
      continue;
    }
    addAmountToMonth(totals, monthIndex, inventoryAdjustmentSignedValue(row));
  }

  return totals.map((value) => roundCurrency(value)) as MonthlyTotals;
}

export function calculateInventoryAdjustmentOpeningEquityByMonth(
  adjustments: InventoryStockAdjustmentRow[],
  financialYear: number,
  goLiveDate: string | null,
  referenceDate?: Date,
): MonthlyTotals {
  const totals = createEmptyMonthlyTotals();
  if (!goLiveDate) {
    return totals;
  }

  const goLive = goLiveDate.slice(0, 10);

  for (const row of adjustments) {
    if (classifyInventoryAdjustmentPlKind(row) !== "opening_equity") {
      continue;
    }
    const effective = String(row.effective_date ?? "").slice(0, 10);
    if (!effective || effective < goLive) {
      continue;
    }
    const monthIndex = adjustmentMonthIndex(effective, financialYear, referenceDate);
    if (monthIndex === null) {
      continue;
    }
    addAmountToMonth(totals, monthIndex, inventoryAdjustmentPlAmount(row));
  }

  return totals.map((value) => roundCurrency(value)) as MonthlyTotals;
}

/** Dec cumulative opening-equity adjustments for all calendar years before `financialYear`. */
export function inventoryAdjustmentOpeningEquityPriorYearsTotal(
  adjustments: InventoryStockAdjustmentRow[],
  financialYear: number,
  goLiveDate: string | null,
  referenceDate?: Date,
): number {
  if (!goLiveDate) {
    return 0;
  }
  const goLiveYear =
    extractYearFromDate(goLiveDate) ?? financialYear;
  let total = 0;
  for (
    let year = Math.max(goLiveYear, MIN_FINANCE_YEAR);
    year < financialYear;
    year += 1
  ) {
    const raw = calculateInventoryAdjustmentOpeningEquityByMonth(
      adjustments,
      year,
      goLiveDate,
      referenceDate,
    );
    let yearCumulative = 0;
    for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
      yearCumulative = roundCurrency(
        yearCumulative + (raw[monthIndex] ?? 0),
      );
    }
    total = roundCurrency(total + yearCumulative);
  }
  return total;
}

export function calculateInventoryAdjustmentGainByMonth(
  adjustments: InventoryStockAdjustmentRow[],
  financialYear: number,
  goLiveDate: string | null,
  referenceDate?: Date,
): MonthlyTotals {
  const totals = createEmptyMonthlyTotals();
  if (!goLiveDate) {
    return totals;
  }

  const goLive = goLiveDate.slice(0, 10);

  for (const row of adjustments) {
    if (classifyInventoryAdjustmentPlKind(row) !== "gain") {
      continue;
    }
    const effective = String(row.effective_date ?? "").slice(0, 10);
    if (!effective || effective < goLive) {
      continue;
    }
    const monthIndex = adjustmentMonthIndex(effective, financialYear, referenceDate);
    if (monthIndex === null) {
      continue;
    }
    addAmountToMonth(totals, monthIndex, inventoryAdjustmentPlAmount(row));
  }

  return totals.map((value) => roundCurrency(value)) as MonthlyTotals;
}

export function calculateInventoryAdjustmentLossByMonth(
  adjustments: InventoryStockAdjustmentRow[],
  financialYear: number,
  goLiveDate: string | null,
  referenceDate?: Date,
): MonthlyTotals {
  const totals = createEmptyMonthlyTotals();
  if (!goLiveDate) {
    return totals;
  }

  const goLive = goLiveDate.slice(0, 10);

  for (const row of adjustments) {
    if (classifyInventoryAdjustmentPlKind(row) !== "loss") {
      continue;
    }
    const effective = String(row.effective_date ?? "").slice(0, 10);
    if (!effective || effective < goLive) {
      continue;
    }
    const monthIndex = adjustmentMonthIndex(effective, financialYear, referenceDate);
    if (monthIndex === null) {
      continue;
    }
    addAmountToMonth(totals, monthIndex, inventoryAdjustmentPlAmount(row));
  }

  return totals.map((value) => roundCurrency(value)) as MonthlyTotals;
}

export const INVENTORY_ADJUSTMENT_GAIN_INCOME = {
  service_category: "Other Income",
  description: "Inventory gain (stock adjustment)",
} as const;

export const INVENTORY_ADJUSTMENT_LOSS_EXPENSE = {
  expense_category: "Direct Operational",
  sub_category: "Inventory loss",
  description: "Inventory loss (stock adjustment)",
} as const;

export function stockAdjustmentPlLinkKey(
  source: InventoryStockAdjustmentSource,
  adjustmentId: string,
): string {
  return `${source}:${adjustmentId}`;
}

export function filterStockAdjustmentsForPlOverlay(
  adjustments: InventoryStockAdjustmentRow[],
  linkedPlKeys: ReadonlySet<string>,
): InventoryStockAdjustmentRow[] {
  return adjustments.filter((row) => {
    const kind = classifyInventoryAdjustmentPlKind(row);
    if (kind !== "gain" && kind !== "loss") {
      return false;
    }
    if (!row.id) {
      return true;
    }
    return !linkedPlKeys.has(stockAdjustmentPlLinkKey(row.source, row.id));
  });
}
