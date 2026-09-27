/**
 * Resync open payroll_processing rows when stored amounts lag fresh calculatePayrollRow
 * (e.g. PAYE band effective-date change). Dry-run by default; --apply required to write.
 *
 * Usage:
 *   npx tsx scripts/resync-open-payroll-processing-paye.ts --env-file .env.local
 *   npx tsx scripts/resync-open-payroll-processing-paye.ts --env-file .env.local --apply \
 *     --payroll-month 2026-09-01 --tenant 00000001-0000-4000-8000-000000000001 \
 *     --strict-paye-only --max-rows-to-update 6
 *   npx tsx scripts/resync-open-payroll-processing-paye.ts --env-file .env.local.backup \
 *     --apply --allow-production --payroll-month 2026-09-01
 *
 * Full open-month resync (mutually exclusive with --strict-paye-only):
 *   npx tsx scripts/resync-open-payroll-processing-paye.ts --env-file .env.local.backup \
 *     --allow-production --full-resync --expected-rows 19 --payroll-month 2026-09-01
 *
 * With --strict-paye-only: aborts if any row differs outside paye_tax, total_deductions,
 * net_pay; aborts if more than --max-rows-to-update rows would change (default 6 when strict).
 * With --full-resync: updates every row that differs; runs production Sep 2026 field/total guards
 * when --expected-rows 19 and payroll_month 2026-09-01.
 * Never touches payroll_history or paye_tax_bands. Scoped updates: tenant_id + payroll_month + id.
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
  resolvePayrollPolicyCompensation,
  sumOvertimeForEmployee,
} from "../app/dashboard/hr-payroll/payroll-processing-utils";
import {
  PAYROLL_STATUS_LOCKED,
  PAYROLL_STATUS_PARTIALLY_LOCKED,
  getPeriodEndDate,
  getPeriodStartDate,
  resolveSelectedPeriod,
} from "../app/dashboard/hr-payroll/payroll-period-utils";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const DAVORS = "00000001-0000-4000-8000-000000000001";
const OPEN_STATUSES = new Set(["open", "processing"]);

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

const PAYE_ONLY_DIFF_FIELDS = new Set([
  "paye_tax",
  "total_deductions",
  "net_pay",
]);

const PAYE_WELFARE_ROLLUP_FIELDS = new Set([
  "paye_tax",
  "welfare_deduction",
  "total_deductions",
  "net_pay",
]);

const DF0004_GROSS_DIFF_FIELDS = new Set([
  "basic_salary",
  "housing_allowance",
  "transport_allowance",
  "other_allowances",
  "daily_rate",
  "gross_pay",
  "employee_ssnit",
  "employer_ssnit",
  "tier2",
  "taxable_income (gross − employee_ssnit)",
  "payroll_allowance_lines (sum)",
]);

const ABSENCE_DIFF_STAFF = new Set([
  "DF0008",
  "DF0011",
  "DF0026",
  "DF0028",
  "DF0030",
]);

/** Production Sep 2026 diff report — full-resync guard set. */
const PROD_SEP_2026_FULL_RESYNC_STAFF = new Set([
  "DF0002",
  "DF0003",
  "DF0004",
  "DF0005",
  "DF0008",
  "DF0009",
  "DF0010",
  "DF0011",
  "DF0014",
  "DF0017",
  "DF0020",
  "DF0023",
  "DF0024",
  "DF0025",
  "DF0026",
  "DF0028",
  "DF0029",
  "DF0030",
  "DF0031",
]);

const PROD_SEP_2026_FRESH_TOTALS = {
  paye: 839.45,
  welfare: 565.55,
  totalDeductions: 1971.51,
  net: 14187.69,
  ssnit: 271.7,
  casualPaye: 412.64,
};

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

