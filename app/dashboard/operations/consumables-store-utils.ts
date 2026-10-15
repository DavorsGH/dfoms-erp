import type { PostgrestError } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";
import { resolvePostgresRpcErrorMessage } from "@/utils/postgres-fk-violation";

export const CONSUMABLE_CODE_ENTITY_TYPE = "CONSUMABLE";

export const CONSUMABLE_ITEM_SELECT =
  "id, tenant_id, business_unit_id, item_code, name, category, unit, minimum_level, is_archived, notes, created_at, created_by, updated_at";

export const CONSUMABLE_MOVEMENT_SELECT =
  "id, tenant_id, business_unit_id, item_id, movement_type, movement_date, quantity, unit_cost, site_code, project_id, expense_id, accounts_payable_id, supplier_id, reason, notes, created_at, created_by, updated_at";

export {
  UNITS_OF_MEASURE_PRESETS as CONSUMABLE_UNIT_PRESETS,
  UNIT_OF_MEASURE_OTHER as CONSUMABLE_UNIT_OTHER,
  resolveUnitOfMeasureFromForm as resolveConsumableUnitFromForm,
  unitOfMeasureFormFromStored as consumableUnitFormFromStored,
} from "@/utils/units-of-measure";

export type ConsumableMovementType =
  | "receive"
  | "issue"
  | "return"
  | "adjust_in"
  | "adjust_out";

export type ConsumableItemRecord = {
  id: string;
  tenant_id: string;
  business_unit_id: string | null;
  item_code: string;
  name: string;
  category: string | null;
  unit: string | null;
  minimum_level: number | null;
  is_archived: boolean;
  notes: string | null;
  created_at?: string;
  created_by?: string | null;
  updated_at?: string;
};

export type ConsumableMovementRecord = {
  id: string;
  tenant_id: string;
  business_unit_id: string | null;
  item_id: string;
  movement_type: ConsumableMovementType;
  movement_date: string;
  quantity: number;
  unit_cost: number | null;
  site_code: string | null;
  project_id: string | null;
  expense_id: string | null;
  accounts_payable_id: string | null;
  supplier_id: string | null;
  reason: string | null;
  notes: string | null;
  created_at?: string;
  created_by?: string | null;
  updated_at?: string;
};

export const ADJUST_REASONS = [
  "Stock count",
  "Damaged",
  "Lost",
  "Expired",
  "Other",
] as const;

export type AdjustReason = (typeof ADJUST_REASONS)[number];

export const STOCK_STATUS_OK = "OK";
export const STOCK_STATUS_LOW = "Low Stock";
export const STOCK_STATUS_OUT = "Out of Stock";

