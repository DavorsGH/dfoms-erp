import { cookies } from "next/headers";
import { createClient } from "@/utils/supabase/server";
import { loadEmployeeLookups } from "../../employees/lookup-utils";
import HrPayrollShell from "../hr-payroll-shell";
import Payslip from "../payslip";
import {
  normalizePayrollMonthValue,
  payrollMonthToPeriodKey,
} from "../payroll-period-utils";

export default async function PayslipPage() {
  const cookieStore = await cookies();
  const supabase = createClient(cookieStore);

  const [{ data: historyMonths, error: historyMonthsError }, lookups] =
    await Promise.all([
      supabase.from("payroll_history").select("payroll_month"),
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
    <HrPayrollShell sectionTitle="Payslip">
      <Payslip
        initialPayrollMonths={payrollMonths}
        positions={lookups.positions}
        fetchError={historyMonthsError?.message ?? null}
      />
    </HrPayrollShell>
  );
}
