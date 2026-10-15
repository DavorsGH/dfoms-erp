"use client";

import { createClient } from "@/utils/supabase/client";
import { applyBusinessUnitScope } from "@/utils/business-unit-view";
import type { BusinessUnitReadScope } from "@/utils/business-unit-view";
import {
  fetchConsumableMovementDisplayMaps,
  type ConsumableMovementDisplayMaps,
} from "./consumables-store-data";
import {
  CONSUMABLE_ITEM_SELECT,
  CONSUMABLE_MOVEMENT_SELECT,
  type ConsumableItemRecord,
  type ConsumableMovementRecord,
} from "./consumables-store-utils";

export const consumablesInputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

export const consumablesPrimaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#18365c] disabled:cursor-not-allowed disabled:opacity-50";

export async function refreshConsumableItems(
  tenantId: string,
  buScope: BusinessUnitReadScope,
): Promise<{ items: ConsumableItemRecord[]; error: string | null }> {
  const supabase = createClient();
  const { data, error } = await applyBusinessUnitScope(
    supabase
      .from("consumable_items")
      .select(CONSUMABLE_ITEM_SELECT)
      .eq("tenant_id", tenantId)
      .order("item_code", { ascending: true }),
    buScope,
  );
  if (error) {
    return { items: [], error: error.message };
  }
  return { items: (data as ConsumableItemRecord[] | null) ?? [], error: null };
}

export async function refreshConsumableMovements(
  tenantId: string,
  buScope: BusinessUnitReadScope,
): Promise<{ movements: ConsumableMovementRecord[]; error: string | null }> {
  const supabase = createClient();
  const { data, error } = await applyBusinessUnitScope(
    supabase
      .from("consumable_movements")
      .select(CONSUMABLE_MOVEMENT_SELECT)
      .eq("tenant_id", tenantId)
      .order("movement_date", { ascending: false })
      .order("created_at", { ascending: false }),
    buScope,
  );
  if (error) {
    return { movements: [], error: error.message };
  }
  return {
    movements: (data as ConsumableMovementRecord[] | null) ?? [],
    error: null,
  };
}

export async function refreshConsumableMovementDisplayMaps(
  tenantId: string,
  movements: ConsumableMovementRecord[],
): Promise<{ maps: ConsumableMovementDisplayMaps; error: string | null }> {
  const supabase = createClient();
  return fetchConsumableMovementDisplayMaps(supabase, tenantId, movements);
}
