export type FinishedProductRecord = {
  id: string;
  product_code: string;
  product_name: string;
  unit_of_measure: string;
  current_stock: number;
  standard_selling_price: number | null;
  created_at: string;
  updated_at: string;
};

export const FINISHED_PRODUCT_SELECT =
  "id, product_code, product_name, unit_of_measure, current_stock, standard_selling_price, created_at, updated_at";

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
  };
}
