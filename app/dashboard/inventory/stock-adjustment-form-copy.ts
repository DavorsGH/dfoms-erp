import type { FinishedProductAdjustmentType } from "@/app/dashboard/inventory/finished-products-utils";
import type { RawMaterialAdjustmentType } from "@/app/dashboard/inventory/raw-materials-utils";

export const FINISHED_PRODUCT_STOCK_ADJUSTMENT_FORM_INTRO =
  "Stock adjustments update business-unit quantity and inventory value on the balance sheet. Opening balance and found stock need a unit cost; corrections and write-offs use the current weighted-average cost at the time of the adjustment.";

export const FINISHED_PRODUCT_ADJUSTMENT_TYPE_HELP: Record<
  FinishedProductAdjustmentType,
  string
> = {
  opening_balance:
    "Adds opening quantity and cost for this product in this business unit. The balance sheet records inventory and matching Opening Balance Equity (separate from Inventory Go-Live).",
  found_stock:
    "Increases stock with the unit cost you enter. Inventory and retained earnings increase via a non-cash inventory gain on the P&L.",
  correction:
    "Fixes quantity up or down at current weighted-average cost. Increases post inventory gain; decreases post inventory loss.",
  write_off:
    "Removes damaged or missing stock at current weighted-average cost. Posts a non-cash inventory loss on the P&L.",
};

export const RAW_MATERIAL_STOCK_ADJUSTMENT_FORM_INTRO =
  "Stock adjustments update business-unit quantity and inventory value on the balance sheet. Opening balance and found stock need a unit cost; corrections and write-offs use the current weighted-average cost at the time of the adjustment.";

export const RAW_MATERIAL_ADJUSTMENT_TYPE_HELP: Record<
  RawMaterialAdjustmentType,
  string
> = {
  opening_balance: FINISHED_PRODUCT_ADJUSTMENT_TYPE_HELP.opening_balance,
  found_stock: FINISHED_PRODUCT_ADJUSTMENT_TYPE_HELP.found_stock,
  correction: FINISHED_PRODUCT_ADJUSTMENT_TYPE_HELP.correction,
  write_off: FINISHED_PRODUCT_ADJUSTMENT_TYPE_HELP.write_off,
};
