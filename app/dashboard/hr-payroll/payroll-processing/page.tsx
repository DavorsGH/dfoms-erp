import { cookies } from "next/headers";
import { createAdminClient } from "@/utils/supabase/admin";
import { createClient } from "@/utils/supabase/server";
import {
  getActiveBusinessUnitId,
  getCurrentUserRole,
  getCurrentUserTenantId,
  getViewAllBusinessUnits,
} from "@/utils/dashboard-auth";
import {
  applyBusinessUnitScope,
  resolveBusinessUnitReadScope,
} from "@/utils/business-unit-view";
import type { AppRole } from "@/app/dashboard/user-account-types";
import { canManagePayrollPeriod } from "@/utils/rbac-access";
import HrPayrollShell from "../hr-payroll-shell";
import PayrollProcessing from "../payroll-processing";
import { fetchStatutoryPayrollTaxConfigs } from "../statutory-payroll-config-utils";
import type {
  PayrollAttendanceSource,
  PayrollEmployeeSource,
  PayrollOvertimeSource,
} from "../payroll-processing-utils";
import type { MonthEndCloseRecord } from "../payroll-period-utils";
import type { LoanRegisterEntry } from "../loan-register-utils";
import type {
  AllowanceTypeRow,
  CompensationPolicyRow,
} from "../../administration/compensation-policy-utils";
import type { SalaryRateConfig } from "../../employees/pay-estimate-utils";
import { getAttendanceMonthBounds } from "../attendance-register-utils";
import {
  HR_PAYROLL_SETTINGS_SELECT,
  normalizeHrPayrollSettingsRow,
  type HrPayrollSettingsRow,
} from "@/utils/hr-payroll-settings-types";

export default async function PayrollProcessingPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const admin = createAdminClient();
  const now = new Date();
  const { start: attendanceStart, end: attendanceEnd } = getAttendanceMonthBounds(
    now.getFullYear(),
    now.getMonth() + 1,
  );
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

  const employeeSelect =
    "employee_id, staff_id, full_name, employment_type, employment_status, date_hired, appointment_end_date, position, shift, basic_salary, housing_allowance, transport_allowance, other_allowances, welfare_deduction_rate, business_unit_id, department, contract_project, payment_method, bank_name, account_number, momo_number, momo_name";

  const [
    { data: processingMonths, error: processingMonthsError },
    { data: historyMonths, error: historyMonthsError },
    { data: monthEndCloseRows, error: monthEndCloseError },
    { data: employees, error: employeesError },
    { data: attendance, error: attendanceError },
    { data: overtime, error: overtimeError },
    { data: loans, error: loansError },
    { data: salaryRates },
    { data: allowanceTypes },
    { data: compensationPolicies },
    statutoryTaxBundle,
    { data: hrPayrollSettingsRows, error: hrPayrollSettingsError },
  ] = await Promise.all([
    supabase.from("payroll_processing").select("payroll_month"),
    supabase.from("payroll_history").select("payroll_month"),
    applyBusinessUnitScope(
      supabase.from("month_end_close").select("*"),
      buScope,
    ),
    tenantId
      ? applyBusinessUnitScope(
          supabase
            .from("employees")
            .select(employeeSelect)
            .eq("tenant_id", tenantId),
          buScope,
        ).order("staff_id", { ascending: true })
      : Promise.resolve({
          data: null,
          error: { message: "Unable to resolve tenant for payroll employees." },
        }),
    supabase
      .from("attendance_register")
      .select("staff_id, date, attendance_status")
      .gte("date", attendanceStart)
      .lte("date", attendanceEnd),
    supabase
      .from("overtime_register")
      .select("employee_id, date, overtime_amount, approved_by")
      .gte("date", attendanceStart)
      .lte("date", attendanceEnd),
    supabase
      .from("loan_register")
      .select("*")
      .or("outstanding_balance.gt.0.01,outstanding_balance.is.null"),
    supabase
      .from("salary_rate_config")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("effective_date", { ascending: false }),
    supabase
      .from("allowance_types")
      .select("id, code, name, is_active, sort_order")
      .eq("tenant_id", tenantId)
      .order("sort_order", { ascending: true }),
    supabase
      .from("compensation_policy")
      .select("*")
      .eq("tenant_id", tenantId),
    fetchStatutoryPayrollTaxConfigs(admin),
    tenantId
      ? admin
          .from("hr_payroll_settings")
          .select(HR_PAYROLL_SETTINGS_SELECT)
          .eq("tenant_id", tenantId)
      : Promise.resolve({ data: null, error: null }),
  ]);

  const fetchError =
    (!tenantId ? "Unable to resolve tenant for payroll." : null) ??
    processingMonthsError?.message ??
    historyMonthsError?.message ??
    monthEndCloseError?.message ??
    employeesError?.message ??
    attendanceError?.message ??
    overtimeError?.message ??
    loansError?.message ??
    statutoryTaxBundle.error ??
    hrPayrollSettingsError?.message ??
    null;

  const normalizedHrPayrollSettingsRows = (
    (hrPayrollSettingsRows as HrPayrollSettingsRow[] | null) ?? []
  )
    .map((row) => normalizeHrPayrollSettingsRow(row))
    .filter((row): row is HrPayrollSettingsRow => row !== null);

  return (
    <HrPayrollShell sectionTitle="Payroll Processing">
      <PayrollProcessing
        tenantId={tenantId}
        initialPayrollMonths={[
          ...new Set(
            [
              ...((processingMonths as { payroll_month: string }[] | null) ?? []).map(
                (row) => row.payroll_month,
              ),
              ...((historyMonths as { payroll_month: string }[] | null) ?? []).map(
                (row) => row.payroll_month,
              ),
              ...((monthEndCloseRows as MonthEndCloseRecord[] | null) ?? []).map(
                (row) => row.month,
              ),
            ].filter(Boolean),
          ),
        ]}
        initialMonthEndClose={
          (monthEndCloseRows as MonthEndCloseRecord[] | null) ?? []
        }
        initialEmployees={(employees as PayrollEmployeeSource[] | null) ?? []}
        initialAttendance={(attendance as PayrollAttendanceSource[] | null) ?? []}
        initialOvertime={(overtime as PayrollOvertimeSource[] | null) ?? []}
        initialLoans={(loans as LoanRegisterEntry[] | null) ?? []}
        taxConfigs={statutoryTaxBundle.taxConfigs}
        compensationPolicyConfig={{
          salaryRates: (salaryRates as SalaryRateConfig[] | null) ?? [],
          allowanceTypes: (allowanceTypes as AllowanceTypeRow[] | null) ?? [],
          compensationPolicies:
            (compensationPolicies as CompensationPolicyRow[] | null) ?? [],
        }}
        canManagePayrollPeriod={canManagePayrollPeriod(
          (await getCurrentUserRole()) as AppRole | null,
        )}
        fetchError={fetchError}
        activeBusinessUnitId={activeBusinessUnitId}
        hrPayrollSettingsRows={normalizedHrPayrollSettingsRows}
      />
    </HrPayrollShell>
  );
}
