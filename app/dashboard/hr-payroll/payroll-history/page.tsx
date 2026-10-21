import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import {
  getActiveBusinessUnitId,
  getCurrentUserTenantId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import {
  applyBusinessUnitScope,
  resolveBusinessUnitReadScope,
} from "@/utils/business-unit-view";
import {
  applyEmployeeIdScope,
  fetchScopedEmployeeIds,
} from "../payroll-bu-scope-utils";
import HrPayrollShell from "../hr-payroll-shell";
import PayrollHistory from "../payroll-history";
import {
  normalizePayrollMonthValue,
  payrollMonthToPeriodKey,
  type MonthEndCloseRecord,
} from "../payroll-period-utils";

export default async function PayrollHistoryPage() {
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

  const scopedEmployees = tenantId
    ? await fetchScopedEmployeeIds(supabase, tenantId, buScope)
    : { employeeIds: [] as string[], error: "Unable to resolve tenant." };
  const employeeIds = scopedEmployees.employeeIds;

  let employeesQuery = supabase
    .from("employees")
    .select(
      "employee_id, staff_id, full_name, employment_type, position, shift, contract_project, assigned_site_id",
    )
    .order("staff_id", { ascending: true });
  if (tenantId) {
    employeesQuery = employeesQuery.eq("tenant_id", tenantId);
  }
  employeesQuery = applyBusinessUnitScope(employeesQuery, buScope);

  const [
    { data: historyMonths, error: historyMonthsError },
    { data: monthEndCloseRows, error: monthEndCloseError },
    { data: employees, error: employeesError },
    { data: sites, error: sitesError },
  ] = await Promise.all([
    applyEmployeeIdScope(
      supabase.from("payroll_history").select("payroll_month"),
      employeeIds,
    ),
    applyBusinessUnitScope(
      supabase.from("month_end_close").select("*"),
      buScope,
    ),
    employeesQuery,
    tenantId
      ? supabase
          .from("sites")
          .select("site_code, site_name")
          .eq("tenant_id", tenantId)
          .order("site_name")
      : Promise.resolve({ data: [], error: null }),
  ]);

  const fetchError =
    scopedEmployees.error ??
    historyMonthsError?.message ??
    monthEndCloseError?.message ??
    employeesError?.message ??
    sitesError?.message ??
    null;

  const payrollMonths = [
    ...new Set(
      ((historyMonths as { payroll_month: string }[] | null) ?? [])
        .map((row) => normalizePayrollMonthValue(row.payroll_month))
        .filter(Boolean),
    ),
  ].sort((left, right) => {
    const leftKey = payrollMonthToPeriodKey(left) ?? left;
    const rightKey = payrollMonthToPeriodKey(right) ?? right;
    return rightKey.localeCompare(leftKey);
  });

  const initialSiteNameByCode: Record<string, string> = {};
  for (const site of (sites as Array<{
    site_code: string;
    site_name: string;
  }> | null) ?? []) {
    if (site.site_code) {
      initialSiteNameByCode[site.site_code] = site.site_name || site.site_code;
    }
  }

  return (
    <HrPayrollShell sectionTitle="Payroll History">
      <PayrollHistory
        initialPayrollMonths={payrollMonths}
        initialMonthEndClose={
          (monthEndCloseRows as MonthEndCloseRecord[] | null) ?? []
        }
        initialEmployees={
          (employees as
            | {
                employee_id: string;
                staff_id: string;
                full_name: string;
                employment_type: string | null;
                position: string | null;
                shift: string | null;
                contract_project: string | null;
                assigned_site_id: string | null;
              }[]
            | null) ?? []
        }
        initialSiteNameByCode={initialSiteNameByCode}
        fetchError={fetchError}
      />
    </HrPayrollShell>
  );
}
