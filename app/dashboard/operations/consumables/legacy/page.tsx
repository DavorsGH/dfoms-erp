import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  getActiveBusinessUnitId,
  getCurrentUserTenantId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import { resolveBusinessUnitReadScope } from "@/utils/business-unit-view";
import { fetchScopedActiveEmployees } from "@/app/dashboard/hr-payroll/payroll-bu-scope-utils";
import ConsumablesRegister from "../../consumables";
import {
  CONSUMABLES_SELECT,
  CONSUMABLES_SITE_SELECT,
  type ConsumablesEntry,
  type ConsumablesSiteOption,
} from "../../consumables-utils";
import { redirect } from "next/navigation";

export default async function ConsumablesLegacyPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const [tenantId, activeBusinessUnitId, viewAllBusinessUnits] =
    await Promise.all([
      getCurrentUserTenantId(),
      getActiveBusinessUnitId(),
      getViewAllBusinessUnits(),
    ]);
  const buScope = resolveBusinessUnitReadScope({
    viewAllBusinessUnits,
    activeBusinessUnitId,
  });

  const { count } = await supabase
    .from("consumables")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId ?? "");
  if ((count ?? 0) === 0) {
    redirect("/dashboard/operations/consumables/store");
  }

  const [
    { data, error },
    scopedEmployees,
    { data: sites, error: sitesError },
  ] = await Promise.all([
    supabase
      .from("consumables")
      .select(CONSUMABLES_SELECT)
      .order("date", { ascending: false }),
    tenantId
      ? fetchScopedActiveEmployees(supabase, tenantId, buScope)
      : Promise.resolve({ employees: [], error: null }),
    supabase
      .from("sites")
      .select(CONSUMABLES_SITE_SELECT)
      .order("site_name", { ascending: true }),
  ]);

  return (
    <>
      <p className="mb-4 text-sm text-amber-800">
        Read-only legacy sheet. New stock is managed on the Store tabs.
      </p>
      <ConsumablesRegister
        readOnly
        initialEntries={(data as ConsumablesEntry[] | null) ?? []}
        initialEmployees={scopedEmployees.employees}
        initialSites={(sites as ConsumablesSiteOption[] | null) ?? []}
        defaultRecordedBy=""
        fetchError={
          scopedEmployees.error ?? error?.message ?? sitesError?.message ?? null
        }
        tenantId={tenantId}
      />
    </>
  );
}
