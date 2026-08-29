import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserTenantId } from "@/utils/dashboard-auth";
import {
  BUSINESS_UNIT_SELECT,
  type BusinessUnitRow,
} from "@/utils/business-units-types";
import BusinessUnitsSettings from "../business-units-settings";

export default async function BusinessUnitsPage() {
  const tenantId = await getCurrentUserTenantId();

  if (!tenantId) {
    return (
      <>
        <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">
          Business Units
        </h2>
        <p className="text-sm text-red-700">
          Unable to resolve your workspace. Contact support if this persists.
        </p>
      </>
    );
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const { data, error } = await supabase
    .from("business_units")
    .select(BUSINESS_UNIT_SELECT)
    .eq("tenant_id", tenantId)
    .order("name", { ascending: true });

  return (
    <>
      <h2 className="mb-6 text-xl font-semibold text-[#0f2744]">
        Business Units
      </h2>
      <BusinessUnitsSettings
        tenantId={tenantId}
        initialUnits={(data as BusinessUnitRow[] | null) ?? []}
        fetchError={error?.message ?? null}
      />
    </>
  );
}
