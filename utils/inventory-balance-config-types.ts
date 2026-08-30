export const INVENTORY_BALANCE_CONFIG_SELECT =
  "tenant_id, business_unit_id, go_live_date, opening_inventory_value, created_at" as const;

/** Upsert target after Phase 7a — NULL business_unit_id = workspace default. */
export const INVENTORY_BALANCE_CONFIG_ON_CONFLICT =
  "tenant_id,business_unit_id" as const;

export type InventoryBalanceConfigRow = {
  tenant_id: string;
  business_unit_id: string | null;
  go_live_date: string;
  opening_inventory_value: number;
  created_at: string;
};

export type InventoryBalanceConfigUpdateBody = {
  go_live_date?: unknown;
  opening_inventory_value?: unknown;
};

export function normalizeInventoryBalanceConfigRow(
  row: InventoryBalanceConfigRow,
): InventoryBalanceConfigRow {
  return {
    ...row,
    business_unit_id: row.business_unit_id ?? null,
    opening_inventory_value: Number(row.opening_inventory_value) || 0,
  };
}
