import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  getActiveBusinessUnitId,
  getCurrentUserTenantId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import {
  applyBusinessUnitScope,
  resolveBusinessUnitReadScope,
} from "@/utils/business-unit-view";
import {
  DAVORS_TENANT_ID,
  isDavorsPlatformTenant,
} from "@/utils/tenant-signup";
import { syncDavorsSystemManagedCrmCatalogProducts } from "@/utils/sync-davors-system-crm-catalog-products";
import CrmShell from "../crm-shell";
import Products from "./products";
import { CRM_PRODUCT_SELECT, type CrmProductEntry } from "./products-utils";

export default async function ProductsPage() {
  const tenantId = await getCurrentUserTenantId();
  if (!isDavorsPlatformTenant(tenantId)) {
    redirect("/dashboard/crm/customers");
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const admin = createAdminClient();
  const [activeBusinessUnitId, viewAllBusinessUnits] = await Promise.all([
    getActiveBusinessUnitId(),
    getViewAllBusinessUnits(),
  ]);
  const buScope = resolveBusinessUnitReadScope({
    viewAllBusinessUnits,
    activeBusinessUnitId,
  });

  if (tenantId === DAVORS_TENANT_ID) {
    try {
      await syncDavorsSystemManagedCrmCatalogProducts(admin);
    } catch (syncError) {
      console.error("[products-page] system catalog sync failed:", syncError);
    }
  }

  const { data, error } = await applyBusinessUnitScope(
    supabase.from("crm_products").select(CRM_PRODUCT_SELECT),
    buScope,
  ).order("name", { ascending: true });

  return (
    <CrmShell sectionTitle="Product Catalog">
      <Products
        initialProducts={(data as CrmProductEntry[] | null) ?? []}
        fetchError={error?.message ?? null}
      />
    </CrmShell>
  );
}
