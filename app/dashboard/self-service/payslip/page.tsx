import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { getCurrentUserEmployeeId } from "@/utils/dashboard-auth";
import { loadEmployeeLookups } from "../../employees/lookup-utils";
import Payslip from "../../hr-payroll/payslip";
import {
  normalizePayrollMonthValue,
  payrollMonthToPeriodKey,
} from "../../hr-payroll/payroll-period-utils";
import SelfServiceShell from "../self-service-shell";

export default async function SelfServicePayslipPage() {
  const employeeId = await getCurrentUserEmployeeId();

  if (!employeeId) {
    return (
      <SelfServiceShell sectionTitle="My Payslip">
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          Your user account is not linked to an employee record. Contact HR or
          your administrator.
        </div>
      </SelfServiceShell>
    );
  }

  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [{ data: historyMonths, error: historyMonthsError }, lookups] =
    await Promise.all([
      supabase
        .from("payroll_history")
        .select("payroll_month")
        .eq("employee_id", employeeId),
      loadEmployeeLookups(supabase),
    ]);

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
    <SelfServiceShell sectionTitle="My Payslip">
      <Payslip
        initialPayrollMonths={payrollMonths}
        positions={lookups.positions}
        fetchError={historyMonthsError?.message ?? null}
        scopedEmployeeId={employeeId}
      />
    </SelfServiceShell>
  );
}
