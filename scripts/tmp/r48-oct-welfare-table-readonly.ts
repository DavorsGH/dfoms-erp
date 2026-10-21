/**
 * October staging welfare before/after (R48), using live absence counts
 * and each processing row's stored pay inputs.
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
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

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
  const { data: attendance } = await admin
    .from("attendance_register")
    .select("staff_id, date, attendance_status, exception_status, tenant_id")
    .gte("date", start)
    .lte("date", end)
    .in("tenant_id", tenantIds);

  const { data: settings } = await admin
    .from("hr_payroll_settings")
    .select("*")
    .in("tenant_id", tenantIds);

  // Tax configs — try common table names used by the app
  async function loadTax() {
    const tryTables = async (name: string) => {
      const { data, error } = await admin.from(name).select("*");
      if (error) return [];
      return data ?? [];
    };
    return {
      ssnitRows: await tryTables("ssnit_config"),
      casualRows: await tryTables("casual_worker_tax_config"),
      payeBands: await tryTables("paye_tax_bands"),
      overtimeRows: await tryTables("overtime_tax_config"),
    } as PayrollTaxConfigs;
  }
  const tax = await loadTax();

  console.log(
    "staff_id | name | absence GHS | welfare before | after | delta",
  );
  const diffs = [];

  for (const row of processing ?? []) {
    const empRow = empById.get(row.employee_id);
    if (!empRow) continue;
    const rate = Number(empRow.welfare_deduction_rate) || 0;
    if (rate <= 0) continue;

    const emp: PayrollEmployeeSource = {
      employee_id: empRow.employee_id,
      staff_id: empRow.staff_id,
      full_name: empRow.full_name,
      employment_type: empRow.employment_type,
      employment_status: empRow.employment_status,
      date_hired: empRow.date_hired,
      appointment_end_date: empRow.appointment_end_date,
      position: empRow.position,
      shift: empRow.shift,
      // Prefer processing snapshot for period pay so absences match Payroll Processing
      basic_salary: Number(row.basic_salary) || Number(empRow.basic_salary) || 0,
      housing_allowance:
        Number(row.housing_allowance) || Number(empRow.housing_allowance) || 0,
      transport_allowance:
        Number(row.transport_allowance) || Number(empRow.transport_allowance) || 0,
      other_allowances:
        Number(row.other_allowances) || Number(empRow.other_allowances) || 0,
      department: empRow.department,
      contract_project: empRow.contract_project,
      welfare_deduction_rate: rate,
      business_unit_id: empRow.business_unit_id,
    };

    const staffAttendance = ((attendance ?? []) as PayrollAttendanceSource[]).filter(
      (a) => a.staff_id === emp.staff_id && a.tenant_id === empRow.tenant_id,
    );
    const absenceCount = countAbsencesForStaff(
      staffAttendance,
      emp.staff_id,
      2026,
      10,
    );
    if (absenceCount <= 0) continue;

    const tenantSettings = (settings ?? []).filter(
      (s) => s.tenant_id === empRow.tenant_id,
    );
    const exact = tenantSettings.find(
      (s) => s.business_unit_id === empRow.business_unit_id,
    );
    const wide = tenantSettings.find((s) => s.business_unit_id == null);
    const includeOt =
      (exact ?? wide)?.include_overtime_in_welfare !== false;

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
      { includeOvertimeInWelfare: includeOt },
    );

    const preAbsence = round2(afterRow.gross_pay + afterRow.absence_deduction);
    let beforeBase = preAbsence;
    if (!includeOt) {
      beforeBase = Math.max(beforeBase - (Number(row.overtime_amount) || 0), 0);
    }
    const before = round2((beforeBase * rate) / 100);
    const after = afterRow.welfare_deduction;
    if (before === after) continue;

    diffs.push({
      staff_id: emp.staff_id,
      full_name: emp.full_name,
      absence: afterRow.absence_deduction,
      before,
      after,
      delta: round2(after - before),
      gross: afterRow.gross_pay,
      paye: afterRow.paye_tax,
      totalDed: afterRow.total_deductions,
      net: afterRow.net_pay,
    });
  }

  diffs.sort((a, b) =>
    String(a.staff_id).localeCompare(String(b.staff_id), undefined, {
      numeric: true,
    }),
  );
  for (const d of diffs) {
    console.log(
      `${d.staff_id} | ${d.full_name} | ${d.absence.toFixed(2)} | ${d.before.toFixed(2)} | ${d.after.toFixed(2)} | ${d.delta.toFixed(2)}`,
    );
  }
  console.log(`\n${diffs.length} employees whose welfare changes`);
  for (const d of diffs) {
    if (d.staff_id === "DF0020") {
      console.log(
        `Patience live recalc: Absence ${d.absence} Gross ${d.gross} PAYE ${d.paye} Welfare ${d.after} Total Ded ${d.totalDed} Net ${d.net}`,
      );
    }
  }

  // Approved unit-scenario reference (0.5 day, 27 working days, basic 589.47)
  console.log(
    "\nApproved expected (unit scenario): DF0020 | Patience Ashie | 10.92 | 29.47 | 28.93 | -0.54",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