function roundQty(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

export function movementSortKey(row: Pick<
  ConsumableMovementRecord,
  "movement_date" | "created_at" | "id"
>): string {
  const date = row.movement_date.slice(0, 10);
  const created = row.created_at ?? "";
  return `${date}T${created}#${row.id}`;
}

export function sortMovementsChronological(
  movements: ConsumableMovementRecord[],
): ConsumableMovementRecord[] {
  return [...movements].sort((left, right) =>
    movementSortKey(left).localeCompare(movementSortKey(right)),
  );
}

export type WeightedAverageState = {
  onHand: number;
  averageCost: number;
};

/**
 * Process movements in movement_date then created_at order.
 * receive: add at unit_cost and recompute average.
 * issue/adjust_out: remove at current average (average unchanged).
 * return/adjust_in: add at current average (average unchanged).
 */
export function computeWeightedAverageState(
  movements: ConsumableMovementRecord[],
): WeightedAverageState {
  const sorted = sortMovementsChronological(movements);
  let onHand = 0;
  let averageCost = 0;

  for (const row of sorted) {
    const qty = Number(row.quantity) || 0;
    if (qty <= 0) {
      continue;
    }

    switch (row.movement_type) {
      case "receive": {
        const unitCost = Number(row.unit_cost) || 0;
        const nextOnHand = onHand + qty;
        if (nextOnHand > 0) {
          averageCost = roundMoney(
            (onHand * averageCost + qty * unitCost) / nextOnHand,
          );
        } else {
          averageCost = roundMoney(unitCost);
        }
        onHand = roundQty(nextOnHand);
        break;
      }
      case "issue":
      case "adjust_out":
        onHand = roundQty(onHand - qty);
        break;
      case "return":
      case "adjust_in":
        onHand = roundQty(onHand + qty);
        break;
      default:
        break;
    }
  }

  return { onHand, averageCost: roundMoney(averageCost) };
}

export function computeStockStatus(
  onHand: number,
  minimumLevel: number | null | undefined,
): string {
  if (onHand <= 0) {
    return STOCK_STATUS_OUT;
  }
  const min = Number(minimumLevel);
  if (Number.isFinite(min) && min > 0 && onHand <= min) {
    return STOCK_STATUS_LOW;
  }
  return STOCK_STATUS_OK;
}

export type ConsumableStockRow = {
  item: ConsumableItemRecord;
  onHand: number;
  averageCost: number;
  stockValue: number;
  status: string;
};

export function buildConsumableStockRows(
  items: ConsumableItemRecord[],
  movementsByItemId: Map<string, ConsumableMovementRecord[]>,
): ConsumableStockRow[] {
  return items
    .filter((item) => !item.is_archived)
    .map((item) => {
      const movements = movementsByItemId.get(item.id) ?? [];
      const { onHand, averageCost } = computeWeightedAverageState(movements);
      return {
        item,
        onHand,
        averageCost,
        stockValue: roundMoney(onHand * averageCost),
        status: computeStockStatus(onHand, item.minimum_level),
      };
    });
}

export function groupMovementsByItemId(
  movements: ConsumableMovementRecord[],
): Map<string, ConsumableMovementRecord[]> {
  const map = new Map<string, ConsumableMovementRecord[]>();
  for (const row of movements) {
    const list = map.get(row.item_id) ?? [];
    list.push(row);
    map.set(row.item_id, list);
  }
  return map;
}

export function isInboundMovementType(type: ConsumableMovementType): boolean {
  return type === "receive" || type === "return" || type === "adjust_in";
}

/**
 * After applying a hypothetical change (delete or reduced qty on inbound movement),
 * ensure on-hand never drops below zero at any point in the timeline.
 */
export function wouldInboundChangeCauseNegativeStock(args: {
  movements: ConsumableMovementRecord[];
  targetMovementId: string;
  /** When editing, new quantity; omit to simulate delete. */
  newQuantity?: number | null;
}): boolean {
  const adjusted = args.movements
    .map((row) => {
      if (row.id !== args.targetMovementId) {
        return row;
      }
      if (args.newQuantity === undefined) {
        return null;
      }
      const qty = Number(args.newQuantity) || 0;
      if (qty <= 0) {
        return null;
      }
      return { ...row, quantity: qty };
    })
    .filter((row): row is ConsumableMovementRecord => row !== null);

  let onHand = 0;
  for (const row of sortMovementsChronological(adjusted)) {
    const qty = Number(row.quantity) || 0;
    switch (row.movement_type) {
      case "receive":
      case "return":
      case "adjust_in":
        onHand = roundQty(onHand + qty);
        break;
      case "issue":
      case "adjust_out":
        onHand = roundQty(onHand - qty);
        break;
      default:
        break;
    }
    if (onHand < -0.0001) {
      return true;
    }
  }
  return false;
}

const CONSUMABLE_ITEM_CONSTRAINT_MESSAGES: Record<string, string> = {
  consumable_items_tenant_id_item_code_key:
    "This item code is already in use. Refresh and try again.",
  consumable_items_tenant_item_code_key:
    "This item code is already in use. Refresh and try again.",
  consumable_items_tenant_business_unit_id_name_key:
    "An active item with this name already exists in this business unit.",
  consumable_items_tenant_id_business_unit_id_name_key:
    "An active item with this name already exists in this business unit.",
};

function asPostgresError(
  error: Pick<PostgrestError, "code" | "message"> | string | null | undefined,
): Pick<PostgrestError, "code" | "message"> | null {
  if (!error) {
    return null;
  }
  if (typeof error === "string") {
    return { message: error, code: "" };
  }
  return { message: error.message, code: error.code ?? "" };
}

export function formatConsumablesItemSaveError(
  error: Pick<PostgrestError, "code" | "message"> | string | null | undefined,
): string {
  const pgError = asPostgresError(error);
  const message = pgError?.message;
  if (!message?.trim()) {
    return "Could not save this item. Please try again.";
  }
  const friendly = resolvePostgresRpcErrorMessage(
    pgError,
    {
      constraintMessages: CONSUMABLE_ITEM_CONSTRAINT_MESSAGES,
      fallbackMessage:
        "Could not save this item. Check the details and try again.",
    },
  );
  if (friendly) {
    return friendly;
  }
  const lower = message.toLowerCase();
  if (lower.includes("unique") && lower.includes("name")) {
    return "An active item with this name already exists in this business unit.";
  }
  if (lower.includes("unique") && lower.includes("item_code")) {
    return "This item code is already in use. Refresh and try again.";
  }
  if (lower.includes("check constraint")) {
    return "One of the values is not allowed. Check category, unit, and minimum level.";
  }
  return "Could not save this item. Please try again.";
}

export function formatConsumablesMovementSaveError(
  error: Pick<PostgrestError, "code" | "message"> | string | null | undefined,
  itemName?: string,
  unit?: string | null,
): string {
  const pgError = asPostgresError(error);
  const message = pgError?.message;
  if (!message?.trim()) {
    return "Could not save this movement. Please try again.";
  }
  const stockFriendly = formatConsumablesStockError(message, itemName, unit);
  if (stockFriendly !== message) {
    return stockFriendly;
  }
  const friendly = resolvePostgresRpcErrorMessage(
    pgError,
    {
      constraintMessages: {
        consumable_movements_supplier_id_fkey:
          "Choose a supplier from your supplier list.",
      },
      fallbackMessage:
        "Could not save this movement. Check the details and try again.",
    },
  );
  if (friendly) {
    return friendly;
  }
  return "Could not save this movement. Please try again.";
}

export function parseConsumableMinimumLevel(raw: string): number {
  const trimmed = raw.trim();
  if (!trimmed) {
    return 0;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export function formatConsumablesStockError(
  message: string,
  itemName?: string,
  unit?: string | null,
): string {
  const match = /Not enough stock:\s*([\d.,]+)\s*available/i.exec(message);
  if (match && itemName) {
    const amount = match[1]!.replace(/,/g, "");
    const unitLabel = unit?.trim() ? `${unit.trim()} ` : "";
    return `Only ${amount} ${unitLabel}of ${itemName} in store.`.replace(
      "  ",
      " ",
    );
  }
  return message;
}

export type SiteUsageRow = {
  siteCode: string;
  siteName: string;
  projectId: string | null;
  projectLabel: string;
  itemId: string;
  itemName: string;
  unit: string | null;
  netQuantity: number;
  netValue: number;
};

export function buildSiteUsageRows(args: {
  movements: ConsumableMovementRecord[];
  itemsById: Map<string, ConsumableItemRecord>;
  sitesByCode: Map<string, { site_name: string; project_id: string | null }>;
  projectLabelById: Map<string, string>;
  fromDate: string;
  toDate: string;
}): SiteUsageRow[] {
  const from = args.fromDate.slice(0, 10);
  const to = args.toDate.slice(0, 10);
  const bucket = new Map<string, SiteUsageRow>();

  for (const row of args.movements) {
    if (row.movement_type !== "issue" && row.movement_type !== "return") {
      continue;
    }
    const date = row.movement_date.slice(0, 10);
    if (date < from || date > to) {
      continue;
    }
    const siteCode = row.site_code?.trim();
    if (!siteCode) {
      continue;
    }
    const item = args.itemsById.get(row.item_id);
    if (!item) {
      continue;
    }
    const site = args.sitesByCode.get(siteCode);
    const projectId = row.project_id ?? site?.project_id ?? null;
    const projectLabel = projectId
      ? (args.projectLabelById.get(projectId) ?? projectId)
      : "—";
    const key = `${siteCode}|${row.item_id}|${projectId ?? ""}`;
    const sign = row.movement_type === "issue" ? 1 : -1;
    const qty = sign * (Number(row.quantity) || 0);
    const unitCost = Number(row.unit_cost) || 0;
    const value = sign * roundMoney((Number(row.quantity) || 0) * unitCost);

    const existing = bucket.get(key);
    if (existing) {
      existing.netQuantity = roundQty(existing.netQuantity + qty);
      existing.netValue = roundMoney(existing.netValue + value);
    } else {
      bucket.set(key, {
        siteCode,
        siteName: site?.site_name ?? siteCode,
        projectId,
        projectLabel,
        itemId: row.item_id,
        itemName: item.name,
        unit: item.unit,
        netQuantity: roundQty(qty),
        netValue: value,
      });
    }
  }

  return [...bucket.values()]
    .filter((row) => row.netQuantity !== 0 || row.netValue !== 0)
    .sort((left, right) =>
      `${left.siteName}${left.itemName}`.localeCompare(
        `${right.siteName}${right.itemName}`,
      ),
    );
}

export async function allocateConsumableItemCode(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<{ itemCode: string | null; error: string | null }> {
  const { data, error } = await supabase.rpc("generate_next_code", {
    p_tenant_id: tenantId,
    p_entity_type: CONSUMABLE_CODE_ENTITY_TYPE,
    p_padding: 4,
  });
  if (error) {
    return { itemCode: null, error: error.message };
  }
  const itemCode = typeof data === "string" ? data.trim() : "";
  if (!itemCode) {
    return {
      itemCode: null,
      error: "generate_next_code returned an empty consumable item code.",
    };
  }
  return { itemCode, error: null };
}
