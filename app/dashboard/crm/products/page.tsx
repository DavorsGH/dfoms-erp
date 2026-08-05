import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createClient } from "@/utils/supabase/server";
import { createAdminClient } from "@/utils/supabase/admin";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";
import { getPlatformOnlyUnitActivationPricing } from "@/utils/platform-billing-config";
import {
  DAVORS_TENANT_ID,
  isDavorsPlatformTenant,
} from "@/utils/tenant-signup";
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

  const [{ data, error }, platformPricing] = await Promise.all([
    supabase
      .from("crm_products")
      .select(CRM_PRODUCT_SELECT)
      .order("name", { ascending: true }),
    getPlatformOnlyUnitActivationPricing(admin),
  ]);

  return (
    <CrmShell sectionTitle="Product Catalog">
      <Products
        initialProducts={(data as CrmProductEntry[] | null) ?? []}
        platformUnitActivationPriceGhs={platformPricing.priceGhs}
        showPlatformBillingCatalogEntry={tenantId === DAVORS_TENANT_ID}
        fetchError={error?.message ?? null}
      />
    </CrmShell>
  );
}
