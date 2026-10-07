import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  getUserAllowedBusinessUnits,
  resolveWriteBusinessUnitId,
} from "@/utils/business-unit-access";
import { fetchActiveBusinessUnitIds } from "@/utils/business-unit-access.server";
import { resolveCreateBusinessUnitId } from "@/utils/business-unit-stamp";
import { INVENTORY_BALANCE_CONFIG_SELECT } from "@/utils/inventory-balance-config-types";

/**
 * BU key for inventory_balance_config rows: explicit switcher on multi-BU tenants,
 * sole active unit when only one exists, restricted users' default allowed unit.
 */
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

  const activeUnitIds = await fetchActiveBusinessUnitIds(supabase, tenantId);
  const multiBuTenant = activeUnitIds.length > 1;
  const singleBuId = activeUnitIds.length === 1 ? activeUnitIds[0]! : null;

  if (allowedUnits !== null) {
    if (singleBuId) {
      return resolveWriteBusinessUnitId({
        allowedUnits,
        requestedBusinessUnitId: singleBuId,
      });
    }
    return resolveWriteBusinessUnitId({
      allowedUnits,
      requestedBusinessUnitId: undefined,
    });
  }

  if (singleBuId) {
    return singleBuId;
  }

  return resolveCreateBusinessUnitId({
    requireExplicitSwitcherSelection: multiBuTenant,
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
