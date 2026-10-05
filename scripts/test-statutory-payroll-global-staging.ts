/**
 * READ-ONLY parity tests for platform-wide statutory payroll (Design B) on staging.
 *
 *   npx tsx scripts/test-statutory-payroll-global-staging.ts --env-file .env.staging.local
 *
 * No INSERT/UPDATE/DELETE. Refuses production.
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  buildManualInputsFromRow,
  buildProcessingPayload,
  calculateLoanRepaymentForEmployee,
  calculatePayrollRow,
  countAbsencesForStaff,
  mapCasualTaxConfigRows,
  mapPayrollPayeBandRows,
  mapSsnitConfigRows,
  pickPayeBandsForDate,
  resolvePayrollPolicyCompensation,
  sumOvertimeForEmployee,
} from "../app/dashboard/hr-payroll/payroll-processing-utils";
import {
  fetchStatutoryPayrollTaxConfigs,
  loadStatutoryPayrollConfig,
  validateStatutoryPayrollBeforeLock,
} from "../app/dashboard/hr-payroll/statutory-payroll-config-utils";
import {
  getPeriodEndDate,
  getPeriodStartDate,
  resolveSelectedPeriod,
} from "../app/dashboard/hr-payroll/payroll-period-utils";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const DAVORS = "00000001-0000-4000-8000-000000000001";
const CAANTA = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";
const SEP_2026 = "2026-09-01";
const AUG_2026 = "2026-08-01";

const NUMERIC_COMPARE_FIELDS = [
  "basic_salary",
  "housing_allowance",
  "transport_allowance",
  "other_allowances",
  "daily_rate",
  "days_to_pay",
  "absence_deduction",
  "overtime_amount",
  "loan_repayment",
  "bonuses",
  "arrears",
  "net_only_adjustment",
  "salary_advance",
  "welfare_deduction",
  "other_deductions",
  "gross_pay",
  "employee_ssnit",
  "employer_ssnit",
  "tier2",
  "paye_tax",
  "total_deductions",
  "net_pay",
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

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

function almostEqual(a, b, eps = 0.005) {
  return Math.abs(round2(a) - round2(b)) <= eps;
}

function parseArgs() {
  const args = process.argv.slice(2);
  let envFile = ".env.staging.local";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--env-file" && args[i + 1]) {
      envFile = args[i + 1];
      i++;
    }
  }
  return { envFile: resolve(process.cwd(), envFile) };
}

function payeLadderFingerprint(bands) {
  return bands
    .map(
      (b) =>
        `${b.band_order ?? 0}:${b.band_from}:${b.band_to}:${round2(Number(b.rate))}`,
    )
    .join("|");
}

function resolvePayeLadderEffectiveDate(allPayeBands, asOfDate) {
  const keys = [
    ...new Set(
      allPayeBands.map((b) =>
        b.effective_date ? String(b.effective_date).slice(0, 10) : "",
      ),
    ),
  ].filter(Boolean);
  const eligible = keys.filter((k) => k <= asOfDate).sort((a, b) => b.localeCompare(a));
  return eligible[0] ?? keys.sort((a, b) => b.localeCompare(a))[0] ?? null;
}

async function loadTenantTaxConfigs(admin, tenantId) {
  const [
    { data: ssnitRows },
    { data: casualRows },
    { data: payeRows, error: payeErr },
  ] = await Promise.all([
    admin
      .from("ssnit_rate_config")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("effective_date", { ascending: false }),
    admin
      .from("casual_tax_rate_config")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("effective_date", { ascending: false }),
    admin
      .from("paye_tax_bands")
      .select("band_order, lower_bound, upper_bound, rate, effective_date")
      .eq("tenant_id", tenantId)
      .order("effective_date", { ascending: false })
      .order("band_order", { ascending: true }),
  ]);
  assert(!payeErr, payeErr?.message ?? "tenant paye_tax_bands fetch failed");
  return {
    ssnitRows: mapSsnitConfigRows(ssnitRows ?? []),
    casualRows: mapCasualTaxConfigRows(casualRows ?? []),
    payeBands: mapPayrollPayeBandRows(payeRows ?? []),
  };
}

function toEmployeeSource(employee) {
  return {
    employee_id: employee.employee_id,
    staff_id: employee.staff_id,
    full_name: employee.full_name,
    employment_type: employee.employment_type,
    employment_status: employee.employment_status ?? null,
    date_hired: employee.date_hired ?? null,
    appointment_end_date: employee.appointment_end_date ?? null,
    position: employee.position ?? null,
    shift: employee.shift ?? null,
    basic_salary: employee.basic_salary ?? null,
    housing_allowance: employee.housing_allowance ?? null,
    transport_allowance: employee.transport_allowance ?? null,
    other_allowances: employee.other_allowances ?? null,
    welfare_deduction_rate: employee.welfare_deduction_rate ?? null,
    department: employee.department ?? null,
    contract_project: employee.contract_project,
  };
}

async function loadPeriodCalcContext(admin, tenantId, payrollMonth) {
  const period = resolveSelectedPeriod(
    Number(payrollMonth.slice(0, 4)),
    Number(payrollMonth.slice(5, 7)),
  );
  const periodStart = getPeriodStartDate(period.year, period.month);
  const periodEnd = getPeriodEndDate(period.year, period.month);

  const [
    { data: employees },
    { taxConfigs: globalTaxConfigs },
    tenantTaxConfigs,
    { data: salaryRates },
    { data: allowanceTypes },
    { data: compensationPolicies },
    { data: attendance },
    { data: overtime },
    { data: loans },
    { data: processingRows },
  ] = await Promise.all([
    admin
      .from("employees")
      .select(
        "employee_id, staff_id, full_name, employment_type, employment_status, date_hired, appointment_end_date, position, shift, basic_salary, housing_allowance, transport_allowance, other_allowances, welfare_deduction_rate, department, contract_project",
      )
      .eq("tenant_id", tenantId),
    fetchStatutoryPayrollTaxConfigs(admin),
    loadTenantTaxConfigs(admin, tenantId),
    admin.from("salary_rate_config").select("*").eq("tenant_id", tenantId),
    admin
      .from("allowance_types")
      .select("id, code, name, is_active, sort_order")
      .eq("tenant_id", tenantId),
    admin.from("compensation_policy").select("*").eq("tenant_id", tenantId),
    admin
      .from("attendance_register")
      .select("staff_id, date, attendance_status")
      .eq("tenant_id", tenantId)
      .gte("date", periodStart)
      .lte("date", periodEnd),
    admin
      .from("overtime_register")
      .select("employee_id, date, overtime_amount")
      .eq("tenant_id", tenantId)
      .gte("date", periodStart)
      .lte("date", periodEnd),
    admin.from("loan_register").select("*").eq("tenant_id", tenantId),
    admin
      .from("payroll_processing")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("payroll_month", payrollMonth),
  ]);

  const policyConfig = {
    salaryRates: salaryRates ?? [],
    allowanceTypes: allowanceTypes ?? [],
    compensationPolicies: compensationPolicies ?? [],
  };

  return {
    period,
    employees: employees ?? [],
    globalTaxConfigs,
    tenantTaxConfigs,
    policyConfig,
    attendance: attendance ?? [],
    overtime: overtime ?? [],
    loans: loans ?? [],
    processingRows: processingRows ?? [],
  };
}

function recalculateWithTaxConfigs(row, employee, period, ctx, taxConfigs) {
  const source = toEmployeeSource(employee);
  const policy = resolvePayrollPolicyCompensation(
    source,
    ctx.policyConfig,
    new Date(getPeriodEndDate(period.year, period.month)),
  );
  return calculatePayrollRow(
    source,
    period,
    taxConfigs,
    {
      absenceCount: countAbsencesForStaff(
        ctx.attendance,
        source.staff_id,
        period.year,
        period.month,
      ),
      overtimeAmount: sumOvertimeForEmployee(
        ctx.overtime,
        source.employee_id,
        period.year,
        period.month,
      ),
      loanRepayment: calculateLoanRepaymentForEmployee(
        ctx.loans,
        source.employee_id,
      ),
    },
    buildManualInputsFromRow(row, period.totalWorkingDays),
    policy,
  );
}

async function testSep2026Parity(admin) {
  console.log("\n=== Davors Sep 2026 open payroll: global loader vs stored ===");
  const ctx = await loadPeriodCalcContext(admin, DAVORS, SEP_2026);
  const employeeById = new Map(ctx.employees.map((e) => [e.employee_id, e]));
  let diffs = 0;
  let payeTotal = 0;

  for (const row of ctx.processingRows) {
    const employee = employeeById.get(row.employee_id);
    if (!employee) continue;
    const calculated = recalculateWithTaxConfigs(
      row,
      employee,
      ctx.period,
      ctx,
      ctx.globalTaxConfigs,
    );
    payeTotal += round2(Number(calculated.paye_tax) || 0);

    for (const field of NUMERIC_COMPARE_FIELDS) {
      const stored = round2(Number(row[field]) || 0);
      const fresh = round2(Number(calculated[field]) || 0);
      if (!almostEqual(stored, fresh)) {
        diffs++;
        console.log(
          `DIFF ${employee.staff_id} ${field}: stored=${stored} fresh=${fresh}`,
        );
      }
    }
  }

  console.log(`Diff rows (field mismatches): ${diffs}`);
  console.log(`Fresh PAYE total (sum of rows): ${round2(payeTotal).toFixed(2)}`);
  assert(diffs === 0, `Expected 0 field diffs for Sep 2026, got ${diffs}`);
  assert(
    almostEqual(payeTotal, 802.75),
    `Expected PAYE total 802.75, got ${round2(payeTotal)}`,
  );
  console.log("PASS: Sep 2026 parity");
}

async function testAug2026Ladder(admin) {
  console.log("\n=== Davors Aug 2026: 2026-01-01 ladder, global vs tenant loader ===");
  const ctx = await loadPeriodCalcContext(admin, DAVORS, AUG_2026);
  const asOf = getPeriodEndDate(ctx.period.year, ctx.period.month);

  const globalBands = pickPayeBandsForDate(ctx.globalTaxConfigs.payeBands, asOf);
  const tenantBands = pickPayeBandsForDate(ctx.tenantTaxConfigs.payeBands, asOf);

  const globalEff = resolvePayeLadderEffectiveDate(
    ctx.globalTaxConfigs.payeBands,
    asOf,
  );
  const tenantEff = resolvePayeLadderEffectiveDate(
    ctx.tenantTaxConfigs.payeBands,
    asOf,
  );
  console.log(`Global ladder effective_date: ${globalEff}`);
  console.log(`Tenant ladder effective_date: ${tenantEff}`);
  assert(globalEff === "2026-01-01", `Expected 2026-01-01 ladder, got ${globalEff}`);

  assert(
    payeLadderFingerprint(globalBands) === payeLadderFingerprint(tenantBands),
    "Global vs tenant PAYE ladder fingerprint mismatch for Aug 2026",
  );

  const employeeById = new Map(ctx.employees.map((e) => [e.employee_id, e]));
  let calcDiffs = 0;
  for (const row of ctx.processingRows) {
    const employee = employeeById.get(row.employee_id);
    if (!employee) continue;
    const globalCalc = recalculateWithTaxConfigs(
      row,
      employee,
      ctx.period,
      ctx,
      ctx.globalTaxConfigs,
    );
    const tenantCalc = recalculateWithTaxConfigs(
      row,
      employee,
      ctx.period,
      ctx,
      ctx.tenantTaxConfigs,
    );
    if (!almostEqual(globalCalc.paye_tax, tenantCalc.paye_tax)) {
      calcDiffs++;
    }
  }
  assert(calcDiffs === 0, `Aug 2026 PAYE calc diffs: ${calcDiffs}`);
  console.log("PASS: Aug 2026 ladder and calc parity");
}

async function testCaantaResolvesSameAsDavors(admin) {
  console.log("\n=== Non-Davors (Caanta): statutory resolution vs Davors ===");
  const sepEnd = getPeriodEndDate(2026, 9);
  const [davorsLoaded, caantaLoaded, davorsTenant, caantaTenant] =
    await Promise.all([
      loadStatutoryPayrollConfig(admin, sepEnd),
      loadStatutoryPayrollConfig(admin, sepEnd),
      loadTenantTaxConfigs(admin, DAVORS),
      loadTenantTaxConfigs(admin, CAANTA),
    ]);

  assert(!davorsLoaded.error, davorsLoaded.error ?? "global load failed");
  assert(!caantaLoaded.error, caantaLoaded.error ?? "global load failed");

  assert(
    payeLadderFingerprint(davorsLoaded.payeBandsForDate) ===
      payeLadderFingerprint(caantaLoaded.payeBandsForDate),
    "Caanta vs Davors global PAYE bands differ",
  );
  assert(
    round2(davorsLoaded.ssnitConfig?.employee_rate ?? 0) ===
      round2(caantaLoaded.ssnitConfig?.employee_rate ?? 0),
    "SSNIT employee_rate mismatch",
  );
  assert(
    round2(davorsLoaded.casualConfig?.flat_rate ?? 0) ===
      round2(caantaLoaded.casualConfig?.flat_rate ?? 0),
    "Casual flat_rate mismatch",
  );

  const caantaTenantBands = pickPayeBandsForDate(
    caantaTenant.payeBands,
    sepEnd,
  );
  assert(
    caantaTenant.payeBands.length === 0 ||
      payeLadderFingerprint(caantaTenantBands) ===
        payeLadderFingerprint(davorsLoaded.payeBandsForDate),
    "Caanta tenant bands should be empty or match Davors global Sep ladder",
  );

  console.log("PASS: Caanta resolves same statutory rates as Davors");
}

function testLockGuardInMemory() {
  console.log("\n=== Lock guard: in-memory missing global config ===");
  const emptyConfigs = {
    ssnitRows: [],
    casualRows: [],
    payeBands: [],
    overtimeRows: [],
  };
  const block = validateStatutoryPayrollBeforeLock({
    taxConfigs: emptyConfigs,
    periodYear: 2026,
    periodMonth: 9,
    employees: [{ employment_type: "Full-Time" }],
  });
  assert(Boolean(block), "Expected lock block message for missing config");
  console.log("Block message:", block);
  console.log("PASS: lock guard blocks when config missing (in-memory)");
}

async function testTenantIsolation(admin) {
  console.log("\n=== Tenant isolation: global tables schema + RLS ===");
  const tables = [
    "statutory_paye_tax_bands",
    "statutory_ssnit_rate_config",
    "statutory_casual_tax_rate_config",
  ];

  for (const table of tables) {
    const { data, error } = await admin.from(table).select("*").limit(5);
    assert(!error, `${table}: ${error?.message}`);
    for (const row of data ?? []) {
      assert(
        !("tenant_id" in row),
        `${table} row exposes tenant_id — must not contain tenant data`,
      );
    }
  }

  const { data: samplePaye } = await admin
    .from("statutory_paye_tax_bands")
    .select("country_code, effective_date, band_order, lower_bound, rate")
    .eq("country_code", "GH")
    .limit(3);
  console.log("Sample statutory PAYE rows (no tenant_id):", samplePaye);

  console.log("PASS: global tables contain no tenant_id on rows");
}

async function main() {
  const { envFile } = parseArgs();
  loadEnvForce(envFile);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  assert(url && key, "Missing Supabase URL or service role key");

  const ref = url.match(/https:\/\/([^.]+)\./)?.[1] ?? "";
  assert(ref === STAGING_REF, `Refusing non-staging project ref: ${ref}`);
  assert(ref !== PRODUCTION_REF, "Refusing production");

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error: tableProbe } = await admin
    .from("statutory_paye_tax_bands")
    .select("id", { count: "exact", head: true });
  assert(
    !tableProbe,
    `statutory_paye_tax_bands not available (${tableProbe?.message}). Run apply-309-statutory-payroll-global-staging.ts first.`,
  );

  testLockGuardInMemory();
  await testTenantIsolation(admin);
  await testCaantaResolvesSameAsDavors(admin);
  await testAug2026Ladder(admin);
  await testSep2026Parity(admin);

  console.log("\nAll statutory payroll global staging tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
