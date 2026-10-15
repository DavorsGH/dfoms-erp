import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  getActiveBusinessUnitId,
  getCurrentUserTenantId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import { resolveBusinessUnitReadScope } from "@/utils/business-unit-view";
import ConsumablesItemsScreen from "../../consumables-items-screen";
import {
  fetchConsumableExpenseSubcategories,
  fetchConsumableItemsForScope,
} from "../../consumables-store-data";

export default async function ConsumablesItemsPage() {
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
  const [itemsResult, subcategoriesResult] = await Promise.all([
    fetchConsumableItemsForScope(supabase, tenantId, buScope),
    fetchConsumableExpenseSubcategories(supabase),
  ]);
  const fetchError = itemsResult.error ?? subcategoriesResult.error;
  return (
    <ConsumablesItemsScreen
      tenantId={tenantId}
      initialItems={itemsResult.items}
      expenseSubcategories={subcategoriesResult.subcategories}
      fetchError={fetchError}
    />
  );
}
