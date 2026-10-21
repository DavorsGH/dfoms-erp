/**
 * Read-only: October staging welfare before/after using live absence counts.
 *   npx tsx scripts/tmp/r48-oct-welfare-live-readonly.ts
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  calculatePayrollRow,
  countAbsencesForStaff,
  type PayrollAttendanceSource,
  type PayrollEmployeeSource,
  type PayrollTaxConfigs,
} from "../../app/dashboard/hr-payroll/payroll-processing-utils";
import { resolveSelectedPeriod } from "../../app/dashboard/hr-payroll/payroll-period-utils";
import { getAttendanceMonthBounds } from "../../app/dashboard/hr-payroll/attendance-register-utils";
import { resolvePayrollWelfareConfigForEmployee } from "../../utils/hr-payroll-settings-types";

function loadEnvForce(filePath: string) {
  for (const line of readFileSync(resolve(filePath), "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    process.env[t.slice(0, i).trim()] = v;
  }
}

function round2(n: number) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

async function main() {
  loadEnvForce(".env.staging.local");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!;
  const admin = createClient(url, key, { auth: { persistSession: false } });

  const period = resolveSelectedPeriod(2026, 10);
  const { start, end } = getAttendanceMonthBounds(2026, 10);

  const { data: processing, error: pErr } = await admin
    .from("payroll_processing")
    .select("*")
    .eq("payroll_month", "2026-10-01");
  if (pErr) throw pErr;

  const employeeIds = [...new Set((processing ?? []).map((r) => r.employee_id))];
  const { data: employees, error: eErr } = await admin
    .from("employees")
    .select(
      "employee_id, staff_id, full_name, employment_type, employment_status, date_hired, appointment_end_date, position, shift, basic_salary, housing_allowance, transport_allowance, other_allowances, welfare_deduction_rate, department, contract_project, business_unit_id, tenant_id",
    )
    .in("employee_id", employeeIds);
  if (eErr) throw eErr;
  const empById = new Map((employees ?? []).map((e) => [e.employee_id, e]));

  const tenantIds = [...new Set((employees ?? []).map((e) => e.tenant_id))];
  const { data: attendance, error: aErr } = await admin
    .from("attendance_register")
    .select("staff_id, date, attendance_status, exception_status, tenant_id")
    .gte("date", start)
    .lte("date", end)
    .in("tenant_id", tenantIds);
  if (aErr) throw aErr;

  const { data: settings } = await admin
    .from("hr_payroll_settings")
    .select("tenant_id, business_unit_id, default_welfare_deduction_rate, include_overtime_in_welfare, created_at, updated_at")
    .in("tenant_id", tenantIds);

  const { data: ssnitRows } = await admin.from("ssnit_tax_config").select("*");
  const { data: casualRows } = await admin.from("casual_tax_config").select("*");
  const { data: payeBands } = await admin.from("paye_tax_bands").select("*");
  const { data: overtimeRows } = await admin.from("overtime_tax_config").select("*");

  const tax: PayrollTaxConfigs = {
    ssnitRows: ssnitRows ?? [],
    casualRows: casualRows ?? [],
    payeBands: payeBands ?? [],
    overtimeRows: overtimeRows ?? [],
  };

  console.log("staff_id | name | absence | welfare before | after | delta");
  const diffs = [];

  for (const row of processing ?? []) {
    const emp = empById.get(row.employee_id) as PayrollEmployeeSource | undefined;
    if (!emp) continue;
    const rate = Number(emp.welfare_deduction_rate) || 0;
    if (rate <= 0) continue;

    const staffAttendance = ((attendance ?? []) as PayrollAttendanceSource[]).filter(
      (a) => a.staff_id === emp.staff_id,
    );
    const absenceCount = countAbsencesForStaff(
      staffAttendance,
      emp.staff_id,
      2026,
      10,
    );
    if (absenceCount <= 0) continue;

    const welfareConfig = resolvePayrollWelfareConfigForEmployee(
      emp.business_unit_id ?? null,
      (settings ?? []).filter((s) => s.tenant_id === (emp as { tenant_id?: string }).tenant_id),
    );

    const afterRow = calculatePayrollRow(
      emp,
      period,
      tax,
      {
        absenceCount,
        overtimeAmount: Number(row.overtime_amount) || 0,
        loanRepayment: Number(row.loan_repayment) || 0,
      },
      {
        days_to_pay: Number(row.days_to_pay) || period.totalWorkingDays,
        bonuses: Number(row.bonuses) || 0,
        arrears: Number(row.arrears) || 0,
        salary_advance: Number(row.salary_advance) || 0,
        other_deductions: Number(row.other_deductions) || 0,
        net_only_adjustment: Number(row.net_only_adjustment) || 0,
      },
      null,
      welfareConfig,
    );

    // Before R48: same calc but welfare on pre-absence (simulate by forcing asOf Sep for welfare only)
    const preAbsenceGross = round2(
      afterRow.gross_pay + afterRow.absence_deduction,
    );
    let beforeBase = preAbsenceGross;
    if (welfareConfig.includeOvertimeInWelfare === false) {
      beforeBase = Math.max(beforeBase - (Number(row.overtime_amount) || 0), 0);
    }
    const beforeWelfare = round2((beforeBase * rate) / 100);
    const afterWelfare = afterRow.welfare_deduction;
    if (beforeWelfare === afterWelfare) continue;

    diffs.push({
      staff_id: emp.staff_id,
      full_name: emp.full_name,
      absence: afterRow.absence_deduction,
      before: beforeWelfare,
      after: afterWelfare,
      delta: round2(afterWelfare - beforeWelfare),
      gross: afterRow.gross_pay,
      paye: afterRow.paye_tax,
      net: afterRow.net_pay,
    });
  }

  diffs.sort((a, b) =>
    String(a.staff_id).localeCompare(String(b.staff_id), undefined, { numeric: true }),
  );
  for (const d of diffs) {
    console.log(
      `${d.staff_id} | ${d.full_name} | ${d.absence.toFixed(2)} | ${d.before.toFixed(2)} | ${d.after.toFixed(2)} | ${d.delta.toFixed(2)}`,
    );
  }
  console.log(`\n${diffs.length} employees whose welfare changes`);
  const patience = diffs.find((d) => d.staff_id === "DF0020");
  if (patience) {
    console.log(
      `\nPatience check: gross=${patience.gross} paye=${patience.paye} welfare=${patience.after} net=${patience.net}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
