export type RawMaterialRecord = {
  id: string;
  material_code: string;
  material_name: string;
  unit_of_measure: string;
  current_stock: number;
  /** Master WAC, or BU-scoped overlay (null = no balance row under default BU). */
  average_cost_per_unit: number | null;
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
  project_id?: string | null;
  created_at: string;
  material?: {
    material_code: string;
    material_name: string;
    unit_of_measure: string;
  } | null;
};

export const RAW_MATERIAL_ADJUSTMENT_TYPES = [
  "opening_balance",
  "correction",
  "found_stock",
  "write_off",
] as const;

export type RawMaterialAdjustmentType =
  (typeof RAW_MATERIAL_ADJUSTMENT_TYPES)[number];

export type RawMaterialStockAdjustmentRecord = {
  id: string;
  material_id: string;
  business_unit_id: string | null;
  adjustment_type: RawMaterialAdjustmentType | string;
  quantity_delta: number;
  cost_per_unit: number | null;
  reason: string;
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
  "id, material_id, purchase_date, quantity, cost_per_unit, total_cost, supplier, payment_method, notes, project_id, created_at, material:raw_materials!material_id(material_code, material_name, unit_of_measure)";

export const RAW_MATERIAL_STOCK_ADJUSTMENT_SELECT =
  "id, material_id, business_unit_id, adjustment_type, quantity_delta, cost_per_unit, reason, notes, created_at, material:raw_materials!material_id(material_code, material_name, unit_of_measure)";

export const RAW_MATERIAL_ADJUSTMENT_TYPE_LABELS: Record<
  RawMaterialAdjustmentType,
  string
> = {
  opening_balance: "Opening Balance",
  correction: "Correction",
  found_stock: "Found Stock",
  write_off: "Write-off",
};

export function formatRawMaterialAdjustmentType(type: string): string {
  if (type in RAW_MATERIAL_ADJUSTMENT_TYPE_LABELS) {
    return RAW_MATERIAL_ADJUSTMENT_TYPE_LABELS[
      type as RawMaterialAdjustmentType
    ];
  }
  return type;
}

export function normalizeRawMaterial(raw: RawMaterialRecord): RawMaterialRecord {
  return {
    ...raw,
    current_stock: Number(raw.current_stock) || 0,
    average_cost_per_unit:
      raw.average_cost_per_unit == null
        ? null
        : Number(raw.average_cost_per_unit) || 0,
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

export function normalizeRawMaterialStockAdjustment(
  raw: RawMaterialStockAdjustmentRecord,
): RawMaterialStockAdjustmentRecord {
  const material = Array.isArray(raw.material)
    ? raw.material[0] ?? null
    : raw.material ?? null;

  return {
    ...raw,
    quantity_delta: Number(raw.quantity_delta) || 0,
    cost_per_unit:
      raw.cost_per_unit == null ? null : Number(raw.cost_per_unit) || 0,
    material,
  };
}
