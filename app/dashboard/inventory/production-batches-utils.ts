export type ProductionBatchMaterialRecord = {
  id: string;
  batch_id: string;
  material_id: string;
  quantity_used: number;
  cost_at_time: number;
  material?: {
    material_code: string;
    material_name: string;
    unit_of_measure: string;
  } | null;
};

export type ProductionBatchRecord = {
  id: string;
  batch_number: string;
  business_unit_id: string | null;
  production_date: string;
  finished_product_id: string;
  quantity_produced: number;
  cost_per_unit_produced: number;
  total_batch_cost: number;
  notes: string | null;
  expiration_date: string | null;
  created_at: string;
  product?: {
    product_code: string;
    barcode: string | null;
    product_name: string;
    unit_of_measure: string;
  } | null;
  materials?: ProductionBatchMaterialRecord[] | null;
};

export type ProductionMaterialInput = {
  material_id: string;
  quantity_used: string;
};

export const PRODUCTION_BATCH_SELECT =
  "id, batch_number, business_unit_id, production_date, finished_product_id, quantity_produced, cost_per_unit_produced, total_batch_cost, notes, expiration_date, created_at, product:finished_products!finished_product_id(product_code, barcode, product_name, unit_of_measure)";

export const PRODUCTION_BATCH_DETAIL_SELECT =
  "id, batch_number, business_unit_id, production_date, finished_product_id, quantity_produced, cost_per_unit_produced, total_batch_cost, notes, expiration_date, created_at, product:finished_products!finished_product_id(product_code, barcode, product_name, unit_of_measure), materials:production_batch_materials(id, batch_id, material_id, quantity_used, cost_at_time, material:raw_materials!material_id(material_code, material_name, unit_of_measure))";

export function normalizeProductionBatch(
  raw: ProductionBatchRecord,
): ProductionBatchRecord {
  const product = Array.isArray(raw.product)
    ? raw.product[0] ?? null
    : raw.product ?? null;
  const materials = Array.isArray(raw.materials)
    ? raw.materials.map((line) => {
        const material = Array.isArray(line.material)
          ? line.material[0] ?? null
          : line.material ?? null;

        return {
          ...line,
          quantity_used: Number(line.quantity_used) || 0,
          cost_at_time: Number(line.cost_at_time) || 0,
          material,
        };
      })
    : raw.materials ?? null;

  return {
    ...raw,
    expiration_date: raw.expiration_date?.trim()
      ? raw.expiration_date.trim().slice(0, 10)
      : null,
    quantity_produced: Number(raw.quantity_produced) || 0,
    cost_per_unit_produced: Number(raw.cost_per_unit_produced) || 0,
    total_batch_cost: Number(raw.total_batch_cost) || 0,
    product,
    materials,
  };
}

export function calculateBatchPreview(
  materials: Array<{
    material_id: string;
    quantity_used: number;
    cost_at_time: number;
  }>,
  quantityProduced: number,
): {
  total_batch_cost: number;
  cost_per_unit_produced: number;
} | null {
  if (quantityProduced <= 0 || materials.length === 0) {
    return null;
  }

  const totalBatchCost = materials.reduce(
    (sum, line) => sum + line.quantity_used * line.cost_at_time,
    0,
  );

  return {
    total_batch_cost: Math.round(totalBatchCost * 10000) / 10000,
    cost_per_unit_produced:
      Math.round((totalBatchCost / quantityProduced) * 10000) / 10000,
  };
}
