import type { SupabaseClient } from "@supabase/supabase-js";
import type { BusinessUnitReadScope } from "@/utils/business-unit-view";
import { applyBusinessUnitScope } from "@/utils/business-unit-view";
import {
  INTERNAL_CONSUMPTION_SELECT,
  normalizeInternalConsumption,
  type InternalConsumptionRecord,
} from "@/app/dashboard/inventory/internal-consumption-utils";

export async function fetchScopedInternalConsumptionEntries(
  supabase: SupabaseClient,
  tenantId: string,
  buScope: BusinessUnitReadScope,
): Promise<{ entries: InternalConsumptionRecord[]; error: string | null }> {
  const { data, error } = await applyBusinessUnitScope(
    supabase
      .from("internal_consumption")
      .select(INTERNAL_CONSUMPTION_SELECT)
      .eq("tenant_id", tenantId),
    buScope,
  )
    .order("consumption_date", { ascending: false })
    .order("created_at", { ascending: false });

  if (error) {
    return { entries: [], error: error.message };
  }

  return {
    entries: (
      ((data as unknown) as InternalConsumptionRecord[] | null) ?? []
    ).map((row) => normalizeInternalConsumption(row)),
    error: null,
  };
}
