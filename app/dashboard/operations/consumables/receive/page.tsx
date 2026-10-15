import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  getActiveBusinessUnitId,
  getCurrentUserTenantId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import { resolveBusinessUnitReadScope } from "@/utils/business-unit-view";
import ConsumablesReceiveScreen from "../../consumables-receive-screen";
import {
  fetchConsumableItemsForScope,
  fetchConsumableMovementsForScope,
  fetchConsumablePurchaseLinkOptions,
  fetchConsumableSuppliers,
} from "../../consumables-store-data";

export default async function ConsumablesReceivePage() {
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
  const since = new Date();
  since.setDate(since.getDate() - 120);
  const sinceDate = since.toISOString().slice(0, 10);
  const [itemsResult, movementsResult, linksResult, suppliersResult] =
    await Promise.all([
      fetchConsumableItemsForScope(supabase, tenantId, buScope),
      fetchConsumableMovementsForScope(supabase, tenantId, buScope),
      fetchConsumablePurchaseLinkOptions(
        supabase,
        tenantId,
        buScope,
        sinceDate,
      ),
      fetchConsumableSuppliers(supabase, tenantId),
    ]);
  const fetchError =
    itemsResult.error ??
    movementsResult.error ??
    linksResult.error ??
    suppliersResult.error;
  return (
    <ConsumablesReceiveScreen
      tenantId={tenantId}
      initialItems={itemsResult.items}
      initialMovements={movementsResult.movements}
      expenses={linksResult.expenses}
      payables={linksResult.payables}
      suppliers={suppliersResult.suppliers}
      fetchError={fetchError}
    />
  );
}