function parseArgs(argv) {
  const envIdx = argv.indexOf("--env-file");
  const monthIdx = argv.indexOf("--payroll-month");
  const tenantIdx = argv.indexOf("--tenant");
  const maxIdx = argv.indexOf("--max-rows-to-update");
  const expectedRowsIdx = argv.indexOf("--expected-rows");
  const strictPayeOnly = argv.includes("--strict-paye-only");
  const fullResync = argv.includes("--full-resync");
  return {
    envFile:
      envIdx >= 0 && argv[envIdx + 1] ? argv[envIdx + 1] : ".env.staging.local",
    apply: argv.includes("--apply"),
    allowProduction: argv.includes("--allow-production"),
    strictPayeOnly,
    fullResync,
    expectedRows:
      expectedRowsIdx >= 0 && argv[expectedRowsIdx + 1]
        ? Number(argv[expectedRowsIdx + 1])
        : null,
    payrollMonth:
      monthIdx >= 0 && argv[monthIdx + 1]
        ? String(argv[monthIdx + 1]).slice(0, 10)
        : "2026-09-01",
    tenantId:
      tenantIdx >= 0 && argv[tenantIdx + 1]
        ? argv[tenantIdx + 1]
        : DAVORS,
    maxRowsToUpdate:
      maxIdx >= 0 && argv[maxIdx + 1]
        ? Number(argv[maxIdx + 1])
        : strictPayeOnly
          ? 6
          : null,
  };
}

function isOpenProcessingStatus(status) {
  return OPEN_STATUSES.has(String(status ?? "").trim().toLowerCase());
}

function payloadForExistingRow(existing, payload) {
  const update = {};
  for (const [key, value] of Object.entries(payload)) {
    if (key === "id") continue;
    if (Object.prototype.hasOwnProperty.call(existing, key)) {
      update[key] = value;
    }
  }
  return update;
}

function toEmployeeSource(emp) {
  return {
    employee_id: emp.employee_id,
    staff_id: emp.staff_id,
    full_name: emp.full_name,
    employment_type: emp.employment_type,
    employment_status: emp.employment_status,
    date_hired: emp.date_hired,
    appointment_end_date: emp.appointment_end_date,
    position: emp.position,
    shift: emp.shift,
    basic_salary: emp.basic_salary,
    housing_allowance: emp.housing_allowance,
    transport_allowance: emp.transport_allowance,
    other_allowances: emp.other_allowances,
    department: emp.department,
    contract_project: emp.contract_project,
    welfare_deduction_rate: emp.welfare_deduction_rate ?? null,
  };
}

function allowanceLinesMatch(storedLines, policyLines) {
  const storedMap = new Map(
    (storedLines ?? []).map((l) => [
      String(l.allowance_code),
      round2(Number(l.amount) || 0),
    ]),
  );
  const policyMap = new Map(
    (policyLines ?? []).map((l) => [
      String(l.allowance_code),
      round2(Number(l.amount) || 0),
    ]),
  );
  if (storedMap.size !== policyMap.size) return false;
  for (const [code, amt] of policyMap) {
    if (!storedMap.has(code) || !almostEqual(storedMap.get(code), amt)) {
      return false;
    }
  }
  return true;
}

