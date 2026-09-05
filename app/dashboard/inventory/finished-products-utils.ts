import type { SupabaseClient } from "@supabase/supabase-js";
import {
  applyBusinessUnitScope,
  type BusinessUnitReadScope,
} from "@/utils/business-unit-view";

export type FinishedProductSourcingType = "manufactured" | "purchased";

export type FinishedProductExpirationStatus =
  | "expired"
  | "nearing_expiration"
  | null;

export type FinishedProductRecord = {
  id: string;
  product_code: string;
  product_name: string;
  unit_of_measure: string;
  current_stock: number;
  /**
   * Optional BU-scoped WAC overlay from finished_product_balances.
   * Master finished_products has no average_cost_per_unit column.
   */
  average_cost_per_unit?: number | null;
  standard_selling_price: number | null;
  sourcing_type: FinishedProductSourcingType | null;
  supplier_id: string | null;
  /** Soonest lot manufacturing date (from batches/purchases), not finished_products. */
  manufacturing_date: string | null;
  /** Soonest lot expiration date (from batches/purchases), not finished_products. */
  expiration_date: string | null;
  photo_url: string | null;
  is_archived: boolean;
  created_at: string;
  updated_at: string;
};

/** Lot/batch date row from production_batches or product_purchases. */
export type FinishedProductLotDateSource = {
  product_id: string;
  manufacturing_date: string | null;
  expiration_date: string | null;
};

export const DEFAULT_FINISHED_PRODUCT_SOURCING_TYPE: FinishedProductSourcingType =
  "manufactured";

/** Days before expiration_date to show "Nearing expiration" (no inventory-specific pattern in app). */
export const FINISHED_PRODUCT_EXPIRATION_WARNING_DAYS = 30;

export const FINISHED_PRODUCT_SOURCING_OPTIONS = [
  { value: "manufactured", label: "Manufactured" },
  { value: "purchased", label: "Purchased" },
] as const;

/** Master columns only — lot dates live on production_batches / product_purchases. */
export const FINISHED_PRODUCT_SELECT =
  "id, product_code, product_name, unit_of_measure, current_stock, standard_selling_price, sourcing_type, supplier_id, photo_url, is_archived, created_at, updated_at";

function normalizeDateOnly(value: string | null | undefined): string | null {
  if (value == null) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  return trimmed.slice(0, 10);
}

function todayDateOnly(): string {
  return new Date().toISOString().slice(0, 10);
}

