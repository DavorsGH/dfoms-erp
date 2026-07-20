import { cookies } from "next/headers";
import { createAdminClient } from "@/utils/supabase/admin";
import { createClient } from "@/utils/supabase/server";
import { DAVORS_TENANT_ID } from "@/utils/tenant-signup";
import { getCurrentUserRole } from "@/utils/dashboard-auth";
import type { AppRole } from "@/app/dashboard/user-account-types";
import { canManagePayrollPeriod } from "@/utils/rbac-access";
import HrPayrollShell from "../hr-payroll-shell";
import PayrollProcessing from "../payroll-processing";
import {
  mapCasualTaxConfigRows,
  mapPayrollPayeBandRows,
  mapSsnitConfigRows,
  type PayrollAttendanceSource,
  type PayrollEmployeeSource,
  type PayrollOvertimeSource,
} from "../payroll-processing-utils";
import type { MonthEndCloseRecord } from "../payroll-period-utils";
import type { LoanRegisterEntry } from "../loan-register-utils";

export default async function PayrollProcessingPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);
  const admin = createAdminClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const [
    { data: processingMonths, error: processingMonthsError },
    { data: historyMonths, error: historyMonthsError },
    { data: monthEndCloseRows, error: monthEndCloseError },
    { data: employees, error: employeesError },
    { data: attendance, error: attendanceError },
    { data: overtime, error: overtimeError },
    { data: loans, error: loansError },
    { data: ssnitRows, error: ssnitError },
    { data: casualRows, error: casualError },
    { data: payeRows, error: payeError },
  ] = await Promise.all([
    supabase.from("payroll_processing").select("payroll_month"),
    supabase.from("payroll_history").select("payroll_month"),
    supabase.from("month_end_close").select("*"),
    supabase
      .from("employees")
      .select(
        "employee_id, staff_id, full_name, employment_type, employment_status, date_hired, appointment_end_date, basic_salary, housing_allowance, transport_allowance, other_allowances, department, contract_project",
      )
      .order("staff_id", { ascending: true }),
    supabase
      .from("attendance_register")
      .select("staff_id, date, attendance_status"),
    supabase
      .from("overtime_register")
      .select("employee_id, date, overtime_amount"),
    supabase.from("loan_register").select("*"),
    admin
      .from("ssnit_rate_config")
      .select("*")
      .eq("tenant_id", DAVORS_TENANT_ID)
      .order("effective_date", { ascending: false }),
    admin
      .from("casual_tax_rate_config")
      .select("*")
      .eq("tenant_id", DAVORS_TENANT_ID)
      .order("effective_date", { ascending: false }),
    admin
      .from("paye_tax_bands")
      .select("band_order, lower_bound, upper_bound, rate, effective_date")
      .eq("tenant_id", DAVORS_TENANT_ID)
      .order("effective_date", { ascending: false })
      .order("band_order", { ascending: true }),
  ]);

  const fetchError =
    processingMonthsError?.message ??
    historyMonthsError?.message ??
    monthEndCloseError?.message ??
    employeesError?.message ??
    attendanceError?.message ??
    overtimeError?.message ??
    loansError?.message ??
    ssnitError?.message ??
    casualError?.message ??
    payeError?.message ??
    null;

  return (
    <HrPayrollShell sectionTitle="Payroll Processing">
      <PayrollProcessing
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
        taxConfigs={{
          ssnitRows: mapSsnitConfigRows(
            (ssnitRows as Record<string, unknown>[] | null) ?? [],
          ),
          casualRows: mapCasualTaxConfigRows(
            (casualRows as Record<string, unknown>[] | null) ?? [],
          ),
          payeBands: mapPayrollPayeBandRows(
            (payeRows as Record<string, unknown>[] | null) ?? [],
          ),
        }}
        canManagePayrollPeriod={canManagePayrollPeriod(
          (await getCurrentUserRole()) as AppRole | null,
        )}
        fetchError={fetchError}
      />
    </HrPayrollShell>
  );
}