async function loadContext(admin, tenantId, period, payrollMonth) {
  const periodStart = getPeriodStartDate(period.year, period.month);
  const periodEnd = getPeriodEndDate(period.year, period.month);

  const [
    { data: employees, error: empErr },
    { data: attendance, error: attErr },
    { data: overtime, error: otErr },
    { data: loans, error: loanErr },
    { data: salaryRates },
    { data: allowanceTypes },
    { data: compensationPolicies },
    { data: ssnitRows },
    { data: casualRows },
    { data: payeRows },
    { data: closeRecord },
    { data: historyRows, error: histErr },
    { data: allowanceLinesAll },
  ] = await Promise.all([
    admin
      .from("employees")
      .select(
        "employee_id, staff_id, full_name, employment_type, employment_status, date_hired, appointment_end_date, position, shift, basic_salary, housing_allowance, transport_allowance, other_allowances, welfare_deduction_rate, department, contract_project",
      )
      .eq("tenant_id", tenantId),
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
      .from("salary_rate_config")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("effective_date", { ascending: false }),
    admin
      .from("allowance_types")
      .select("id, code, name, is_active, sort_order")
      .eq("tenant_id", tenantId)
      .order("sort_order", { ascending: true }),
    admin.from("compensation_policy").select("*").eq("tenant_id", tenantId),
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
    admin
      .from("month_end_close")
      .select("month, lock_status, notes")
      .eq("tenant_id", tenantId)
      .eq("month", payrollMonth)
      .maybeSingle(),
    admin
      .from("payroll_history")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("payroll_month", payrollMonth),
    admin
      .from("payroll_allowance_lines")
      .select("employee_id, allowance_code, amount, stage")
      .eq("tenant_id", tenantId)
      .eq("payroll_month", payrollMonth)
      .eq("stage", "processing"),
  ]);

  assert(!empErr, empErr?.message ?? "employees fetch failed");
  assert(!attErr, attErr?.message ?? "attendance fetch failed");
  assert(!otErr, otErr?.message ?? "overtime fetch failed");
  assert(!loanErr, loanErr?.message ?? "loans fetch failed");
  assert(!histErr, histErr?.message ?? "payroll_history fetch failed");

  return {
    employees: employees ?? [],
    attendance: attendance ?? [],
    overtime: overtime ?? [],
    loans: loans ?? [],
    taxConfigs: {
      ssnitRows: mapSsnitConfigRows(ssnitRows ?? []),
      casualRows: mapCasualTaxConfigRows(casualRows ?? []),
      payeBands: mapPayrollPayeBandRows(payeRows ?? []),
    },
    policyConfig: {
      salaryRates: salaryRates ?? [],
      allowanceTypes: allowanceTypes ?? [],
      compensationPolicies: compensationPolicies ?? [],
    },
    closeRecord: closeRecord ?? null,
    historyRows: historyRows ?? [],
    allowanceLinesAll: allowanceLinesAll ?? [],
  };
}