function daysUntilDate(dateOnly: string, today = todayDateOnly()): number {
  const start = Date.parse(`${today}T00:00:00Z`);
  const end = Date.parse(`${dateOnly}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return 0;
  return Math.round((end - start) / (1000 * 60 * 60 * 24));
}

export function getFinishedProductExpirationStatus(
  expirationDate: string | null | undefined,
  today = todayDateOnly(),
  warningDays = FINISHED_PRODUCT_EXPIRATION_WARNING_DAYS,
): FinishedProductExpirationStatus {
  const normalized = normalizeDateOnly(expirationDate);
  if (!normalized) return null;

  const daysUntil = daysUntilDate(normalized, today);
  if (daysUntil < 0) return "expired";
  if (daysUntil <= warningDays) return "nearing_expiration";
  return null;
}

/**
 * Pick list summary dates for one product: soonest expiration across lots wins;
 * manufacturing_date is taken from that same soonest-expiring lot.
 * If no lot has expiration, show earliest manufacturing_date only.
 */
export function pickSoonestLotDates(
  lots: Array<{
    manufacturing_date?: string | null;
    expiration_date?: string | null;
  }>,
): { manufacturing_date: string | null; expiration_date: string | null } {
  const normalized = lots.map((lot) => ({
    manufacturing_date: normalizeDateOnly(lot.manufacturing_date),
    expiration_date: normalizeDateOnly(lot.expiration_date),
  }));

  const withExpiration = normalized
    .filter(
      (lot): lot is { manufacturing_date: string | null; expiration_date: string } =>
        lot.expiration_date != null,
    )
    .sort((a, b) => a.expiration_date.localeCompare(b.expiration_date));

  if (withExpiration.length > 0) {
    return withExpiration[0];
  }

  const manufacturingDates = normalized
    .map((lot) => lot.manufacturing_date)
    .filter((date): date is string => date != null)
    .sort((a, b) => a.localeCompare(b));

  return {
    manufacturing_date: manufacturingDates[0] ?? null,
    expiration_date: null,
  };
}

export function mergeFinishedProductsWithLotDates(
  products: FinishedProductRecord[],
  lots: FinishedProductLotDateSource[],
): FinishedProductRecord[] {
  const lotsByProductId = new Map<string, FinishedProductLotDateSource[]>();
  for (const lot of lots) {
    const existing = lotsByProductId.get(lot.product_id);
    if (existing) {
      existing.push(lot);
    } else {
      lotsByProductId.set(lot.product_id, [lot]);
    }
  }

  return products.map((product) => {
    const dates = pickSoonestLotDates(lotsByProductId.get(product.id) ?? []);
    return {
      ...product,
      manufacturing_date: dates.manufacturing_date,
      expiration_date: dates.expiration_date,
    };
  });
}

export async function fetchFinishedProductLotDateSources(
  supabase: SupabaseClient,
  buScope: BusinessUnitReadScope = { mode: "all" },
): Promise<{ lots: FinishedProductLotDateSource[]; error: string | null }> {
  const [batchesResult, purchasesResult] = await Promise.all([
    applyBusinessUnitScope(
      supabase
        .from("production_batches")
        .select("finished_product_id, manufacturing_date, expiration_date"),
      buScope,
    ),
    applyBusinessUnitScope(
      supabase
        .from("product_purchases")
        .select("product_id, manufacturing_date, expiration_date"),
      buScope,
    ),
  ]);

  if (batchesResult.error) {
    return { lots: [], error: batchesResult.error.message };
  }
  if (purchasesResult.error) {
    return { lots: [], error: purchasesResult.error.message };
  }

  const batchLots: FinishedProductLotDateSource[] = (
    (batchesResult.data as
      | {
          finished_product_id: string;
          manufacturing_date: string | null;
          expiration_date: string | null;
        }[]
      | null) ?? []
  ).map((row) => ({
    product_id: row.finished_product_id,
    manufacturing_date: normalizeDateOnly(row.manufacturing_date),
    expiration_date: normalizeDateOnly(row.expiration_date),
  }));

  const purchaseLots: FinishedProductLotDateSource[] = (
    (purchasesResult.data as
      | {
          product_id: string;
          manufacturing_date: string | null;
          expiration_date: string | null;
        }[]
      | null) ?? []
  ).map((row) => ({
    product_id: row.product_id,
    manufacturing_date: normalizeDateOnly(row.manufacturing_date),
    expiration_date: normalizeDateOnly(row.expiration_date),
  }));

  return { lots: [...batchLots, ...purchaseLots], error: null };
}

export async function fetchFinishedProductPurchaseCounts(
  supabase: SupabaseClient,
  buScope: BusinessUnitReadScope = { mode: "all" },
): Promise<{ countsByProductId: Map<string, number>; error: string | null }> {
  const { data, error } = await applyBusinessUnitScope(
    supabase.from("product_purchases").select("product_id"),
    buScope,
  );

  if (error) {
    return { countsByProductId: new Map(), error: error.message };
  }

  const countsByProductId = new Map<string, number>();
  for (const row of (data as { product_id: string }[] | null) ?? []) {
    countsByProductId.set(
      row.product_id,
      (countsByProductId.get(row.product_id) ?? 0) + 1,
    );
  }

  return { countsByProductId, error: null };
}

export function normalizeFinishedProduct(
  raw: Omit<FinishedProductRecord, "manufacturing_date" | "expiration_date"> & {
    manufacturing_date?: string | null;
    expiration_date?: string | null;
  },
): FinishedProductRecord {
  return {
    ...raw,
    current_stock: Number(raw.current_stock) || 0,
    standard_selling_price:
      raw.standard_selling_price == null
        ? null
        : Number(raw.standard_selling_price) || 0,
    sourcing_type: raw.sourcing_type ?? DEFAULT_FINISHED_PRODUCT_SOURCING_TYPE,
    supplier_id: raw.supplier_id ?? null,
    photo_url: raw.photo_url ?? null,
    is_archived: raw.is_archived ?? false,
    manufacturing_date: normalizeDateOnly(raw.manufacturing_date),
    expiration_date: normalizeDateOnly(raw.expiration_date),
  };
}

export function finishedProductToForm(product: FinishedProductRecord) {
  return {
    product_code: product.product_code,
    product_name: product.product_name,
    unit_of_measure: product.unit_of_measure,
    standard_selling_price:
      product.standard_selling_price == null
        ? ""
        : String(product.standard_selling_price),
    sourcing_type: product.sourcing_type ?? DEFAULT_FINISHED_PRODUCT_SOURCING_TYPE,
    supplier_id: product.supplier_id ?? "",
  };
}

export function buildFinishedProductSavePayload(form: {
  product_code: string;
  product_name: string;
  unit_of_measure: string;
  standard_selling_price: string;
  sourcing_type: FinishedProductSourcingType;
  supplier_id: string;
}) {
  const supplierId =
    form.sourcing_type === "purchased" && form.supplier_id.trim()
      ? form.supplier_id.trim()
      : null;

  return {
    product_code: form.product_code.trim(),
    product_name: form.product_name.trim(),
    unit_of_measure: form.unit_of_measure.trim(),
    standard_selling_price:
      form.standard_selling_price.trim() === ""
        ? null
        : Number(form.standard_selling_price),
    sourcing_type: form.sourcing_type,
    supplier_id: supplierId,
  };
}
