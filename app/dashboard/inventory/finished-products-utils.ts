export type FinishedProductSourcingType = "manufactured" | "purchased";

export type FinishedProductRecord = {
  id: string;
  product_code: string;
  product_name: string;
  unit_of_measure: string;
  current_stock: number;
  standard_selling_price: number | null;
  sourcing_type: FinishedProductSourcingType | null;
  supplier_id: string | null;
  created_at: string;
  updated_at: string;
};

export const DEFAULT_FINISHED_PRODUCT_SOURCING_TYPE: FinishedProductSourcingType =
  "manufactured";

export const FINISHED_PRODUCT_SOURCING_OPTIONS = [
  { value: "manufactured", label: "Manufactured" },
  { value: "purchased", label: "Purchased" },
] as const;

export const FINISHED_PRODUCT_SELECT =
  "id, product_code, product_name, unit_of_measure, current_stock, standard_selling_price, sourcing_type, supplier_id, created_at, updated_at";

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
