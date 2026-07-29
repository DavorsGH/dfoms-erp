/**
 * Fresh probe: what does Directory Current Net Pay actually resolve to on prod?
 *
 *   npx tsx scripts/probe-directory-net-pay-source-production.ts --env-file .env.local.backup
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadDirectoryNetPayContext } from "../app/dashboard/employees/directory-net-pay-utils";
import {
  buildManualInputsFromRow,
  calculateLoanRepaymentForEmployee,
  calculatePayrollRow,
  countAbsencesForStaff,
  mapCasualTaxConfigRows,
  mapPayrollPayeBandRows,
  mapSsnitConfigRows,
  resolvePayrollPolicyCompensation,
  sumOvertimeForEmployee,
} from "../app/dashboard/hr-payroll/payroll-processing-utils";
import {
  getPeriodEndDate,
  getPeriodStartDate,
  resolveSelectedPeriod,
} from "../app/dashboard/hr-payroll/payroll-period-utils";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const DAVORS = "00000001-0000-4000-8000-000000000001";
const STAFF = [
  "DF0008",
  "DF0009",
  "DF0010",
  "DF0012",
  "DF0013",
  "DF0015",
  "DF0017",
];

function loadEnvForce(filePath) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    let value = trimmed.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[trimmed.slice(0, i).trim()] = value;
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function main() {
  const argv = process.argv.slice(2);
  const envIdx = argv.indexOf("--env-file");
  const envFile =
    envIdx >= 0 && argv[envIdx + 1] ? argv[envIdx + 1] : ".env.local.backup";
  loadEnvForce(resolve(envFile));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  assert(url.includes(PRODUCTION_REF), `Refusing non-production URL: ${url}`);
  assert(key, "Missing service role key");

  const admin = createClient(url, key, { auth: { persistSession: false } });
  const referenceDate = new Date();
  const period = resolveSelectedPeriod(
    referenceDate.getFullYear(),
    referenceDate.getMonth() + 1,
  );
  console.log(
    `Now=${referenceDate.toISOString()} directoryPeriod=${period.payrollMonth} (${period.year}-${period.month})`,
  );

  const { data: employees, error } = await admin
    .from("employees")
    .select(
      "employee_id, staff_id, full_name, employment_type, employment_status, date_hired, appointment_end_date, position, shift, basic_salary, housing_allowance, transport_allowance, other_allowances, department, contract_project",
    )
    .eq("tenant_id", DAVORS)
    .in("staff_id", STAFF);
  assert(!error, error?.message ?? "employees failed");

  const dirCtx = await loadDirectoryNetPayContext(
    admin,
    DAVORS,
    employees,
    referenceDate,
  );
  console.log(
    `loadDirectoryNetPayContext stats: fromProcessingRow=${dirCtx.stats.fromProcessingRow} fresh=${dirCtx.stats.fromFreshCalculation} label=${dirCtx.periodLabel}`,
  );

  const periodStart = getPeriodStartDate(period.year, period.month);
  const periodEnd = getPeriodEndDate(period.year, period.month);
  const [
    { data: ppRows },
    { data: attendance },
    { data: overtime },
    { data: loans },
    { data: salaryRates },
    { data: allowanceTypes },
    { data: compensationPolicies },
    { data: ssnitRows },
    { data: casualRows },
    { data: payeRows },
  ] = await Promise.all([
    admin
      .from("payroll_processing")
      .select("*")
      .eq("tenant_id", DAVORS)
      .eq("payroll_month", period.payrollMonth)
      .in(
        "employee_id",
        employees.map((e) => e.employee_id),
      ),
    admin
      .from("attendance_register")
      .select("staff_id, date, attendance_status")
      .eq("tenant_id", DAVORS)
      .gte("date", periodStart)
      .lte("date", periodEnd),
    admin
      .from("overtime_register")
      .select("employee_id, date, overtime_amount")
      .eq("tenant_id", DAVORS)
      .gte("date", periodStart)
      .lte("date", periodEnd),
    admin.from("loan_register").select("*").eq("tenant_id", DAVORS),
    admin
      .from("salary_rate_config")
      .select("*")
      .eq("tenant_id", DAVORS)
      .order("effective_date", { ascending: false }),
    admin
      .from("allowance_types")
      .select("id, code, name, is_active, sort_order")
      .eq("tenant_id", DAVORS),
    admin.from("compensation_policy").select("*").eq("tenant_id", DAVORS),
    admin
      .from("ssnit_rate_config")
      .select("*")
      .eq("tenant_id", DAVORS)
      .order("effective_date", { ascending: false }),
    admin
      .from("casual_tax_rate_config")
      .select("*")
      .eq("tenant_id", DAVORS)
      .order("effective_date", { ascending: false }),
    admin
      .from("paye_tax_bands")
      .select("band_order, lower_bound, upper_bound, rate, effective_date")
      .eq("tenant_id", DAVORS)
      .order("effective_date", { ascending: false })
      .order("band_order", { ascending: true }),
  ]);

  const taxConfigs = {
    ssnitRows: mapSsnitConfigRows(ssnitRows ?? []),
    casualRows: mapCasualTaxConfigRows(casualRows ?? []),
    payeBands: mapPayrollPayeBandRows(payeRows ?? []),
  };
  const policyConfig = {
    salaryRates: salaryRates ?? [],
    allowanceTypes: allowanceTypes ?? [],
    compensationPolicies: compensationPolicies ?? [],
  };
  const ppByEmp = new Map((ppRows ?? []).map((r) => [r.employee_id, r]));

  console.log(
    "\nstaff | storedNet | directoryNet | liveRecalcNet | source | EQ_stored | EQ_live600ish",
  );
  for (const emp of employees.sort((a, b) =>
    a.staff_id.localeCompare(b.staff_id),
  )) {
    const stored = ppByEmp.get(emp.employee_id);
    const directoryNet = dirCtx.netPayByEmployeeId[emp.employee_id];
    const policy = resolvePayrollPolicyCompensation(
      emp,
      policyConfig,
      new Date(periodEnd),
    );
    const liveNet = calculatePayrollRow(
      emp,
      period,
      taxConfigs,
      {
        absenceCount: countAbsencesForStaff(
          attendance ?? [],
          emp.staff_id,
          period.year,
          period.month,
        ),
        overtimeAmount: sumOvertimeForEmployee(
          overtime ?? [],
          emp.employee_id,
          period.year,
          period.month,
        ),
        loanRepayment: calculateLoanRepaymentForEmployee(
          loans ?? [],
          emp.employee_id,
        ),
      },
      stored
        ? buildManualInputsFromRow(stored, period.totalWorkingDays)
        : {
            days_to_pay: period.totalWorkingDays,
            bonuses: 0,
            arrears: 0,
            net_only_adjustment: 0,
            salary_advance: 0,
            welfare_deduction: 0,
            other_deductions: 0,
          },
      policy,
    ).net_pay;

    const eqStored =
      stored != null &&
      Math.abs(Number(directoryNet) - Number(stored.net_pay)) < 0.02;
    const eqLive = Math.abs(Number(directoryNet) - Number(liveNet)) < 0.02;
    const source = stored
      ? eqStored
        ? "STORED_net_pay"
        : "UNEXPECTED"
      : "FRESH_calc";

    console.log(
      `${emp.staff_id} | ${stored ? stored.net_pay : "n/a"} | ${directoryNet} | ${liveNet} | ${source} | ${eqStored} | ${eqLive}`,
    );
  }

  console.log(
    "\nVERDICT: If source=STORED_net_pay for employees with July rows, Directory is reading stale stored values.",
  );
  console.log(
    "If source were live, directoryNet would equal liveRecalcNet (~600/578.15) not stored (~550/528.56).",
  );
  console.log(
    "Code path on this checkout: directory-net-pay-utils uses Number(existing.net_pay) when row exists.",
  );
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
