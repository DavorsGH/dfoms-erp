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
  standard_selling_price: number | null;
  sourcing_type: FinishedProductSourcingType | null;
  supplier_id: string | null;
  manufacturing_date: string | null;
  expiration_date: string | null;
  created_at: string;
  updated_at: string;
};

export const DEFAULT_FINISHED_PRODUCT_SOURCING_TYPE: FinishedProductSourcingType =
  "manufactured";

/** Days before expiration_date to show "Nearing expiration" (no inventory-specific pattern in app). */
export const FINISHED_PRODUCT_EXPIRATION_WARNING_DAYS = 30;

export const FINISHED_PRODUCT_SOURCING_OPTIONS = [
  { value: "manufactured", label: "Manufactured" },
  { value: "purchased", label: "Purchased" },
] as const;

export const FINISHED_PRODUCT_SELECT =
  "id, product_code, product_name, unit_of_measure, current_stock, standard_selling_price, sourcing_type, supplier_id, manufacturing_date, expiration_date, created_at, updated_at";

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

export function normalizeFinishedProduct(
  raw: FinishedProductRecord,
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