function recalculateRow(row, employee, period, ctx) {
  const source = toEmployeeSource(employee);
  const policy = resolvePayrollPolicyCompensation(
    source,
    ctx.policyConfig,
    new Date(getPeriodEndDate(period.year, period.month)),
  );
  const calculated = calculatePayrollRow(
    source,
    period,
    ctx.taxConfigs,
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
  const payload = buildProcessingPayload(
    period.payrollMonth,
    source,
    calculated,
  );
  const taxableIncome = round2(
    Math.max(Number(calculated.gross_pay) - Number(calculated.employee_ssnit), 0),
  );
  return { calculated, payload, policy, taxableIncome, source };
}

function compareRow(row, employee, period, ctx, allowanceByEmployee) {
  const { calculated, payload, policy, taxableIncome } = recalculateRow(
    row,
    employee,
    period,
    ctx,
  );
  const storedAllowanceLines = allowanceByEmployee.get(row.employee_id) ?? [];
  const fieldDiffs = [];

  for (const field of NUMERIC_COMPARE_FIELDS) {
    const storedVal = round2(row[field] ?? 0);
    const freshVal = round2(payload[field] ?? 0);
    if (!almostEqual(storedVal, freshVal)) {
      fieldDiffs.push({ field, storedVal, freshVal });
    }
  }

  const storedTaxable = round2(
    Math.max(Number(row.gross_pay) - Number(row.employee_ssnit), 0),
  );
  if (!almostEqual(storedTaxable, taxableIncome)) {
    fieldDiffs.push({
      field: "taxable_income (gross − employee_ssnit)",
      storedVal: storedTaxable,
      freshVal: taxableIncome,
    });
  }

  const policyLineTotal = policy
    ? round2(
        policy.allowance_lines.reduce(
          (s, l) => s + (Number(l.amount) || 0),
          0,
        ),
      )
    : 0;
  const storedLineTotal = round2(
    storedAllowanceLines.reduce((s, l) => s + (Number(l.amount) || 0), 0),
  );
  if (!allowanceLinesMatch(storedAllowanceLines, policy?.allowance_lines ?? [])) {
    fieldDiffs.push({
      field: "payroll_allowance_lines (sum)",
      storedVal: storedLineTotal,
      freshVal: policyLineTotal,
    });
  }

  const hasAnyDiff = fieldDiffs.length > 0;
  const disallowed = fieldDiffs.filter(
    (d) => !PAYE_ONLY_DIFF_FIELDS.has(d.field),
  );

  return {
    calculated,
    payload,
    policy,
    fieldDiffs,
    hasAnyDiff,
    disallowed,
    update: payloadForExistingRow(row, payload),
  };
}

function sumTotals(rows, employeeById) {
  let paye = 0;
  let net = 0;
  let ssnit = 0;
  let welfare = 0;
  let totalDed = 0;
  let casualPaye = 0;
  let casualNet = 0;
  for (const row of rows) {
    paye += round2(row.paye_tax);
    net += round2(row.net_pay);
    ssnit += round2(row.employee_ssnit);
    welfare += round2(row.welfare_deduction);
    totalDed += round2(row.total_deductions);
    const emp = employeeById.get(row.employee_id);
    if (emp && String(emp.employment_type ?? "").trim() === "Casual") {
      casualPaye += round2(row.paye_tax);
      casualNet += round2(row.net_pay);
    }
  }
  return {
    paye: round2(paye),
    net: round2(net),
    ssnit: round2(ssnit),
    welfare: round2(welfare),
    totalDeductions: round2(totalDed),
    casualPaye: round2(casualPaye),
    casualNet: round2(casualNet),
  };
}

function sumFreshTotals(comparisons, employeeById) {
  const rows = comparisons.map((c) => ({
    ...c.row,
    paye_tax: c.calculated.paye_tax,
    net_pay: c.calculated.net_pay,
    employee_ssnit: c.calculated.employee_ssnit,
    welfare_deduction: c.calculated.welfare_deduction,
    total_deductions: c.calculated.total_deductions,
    employee_id: c.row.employee_id,
  }));
  return sumTotals(rows, employeeById);
}

function validateFullResyncFieldDiff(plan) {
  const staffId = String(plan.employee.staff_id);
  const violations = [];
  for (const diff of plan.fieldDiffs) {
    const field = diff.field;
    if (PAYE_WELFARE_ROLLUP_FIELDS.has(field)) {
      continue;
    }
    if (field === "absence_deduction") {
      if (!ABSENCE_DIFF_STAFF.has(staffId)) {
        violations.push(`${staffId}: unexpected absence_deduction diff`);
      }
      continue;
    }
    if (DF0004_GROSS_DIFF_FIELDS.has(field)) {
      if (staffId !== "DF0004") {
        violations.push(`${staffId}: ${field} diff allowed only on DF0004`);
      }
      continue;
    }
    violations.push(`${staffId}: unexpected diff on ${field}`);
  }
  return violations;
}

function runProdSep2026FullResyncGuards(
  toUpdate,
  allComparisons,
  employeeById,
  payrollMonth,
  expectedRows,
) {
  if (payrollMonth !== "2026-09-01" || expectedRows !== 19) {
    return [];
  }
  const failures = [];

  if (toUpdate.length !== 19) {
    failures.push(`expected 19 rows to change, got ${toUpdate.length}`);
  }

  const changeStaff = new Set(toUpdate.map((p) => String(p.employee.staff_id)));
  for (const id of PROD_SEP_2026_FULL_RESYNC_STAFF) {
    if (!changeStaff.has(id)) {
      failures.push(`missing expected changing staff ${id}`);
    }
  }
  for (const id of changeStaff) {
    if (!PROD_SEP_2026_FULL_RESYNC_STAFF.has(id)) {
      failures.push(`unexpected changing staff ${id}`);
    }
  }

  for (const plan of toUpdate) {
    failures.push(...validateFullResyncFieldDiff(plan));
  }

  const fresh = sumFreshTotals(allComparisons, employeeById);
  const exp = PROD_SEP_2026_FRESH_TOTALS;
  if (!almostEqual(fresh.paye, exp.paye)) {
    failures.push(`fresh PAYE ${fresh.paye} != expected ${exp.paye}`);
  }
  if (!almostEqual(fresh.welfare, exp.welfare)) {
    failures.push(`fresh welfare ${fresh.welfare} != expected ${exp.welfare}`);
  }
  if (!almostEqual(fresh.totalDeductions, exp.totalDeductions)) {
    failures.push(
      `fresh total_deductions ${fresh.totalDeductions} != expected ${exp.totalDeductions}`,
    );
  }
  if (!almostEqual(fresh.net, exp.net)) {
    failures.push(`fresh net_pay ${fresh.net} != expected ${exp.net}`);
  }
  if (!almostEqual(fresh.ssnit, exp.ssnit)) {
    failures.push(`fresh employee_ssnit ${fresh.ssnit} != expected ${exp.ssnit}`);
  }
  if (!almostEqual(fresh.casualPaye, exp.casualPaye)) {
    failures.push(
      `fresh Casual PAYE ${fresh.casualPaye} != expected ${exp.casualPaye}`,
    );
  }

  return failures;
}

async function syncProcessingAllowanceLinesForTenant(
  admin,
  tenantId,
  payrollMonth,
  employeeId,
  allowances,
) {
  const { syncProcessingAllowanceLines } = await import(
    "../app/dashboard/hr-payroll/payroll-allowance-lines-utils"
  );
  return syncProcessingAllowanceLines(
    admin,
    payrollMonth,
    employeeId,
    allowances,
    { tenantId },
  );
}

async function fetchOpenRows(admin, tenantId, payrollMonth) {
  const { data, error } = await admin
    .from("payroll_processing")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("payroll_month", payrollMonth);
  assert(!error, error?.message ?? "payroll_processing fetch failed");
  return (data ?? []).filter((row) => isOpenProcessingStatus(row.status));
}

async function logSystemEvent(admin, input) {
  const { error } = await admin.from("system_event_log").insert({
    event_type: "cron",
    event_name: input.eventName,
    status: input.status,
    message: input.message ?? null,
    metadata: input.metadata ?? null,
  });
  if (error) {
    console.warn(`system_event_log insert failed: ${error.message}`);
  }
}

async function runComparison(admin, tenantId, payrollMonth, period, ctx, label) {
  const rows = await fetchOpenRows(admin, tenantId, payrollMonth);
  const employeeById = new Map(ctx.employees.map((e) => [e.employee_id, e]));
  const allowanceByEmployee = new Map();
  for (const line of ctx.allowanceLinesAll) {
    const list = allowanceByEmployee.get(line.employee_id) ?? [];
    list.push(line);
    allowanceByEmployee.set(line.employee_id, list);
  }

  const comparisons = [];
  let differingRows = 0;
  for (const row of rows) {
    const employee = employeeById.get(row.employee_id);
    if (!employee) continue;
    const cmp = compareRow(row, employee, period, ctx, allowanceByEmployee);
    if (cmp.hasAnyDiff) differingRows += 1;
    comparisons.push({ row, employee, ...cmp });
  }

  const totals = sumTotals(rows, employeeById);
  console.log(`\n--- ${label} ---`);
  console.log(`Open rows: ${rows.length} | with any field diff: ${differingRows}`);
  console.log(
    `Totals: PAYE=${totals.paye.toFixed(2)} net_pay=${totals.net.toFixed(2)} employee_ssnit=${totals.ssnit.toFixed(2)} | Casual PAYE=${totals.casualPaye.toFixed(2)} Casual net=${totals.casualNet.toFixed(2)}`,
  );

  return { rows, comparisons, totals, differingRows, employeeById };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadEnvForce(resolve(args.envFile));

  assert(
    !(args.strictPayeOnly && args.fullResync),
    "Use either --strict-paye-only or --full-resync, not both",
  );
  if (args.fullResync) {
    assert(
      args.expectedRows != null && Number.isFinite(args.expectedRows),
      "--full-resync requires --expected-rows N",
    );
  }

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  assert(url && key, "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");

  const isProduction = url.includes(PRODUCTION_REF);
  const isStaging = url.includes(STAGING_REF);
  assert(
    isProduction || isStaging,
    `URL must be staging (${STAGING_REF}) or production (${PRODUCTION_REF})`,
  );
  if (isProduction) {
    assert(
      args.allowProduction,
      "Refusing production without --allow-production",
    );
  }

  const admin = createClient(url, key, { auth: { persistSession: false } });
  const PAYROLL_MONTH = args.payrollMonth;
  const year = Number(PAYROLL_MONTH.slice(0, 4));
  const month = Number(PAYROLL_MONTH.slice(5, 7));
  const period = resolveSelectedPeriod(year, month);
  assert(period.payrollMonth === PAYROLL_MONTH, "Period mismatch");

  console.log(
    `Mode: ${args.apply ? "APPLY" : "DRY-RUN"} | env=${args.envFile} | ` +
      `target=${isProduction ? "PRODUCTION" : "STAGING"} | tenant=${args.tenantId} | month=${PAYROLL_MONTH}` +
      (args.strictPayeOnly ? " | strict-paye-only" : "") +
      (args.fullResync ? ` | full-resync expected-rows=${args.expectedRows}` : "") +
      (args.maxRowsToUpdate != null ? ` | max-rows=${args.maxRowsToUpdate}` : ""),
  );

  const ctx = await loadContext(admin, args.tenantId, period, PAYROLL_MONTH);

  const lockStatus = ctx.closeRecord?.lock_status ?? null;
  if (
    lockStatus === PAYROLL_STATUS_LOCKED ||
    lockStatus === PAYROLL_STATUS_PARTIALLY_LOCKED
  ) {
    throw new Error(
      `ABORT: ${PAYROLL_MONTH} month_end_close.lock_status=${lockStatus}. No writes.`,
    );
  }
  if (ctx.historyRows.length > 0) {
    throw new Error(
      `ABORT: ${ctx.historyRows.length} payroll_history row(s) for ${PAYROLL_MONTH}. No writes.`,
    );
  }

  const before = await runComparison(
    admin,
    args.tenantId,
    PAYROLL_MONTH,
    period,
    ctx,
    "Before (stored DB)",
  );

  const toUpdate = before.comparisons.filter((c) => c.hasAnyDiff);

  if (args.fullResync) {
    console.log("\n--- Full-resync guards ---");
    console.log(
      `payroll_history: ${ctx.historyRows.length} (require 0) — ${ctx.historyRows.length === 0 ? "OK" : "FAIL"}`,
    );
    console.log(
      `month_end_close: ${lockStatus ?? "open"} (require not locked/partial) — ${
        lockStatus === PAYROLL_STATUS_LOCKED ||
        lockStatus === PAYROLL_STATUS_PARTIALLY_LOCKED
          ? "FAIL"
          : "OK"
      }`,
    );

    const guardFailures = runProdSep2026FullResyncGuards(
      toUpdate,
      before.comparisons,
      before.employeeById,
      PAYROLL_MONTH,
      args.expectedRows,
    );

    const df0004Plan = toUpdate.find((p) => p.employee.staff_id === "DF0004");
    if (df0004Plan) {
      const allowanceByEmployee = new Map();
      for (const line of ctx.allowanceLinesAll) {
        const list = allowanceByEmployee.get(line.employee_id) ?? [];
        list.push(line);
        allowanceByEmployee.set(line.employee_id, list);
      }
      const storedLines = allowanceByEmployee.get(df0004Plan.row.employee_id) ?? [];
      const policyLines = df0004Plan.policy?.allowance_lines ?? [];
      const linesMatch = allowanceLinesMatch(storedLines, policyLines);
      console.log(
        `DF0004 payroll_allowance_lines (processing): stored ${storedLines.length} line(s), policy ${policyLines.length} line(s), match=${linesMatch}`,
      );
      if (!linesMatch) {
        console.log(
          "  → On --apply, would run persistAllowanceLines (syncProcessingAllowanceLines) for DF0004.",
        );
        if (storedLines.length === 0 && policyLines.length > 0) {
          console.log(
            "  → Stored lines missing; apply must write allowance lines before/at lock.",
          );
        }
      } else {
        console.log("  → Allowance lines OK; apply may still refresh via sync (no-op if unchanged).");
      }
    }

    const freshTotals = sumFreshTotals(before.comparisons, before.employeeById);
    console.log(
      `\nFresh totals (all ${before.rows.length} rows after resync): PAYE=${freshTotals.paye.toFixed(2)} welfare=${freshTotals.welfare.toFixed(2)} total_ded=${freshTotals.totalDeductions.toFixed(2)} net=${freshTotals.net.toFixed(2)} ssnit=${freshTotals.ssnit.toFixed(2)} casual_paye=${freshTotals.casualPaye.toFixed(2)}`,
    );

    if (guardFailures.length > 0) {
      console.error("\nABORT — full-resync guard failures:");
      for (const f of guardFailures) {
        console.error(`  • ${f}`);
      }
      throw new Error("Full-resync guards failed — no writes");
    }
    console.log("All full-resync guards passed.");
  }

  if (args.strictPayeOnly) {
    for (const plan of toUpdate) {
      if (plan.disallowed.length > 0) {
        console.error(
          `\nABORT: ${plan.employee.staff_id} has disallowed field diffs:`,
        );
        for (const d of plan.disallowed) {
          console.error(
            `  ${d.field}: stored ${d.storedVal} → fresh ${d.freshVal}`,
          );
        }
        throw new Error(
          "ABORT: field diff outside paye_tax, total_deductions, net_pay",
        );
      }
    }
    if (args.maxRowsToUpdate != null && toUpdate.length > args.maxRowsToUpdate) {
      throw new Error(
        `ABORT: ${toUpdate.length} rows would change (max ${args.maxRowsToUpdate})`,
      );
    }
  }

  console.log("\n--- Rows to update ---");
  const sortedUpdate = [...toUpdate].sort((a, b) =>
    String(a.employee.staff_id).localeCompare(String(b.employee.staff_id)),
  );
  for (const plan of sortedUpdate) {
    console.log(
      `${plan.employee.staff_id} ${plan.employee.full_name}: ` +
        `paye ${round2(plan.row.paye_tax).toFixed(2)} → ${round2(plan.calculated.paye_tax).toFixed(2)} | ` +
        `net ${round2(plan.row.net_pay).toFixed(2)} → ${round2(plan.calculated.net_pay).toFixed(2)}`,
    );
  }
  console.log(`Count: ${toUpdate.length}`);

  if (!args.apply) {
    console.log("\nDry-run only — no writes. Re-run with --apply to persist.");
    if (args.fullResync && isProduction) {
      console.log(
        "\nSuggested apply command:\n" +
          `npx tsx scripts/resync-open-payroll-processing-paye.ts --env-file ${args.envFile} --allow-production --apply --full-resync --expected-rows ${args.expectedRows} --payroll-month ${PAYROLL_MONTH} --tenant ${args.tenantId}`,
      );
    }
    return;
  }

  if (toUpdate.length === 0) {
    console.log("Nothing to update.");
    return;
  }

  const beforePaye = before.totals.paye;
  const beforeNet = before.totals.net;
  const beforeWelfare = before.totals.welfare;
  const beforeTotalDed = before.totals.totalDeductions;
  const beforeCasualPaye = before.totals.casualPaye;
  const beforeCasualNet = before.totals.casualNet;
  const beforeSsnit = before.totals.ssnit;

  for (const plan of toUpdate) {
    const { error: updErr } = await admin
      .from("payroll_processing")
      .update(plan.update)
      .eq("id", plan.row.id)
      .eq("tenant_id", args.tenantId)
      .eq("payroll_month", PAYROLL_MONTH);

    assert(
      !updErr,
      updErr?.message ?? `Update failed for ${plan.row.id} (${plan.employee.staff_id})`,
    );

    if (args.fullResync && plan.policy?.allowance_lines?.length) {
      const allowResult = await syncProcessingAllowanceLinesForTenant(
        admin,
        args.tenantId,
        PAYROLL_MONTH,
        plan.employee.employee_id,
        plan.policy.allowance_lines,
      );
      if (allowResult.error) {
        throw new Error(
          `Allowance lines failed for ${plan.employee.staff_id}: ${allowResult.error}`,
        );
      }
    }
  }

  console.log(`\nApplied ${toUpdate.length} update(s).`);

  const after = await runComparison(
    admin,
    args.tenantId,
    PAYROLL_MONTH,
    period,
    ctx,
    "After (stored DB + post-apply verify)",
  );

  assert(
    after.differingRows === 0,
    `Post-apply: expected 0 differing rows, got ${after.differingRows}`,
  );

  const payeDelta = round2(after.totals.paye - beforePaye);
  const netDelta = round2(after.totals.net - beforeNet);

  console.log("\n--- Apply verification ---");
  console.log(`PAYE before=${beforePaye.toFixed(2)} after=${after.totals.paye.toFixed(2)} Δ=${payeDelta.toFixed(2)}`);
  console.log(`Net before=${beforeNet.toFixed(2)} after=${after.totals.net.toFixed(2)} Δ=${netDelta.toFixed(2)}`);
  console.log(
    `Casual PAYE before=${beforeCasualPaye.toFixed(2)} after=${after.totals.casualPaye.toFixed(2)}`,
  );
  console.log(
    `Casual net before=${beforeCasualNet.toFixed(2)} after=${after.totals.casualNet.toFixed(2)}`,
  );
  console.log(
    `SSNIT sum before=${beforeSsnit.toFixed(2)} after=${after.totals.ssnit.toFixed(2)}`,
  );

  if (args.fullResync && PAYROLL_MONTH === "2026-09-01") {
    assert(
      almostEqual(after.totals.paye, PROD_SEP_2026_FRESH_TOTALS.paye),
      "Post-apply PAYE total mismatch",
    );
    assert(
      almostEqual(after.totals.welfare, PROD_SEP_2026_FRESH_TOTALS.welfare),
      "Post-apply welfare total mismatch",
    );
    assert(
      almostEqual(after.totals.net, PROD_SEP_2026_FRESH_TOTALS.net),
      "Post-apply net total mismatch",
    );
    assert(
      almostEqual(after.totals.casualPaye, PROD_SEP_2026_FRESH_TOTALS.casualPaye),
      "Post-apply Casual PAYE mismatch",
    );
  } else {
    assert(
      almostEqual(after.totals.casualPaye, beforeCasualPaye),
      "Casual PAYE changed",
    );
    assert(
      almostEqual(after.totals.casualNet, beforeCasualNet),
      "Casual net pay changed",
    );
  }
  if (!args.fullResync) {
    assert(
      almostEqual(after.totals.ssnit, beforeSsnit),
      "SSNIT totals changed",
    );
  }

  if (args.strictPayeOnly && PAYROLL_MONTH === "2026-09-01") {
    assert(
      almostEqual(after.totals.paye, 802.75),
      `Expected PAYE total 802.75, got ${after.totals.paye}`,
    );
    assert(
      almostEqual(netDelta, 66.9),
      `Expected net Δ +66.90, got ${netDelta}`,
    );
  }

  const eventName = args.fullResync
    ? "payroll_processing_full_resync"
    : "payroll_processing_paye_resync";

  await logSystemEvent(admin, {
    eventName,
    status: "success",
    message: `Resynced ${toUpdate.length} open payroll_processing row(s) for ${PAYROLL_MONTH}`,
    metadata: {
      tenant_id: args.tenantId,
      payroll_month: PAYROLL_MONTH,
      target: isProduction ? "production" : "staging",
      rows_updated: toUpdate.length,
      staff_ids: toUpdate.map((p) => p.employee.staff_id).sort(),
      paye_before: beforePaye,
      paye_after: after.totals.paye,
      welfare_before: beforeWelfare,
      welfare_after: after.totals.welfare,
      total_deductions_before: beforeTotalDed,
      total_deductions_after: after.totals.totalDeductions,
      net_before: beforeNet,
      net_after: after.totals.net,
      employee_ssnit_before: beforeSsnit,
      employee_ssnit_after: after.totals.ssnit,
      casual_paye_before: beforeCasualPaye,
      casual_paye_after: after.totals.casualPaye,
      strict_paye_only: args.strictPayeOnly,
      full_resync: args.fullResync,
    },
  });

  console.log(`\nDone. system_event_log row written (event_name=${eventName}).`);
}

main().catch(async (err) => {
  console.error("FAIL:", err.message ?? err);
  process.exit(1);
});
