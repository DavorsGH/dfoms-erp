import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  HR_EMPLOYEE_SELECT,
  filterActiveEmployees,
  type HrEmployee,
} from "../hr-payroll/employee-utils";
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

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [
    { data, error },
    { data: employees, error: employeesError },
    { data: sites, error: sitesError },
    { data: account },
  ] = await Promise.all([
    supabase
      .from("consumables")
      .select(CONSUMABLES_SELECT)
      .order("date", { ascending: false }),
    supabase.from("employees").select(HR_EMPLOYEE_SELECT).order("full_name"),
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
    error?.message ?? employeesError?.message ?? sitesError?.message ?? null;

  const defaultRecordedBy =
    (account as { employee_id?: string | null } | null)?.employee_id ?? "";

  return (
    <OperationsShell sectionTitle="Consumables">
      <ConsumablesRegister
        initialEntries={(data as ConsumablesEntry[] | null) ?? []}
        initialEmployees={filterActiveEmployees(
          (employees as HrEmployee[] | null) ?? [],
        )}
        initialSites={(sites as ConsumablesSiteOption[] | null) ?? []}
        defaultRecordedBy={defaultRecordedBy}
        fetchError={fetchError}
      />
    </OperationsShell>
  );
}
