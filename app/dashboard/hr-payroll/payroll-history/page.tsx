import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
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

  const [
    { data: historyMonths, error: historyMonthsError },
    { data: monthEndCloseRows, error: monthEndCloseError },
    { data: employees, error: employeesError },
  ] = await Promise.all([
    supabase.from("payroll_history").select("payroll_month"),
    supabase.from("month_end_close").select("*"),
    supabase
      .from("employees")
      .select("employee_id, staff_id, full_name")
      .order("staff_id", { ascending: true }),
  ]);

  const fetchError =
    historyMonthsError?.message ??
    monthEndCloseError?.message ??
    employeesError?.message ??
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

  return (
    <HrPayrollShell sectionTitle="Payroll History">
      <PayrollHistory
        initialPayrollMonths={payrollMonths}
        initialMonthEndClose={
          (monthEndCloseRows as MonthEndCloseRecord[] | null) ?? []
        }
        initialEmployees={
          (employees as
            | { employee_id: string; staff_id: string; full_name: string }[]
            | null) ?? []
        }
        fetchError={fetchError}
      />
    </HrPayrollShell>
  );
}
