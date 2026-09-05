import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  getActiveBusinessUnitId,
  getCurrentUserEmployeeId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import {
  applyBusinessUnitScope,
  resolveBusinessUnitReadScope,
} from "@/utils/business-unit-view";
import {
  COMMISSION_CALCULATION_LIST_SELECT,
  normalizeCommissionCalculationRow,
  type CommissionCalculationRow,
} from "@/utils/commission-types";
import {
  filterActiveEmployees,
  HR_EMPLOYEE_SELECT,
  type HrEmployee,
} from "../../hr-payroll/employee-utils";
import CrmShell from "../crm-shell";
import CommissionsWorkbench from "./commissions-workbench";

export default async function CommissionsPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const [activeBusinessUnitId, viewAllBusinessUnits] = await Promise.all([
    getActiveBusinessUnitId(),
    getViewAllBusinessUnits(),
  ]);
  const buScope = resolveBusinessUnitReadScope({
    viewAllBusinessUnits,
    activeBusinessUnitId,
  });

  const [
    { data: calculations, error: calculationsError },
    { data: employees, error: employeesError },
    defaultEmployeeId,
  ] = await Promise.all([
    supabase
      .from("commission_calculations")
      .select(COMMISSION_CALCULATION_LIST_SELECT)
      .order("calculated_at", { ascending: false }),
    applyBusinessUnitScope(
      supabase.from("employees").select(HR_EMPLOYEE_SELECT),
      buScope,
    ).order("full_name"),
    getCurrentUserEmployeeId(),
  ]);

  return (
    <CrmShell sectionTitle="Commissions">
      <CommissionsWorkbench
        initialEmployees={filterActiveEmployees(
          (employees as HrEmployee[] | null) ?? [],
        )}
        defaultEmployeeId={defaultEmployeeId ?? ""}
        initialCalculations={
          ((calculations as CommissionCalculationRow[] | null) ?? []).map(
            normalizeCommissionCalculationRow,
          )
        }
        fetchError={calculationsError?.message ?? employeesError?.message ?? null}
      />
    </CrmShell>
  );
}
