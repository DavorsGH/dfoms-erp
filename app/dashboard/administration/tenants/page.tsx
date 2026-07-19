import { redirect } from "next/navigation";
import { isDavorsPlatformSuperAdmin } from "@/utils/dashboard-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import {
  CRM_PRODUCT_SELECT,
  ERP_SUITE_CATEGORY,
  type CrmProductEntry,
} from "../../crm/products/products-utils";
import { DAVORS_TENANT_ID } from "@/utils/tenant-signup";
import { fetchCustomerTenantRows } from "@/utils/tenant-management";
import TenantManagement from "../tenants";

export default async function TenantsPage() {
  if (!(await isDavorsPlatformSuperAdmin())) {
    redirect("/dashboard");
  }

  const admin = createAdminClient();

  const [{ rows, fetchError }, { data: products, error: productsError }] =
    await Promise.all([
      fetchCustomerTenantRows(admin),
      admin
        .from("crm_products")
        .select(CRM_PRODUCT_SELECT)
        .eq("tenant_id", DAVORS_TENANT_ID)
        .eq("category", ERP_SUITE_CATEGORY)
        .order("name", { ascending: true }),
    ]);

  return (
    <>
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">
        Tenant Management
      </h2>
      <TenantManagement
        initialRows={rows}
        tierOptions={(products as CrmProductEntry[] | null) ?? []}
        fetchError={fetchError ?? productsError?.message ?? null}
      />
    </>
  );
}
