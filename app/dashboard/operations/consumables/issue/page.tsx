import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  getActiveBusinessUnitId,
  getCurrentUserTenantId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import { resolveBusinessUnitReadScope } from "@/utils/business-unit-view";
import ConsumablesIssueScreen from "../../consumables-issue-screen";
import {
  fetchConsumableItemsForScope,
  fetchConsumableMovementsForScope,
  fetchConsumableSitesForScope,
} from "../../consumables-store-data";

export default async function ConsumablesIssuePage() {
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
  const [itemsResult, movementsResult, sitesResult] = await Promise.all([
    fetchConsumableItemsForScope(supabase, tenantId, buScope),
    fetchConsumableMovementsForScope(supabase, tenantId, buScope),
    fetchConsumableSitesForScope(supabase, tenantId, buScope),
  ]);
  const fetchError =
    itemsResult.error ?? movementsResult.error ?? sitesResult.error;
  return (
    <ConsumablesIssueScreen
      tenantId={tenantId}
      initialItems={itemsResult.items}
      initialMovements={movementsResult.movements}
      sites={sitesResult.sites}
      fetchError={fetchError}
    />
  );
}
