import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  getActiveBusinessUnitId,
  getCurrentUserTenantId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import { resolveBusinessUnitReadScope } from "@/utils/business-unit-view";
import ConsumablesStoreStockScreen from "../../consumables-store-stock-screen";
import {
  fetchConsumableItemsForScope,
  fetchConsumableMovementsForScope,
} from "../../consumables-store-data";

export default async function ConsumablesStorePage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const [tenantId, activeBusinessUnitId, viewAllBusinessUnits] =
    await Promise.all([
      getCurrentUserTenantId(),
      getActiveBusinessUnitId(),
      getViewAllBusinessUnits(),
    ]);
  if (!tenantId) throw new Error("Unable to resolve workspace.");
  const buScope = resolveBusinessUnitReadScope({
    viewAllBusinessUnits,
    activeBusinessUnitId,
  });
  const [itemsResult, movementsResult] = await Promise.all([
    fetchConsumableItemsForScope(supabase, tenantId, buScope),
    fetchConsumableMovementsForScope(supabase, tenantId, buScope),
  ]);
  const fetchError = itemsResult.error ?? movementsResult.error;
  return (
    <ConsumablesStoreStockScreen
      initialItems={itemsResult.items}
      initialMovements={movementsResult.movements}
      fetchError={fetchError}
    />
  );
}
