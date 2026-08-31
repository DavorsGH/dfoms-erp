import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  getActiveBusinessUnitId,
  getCurrentUserTenantId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import { resolveBusinessUnitReadScope } from "@/utils/business-unit-view";
import { fetchScopedActiveEmployees } from "@/app/dashboard/hr-payroll/payroll-bu-scope-utils";
import type { HrEmployee } from "../../hr-payroll/employee-utils";
import ConsumablesRegister from "../consumables";
import {
  CONSUMABLES_SELECT,
  CONSUMABLES_SITE_SELECT,
  type ConsumablesEntry,
  type ConsumablesSiteOption,
} from "../consumables-utils";
import OperationsShell from "../operations-shell";

export default async function ConsumablesPage() {
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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [
    { data, error },
    scopedEmployees,
    { data: sites, error: sitesError },
    { data: account },
  ] = await Promise.all([
    supabase
      .from("consumables")
      .select(CONSUMABLES_SELECT)
      .order("date", { ascending: false }),
    tenantId
      ? fetchScopedActiveEmployees(supabase, tenantId, buScope)
      : Promise.resolve({
          employees: [] as HrEmployee[],
          error: "Unable to resolve your workspace.",
        }),
    supabase
      .from("sites")
      .select(CONSUMABLES_SITE_SELECT)
      .order("site_name", { ascending: true }),
    user
      ? supabase
          .from("user_accounts")
          .select("employee_id")
          .eq("auth_uid", user.id)
          .maybeSingle()
      : Promise.resolve({ data: null }),
  ]);

  const fetchError =
    scopedEmployees.error ??
    error?.message ??
    sitesError?.message ??
    null;

  const defaultRecordedBy =
    (account as { employee_id?: string | null } | null)?.employee_id ?? "";

  return (
    <OperationsShell sectionTitle="Consumables">
      <ConsumablesRegister
        initialEntries={(data as ConsumablesEntry[] | null) ?? []}
        initialEmployees={scopedEmployees.employees}
        initialSites={(sites as ConsumablesSiteOption[] | null) ?? []}
        defaultRecordedBy={defaultRecordedBy}
        fetchError={fetchError}
        tenantId={tenantId}
      />
    </OperationsShell>
  );
}
