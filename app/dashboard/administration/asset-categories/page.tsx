import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";
import AssetCategories from "../asset-categories";

export default async function AssetCategoriesPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const tenantId = await getCurrentUserTenantId();

  if (!tenantId) {
    return (
      <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        Unable to resolve tenant for Asset Categories.
      </p>
    );
  }

  const { data, error } = await supabase
    .from("asset_categories")
    .select("name, is_active")
    .eq("tenant_id", tenantId)
    .order("name", { ascending: true });

  return (
    <>
      <AssetCategories
        tenantId={tenantId}
        initialCategories={
          (data as Array<{ name: string; is_active?: boolean }> | null) ?? []
        }
        fetchError={error?.message ?? null}
      />
    </>
  );
}
