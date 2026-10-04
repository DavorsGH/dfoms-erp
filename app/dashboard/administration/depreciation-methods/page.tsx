import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";
import type { NamedLookup } from "../../lookup-types";
import DepreciationMethods from "../depreciation-methods";

export default async function DepreciationMethodsPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const tenantId = await getCurrentUserTenantId();

  if (!tenantId) {
    return (
      <>
        <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">
          Depreciation Methods
        </h2>
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          Unable to resolve tenant for Depreciation Methods.
        </p>
      </>
    );
  }

  const { data, error } = await supabase
    .from("depreciation_methods")
    .select("name")
    .eq("tenant_id", tenantId)
    .order("name", { ascending: true });

  return (
    <>
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">
        Depreciation Methods
      </h2>
      <DepreciationMethods
        tenantId={tenantId}
        initialMethods={(data as NamedLookup[] | null) ?? []}
        fetchError={error?.message ?? null}
      />
    </>
  );
}
