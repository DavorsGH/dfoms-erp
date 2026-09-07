import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getUserAllowedBusinessUnits,
  resolveWriteBusinessUnitId,
} from "@/utils/business-unit-access";
import { INVENTORY_BALANCE_CONFIG_SELECT } from "@/utils/inventory-balance-config-types";

/** Same BU key as PUT: unrestricted → workspace-default null; restricted → default allowed unit. */
export async function resolveInventoryBalanceConfigBusinessUnitId(
  supabase: SupabaseClient,
  tenantId: string,
  authUid: string,
): Promise<string | null> {
  const allowedUnits = await getUserAllowedBusinessUnits(
    supabase,
    tenantId,
    authUid,
  );

  if (allowedUnits === null) {
    return null;
  }

  return resolveWriteBusinessUnitId({
    allowedUnits,
    requestedBusinessUnitId: undefined,
  });
}

export async function fetchInventoryBalanceConfigRow(
  supabase: SupabaseClient,
  tenantId: string,
  businessUnitId: string | null,
) {
  let query = supabase
    .from("inventory_balance_config")
    .select(INVENTORY_BALANCE_CONFIG_SELECT)
    .eq("tenant_id", tenantId);

  query =
    businessUnitId === null
      ? query.is("business_unit_id", null)
      : query.eq("business_unit_id", businessUnitId);

  return query.maybeSingle();
}
