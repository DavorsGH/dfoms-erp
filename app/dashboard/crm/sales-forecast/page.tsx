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
  filterActiveEmployees,
  HR_EMPLOYEE_SELECT,
  type HrEmployee,
} from "../../hr-payroll/employee-utils";
import CrmShell from "../crm-shell";
import SalesForecastView from "./sales-forecast-view";

export default async function SalesForecastPage() {
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

  const [{ data: employees, error }, defaultEmployeeId] = await Promise.all([
    applyBusinessUnitScope(
      supabase.from("employees").select(HR_EMPLOYEE_SELECT),
      buScope,
    ).order("full_name"),
    getCurrentUserEmployeeId(),
  ]);

  return (
    <CrmShell sectionTitle="Sales Forecast">
      <SalesForecastView
        initialEmployees={filterActiveEmployees(
          (employees as HrEmployee[] | null) ?? [],
        )}
        defaultEmployeeId={defaultEmployeeId ?? ""}
        fetchError={error?.message ?? null}
      />
    </CrmShell>
  );
}
