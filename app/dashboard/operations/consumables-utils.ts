export type ConsumablesEntry = {
  id: string;
  date: string;
  client_site: string | null;
  item: string;
  category: string | null;
  unit: string | null;
  opening_stock: number | null;
  qty_issued: number | null;
  qty_used: number | null;
  remaining: number | null;
  minimum_level: number | null;
  stock_status: string | null;
  recorded_by: string | null;
  notes: string | null;
};

export type ConsumablesSiteOption = {
  site_code: string;
  site_name: string;
};

export const CONSUMABLES_SELECT =
  "id, date, client_site, item, category, unit, opening_stock, qty_issued, qty_used, remaining, minimum_level, stock_status, recorded_by, notes";

export const CONSUMABLES_SITE_SELECT = "site_code, site_name";

export const STOCK_STATUS_OK = "OK";
export const STOCK_STATUS_LOW = "Low Stock";
export const STOCK_STATUS_OUT = "Out of Stock";

function toNumber(value: number | string | null | undefined): number {
  if (value === null || value === undefined || value === "") {
    return 0;
  }
  const parsed = typeof value === "number" ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** remaining = opening_stock + qty_issued - qty_used */
export function computeRemaining(
  openingStock: number | string | null | undefined,
  qtyIssued: number | string | null | undefined,
  qtyUsed: number | string | null | undefined,
): number {
  const remaining =
    toNumber(openingStock) + toNumber(qtyIssued) - toNumber(qtyUsed);
  return Math.round(remaining * 100) / 100;
}

/**
 * Out of Stock: remaining <= 0
 * Low Stock: remaining <= minimum_level (when minimum_level is set)
 * OK: otherwise
 */
export function computeStockStatus(
  remaining: number,
  minimumLevel: number | string | null | undefined,
): string {
  if (remaining <= 0) {
    return STOCK_STATUS_OUT;
  }

  if (
    minimumLevel !== null &&
    minimumLevel !== undefined &&
    String(minimumLevel).trim() !== ""
  ) {
    const min = toNumber(minimumLevel);
    if (remaining <= min) {
      return STOCK_STATUS_LOW;
    }
  }

  return STOCK_STATUS_OK;
}

export function deriveStockFields(input: {
  opening_stock: number | string | null | undefined;
  qty_issued: number | string | null | undefined;
  qty_used: number | string | null | undefined;
  minimum_level: number | string | null | undefined;
}): { remaining: number; stock_status: string } {
  const remaining = computeRemaining(
    input.opening_stock,
    input.qty_issued,
    input.qty_used,
  );
  return {
    remaining,
    stock_status: computeStockStatus(remaining, input.minimum_level),
  };
}
