import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";
import type { ServiceType } from "../service-types";
import ServiceCategories from "./service-categories";

export default async function ServiceCategoriesPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const tenantId = await getCurrentUserTenantId();

  if (!tenantId) {
    return (
      <>
        <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">
          Service Categories
        </h2>
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Unable to resolve tenant for Service Categories.
        </p>
      </>
    );
  }

  const { data, error } = await supabase
    .from("service_types")
    .select("name")
    .eq("tenant_id", tenantId)
    .order("name", { ascending: true });

  return (
    <>
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">
        Service Categories
      </h2>
      <ServiceCategories
        tenantId={tenantId}
        initialCategories={(data as ServiceType[] | null) ?? []}
        fetchError={error?.message ?? null}
      />
    </>
  );
}
