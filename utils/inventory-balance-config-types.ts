export const INVENTORY_BALANCE_CONFIG_SELECT =
  "tenant_id, go_live_date, opening_inventory_value, created_at" as const;

export type InventoryBalanceConfigRow = {
  tenant_id: string;
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
    opening_inventory_value: Number(row.opening_inventory_value) || 0,
  };
}
