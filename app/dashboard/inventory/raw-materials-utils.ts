export type RawMaterialRecord = {
  id: string;
  material_code: string;
  material_name: string;
  unit_of_measure: string;
  current_stock: number;
  average_cost_per_unit: number;
  reorder_level: number | null;
  created_at: string;
  updated_at: string;
};

export type RawMaterialPurchaseRecord = {
  id: string;
  material_id: string;
  purchase_date: string;
  quantity: number;
  cost_per_unit: number;
  total_cost: number;
  supplier: string | null;
  payment_method: string | null;
  notes: string | null;
  created_at: string;
  material?: {
    material_code: string;
    material_name: string;
    unit_of_measure: string;
  } | null;
};

export const RAW_MATERIAL_SELECT =
  "id, material_code, material_name, unit_of_measure, current_stock, average_cost_per_unit, reorder_level, created_at, updated_at";

export const RAW_MATERIAL_PURCHASE_SELECT =
  "id, material_id, purchase_date, quantity, cost_per_unit, total_cost, supplier, payment_method, notes, created_at, material:raw_materials!material_id(material_code, material_name, unit_of_measure)";

export function normalizeRawMaterial(raw: RawMaterialRecord): RawMaterialRecord {
  return {
    ...raw,
    current_stock: Number(raw.current_stock) || 0,
    average_cost_per_unit: Number(raw.average_cost_per_unit) || 0,
    reorder_level:
      raw.reorder_level == null ? null : Number(raw.reorder_level) || 0,
  };
}

export function normalizeRawMaterialPurchase(
  raw: RawMaterialPurchaseRecord,
): RawMaterialPurchaseRecord {
  const material = Array.isArray(raw.material)
    ? raw.material[0] ?? null
    : raw.material ?? null;

  return {
    ...raw,
    quantity: Number(raw.quantity) || 0,
    cost_per_unit: Number(raw.cost_per_unit) || 0,
    total_cost: Number(raw.total_cost) || 0,
    material,
  };
}
