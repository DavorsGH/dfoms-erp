import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  SALES_TARGET_LIST_SELECT,
  type SalesTargetListRow,
} from "@/utils/sales-targets-types";
import {
  filterActiveEmployees,
  HR_EMPLOYEE_SELECT,
  type HrEmployee,
} from "../../hr-payroll/employee-utils";
import CrmShell from "../crm-shell";
import SalesTargetsList from "./sales-targets-list";

export default async function SalesTargetsPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [{ data, error }, { data: employees, error: employeesError }] =
    await Promise.all([
      supabase
        .from("sales_targets")
        .select(SALES_TARGET_LIST_SELECT)
        .order("period_start", { ascending: false }),
      supabase.from("employees").select(HR_EMPLOYEE_SELECT).order("full_name"),
    ]);

  return (
    <CrmShell sectionTitle="Sales Targets">
      <SalesTargetsList
        initialEmployees={filterActiveEmployees(
          (employees as HrEmployee[] | null) ?? [],
        )}
        initialTargets={((data as SalesTargetListRow[] | null) ?? []).filter(
          (row): row is SalesTargetListRow => Boolean(row?.id),
        )}
        fetchError={error?.message ?? employeesError?.message ?? null}
      />
    </CrmShell>
  );
}
