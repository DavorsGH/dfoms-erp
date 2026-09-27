/**
 * READ-ONLY: Act 1178 PAYE impact on open September 2026 payroll_processing (Davors staging).
 *
 *   npx tsx scripts/dry-run-sep-2026-paye-act1178-staging.ts --env-file .env.local
 *
 * Refuses production. Performs no INSERT/UPDATE/DELETE.
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
  calculatePayeTax,
} from "../app/dashboard/employees/pay-estimate-utils";
import {
  getPeriodEndDate,
  getPeriodStartDate,
  resolveSelectedPeriod,
} from "../app/dashboard/hr-payroll/payroll-period-utils";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const DAVORS = "00000001-0000-4000-8000-000000000001";
const PAYROLL_MONTH = "2026-09-01";

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

function isoTs(value) {
  if (value == null || value === "") return null;
  const s = String(value);
  return s.length >= 19 ? s.slice(0, 19).replace("T", " ") : s;
}

function isAfter(a, b) {
  if (!a || !b) return false;
  return new Date(a).getTime() > new Date(b).getTime();
}

function formatAllowanceLines(lines) {
  if (!lines?.length) return "(none)";
  return lines
    .map(
      (l) =>
        `${l.allowance_code ?? l.code ?? "?"}=${round2(Number(l.amount) || 0).toFixed(2)}`,
    )
    .join(", ");
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

function parseArgs(argv) {
  const envIdx = argv.indexOf("--env-file");
  return {
    envFile: envIdx >= 0 && argv[envIdx + 1] ? argv[envIdx + 1] : ".env.local",
    tenantId:
      argv.includes("--tenant") && argv[argv.indexOf("--tenant") + 1]
        ? argv[argv.indexOf("--tenant") + 1]
        : DAVORS,
  };
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

function ladderTopOfFirstBand(bands) {
  const sorted = [...bands].sort(
    (a, b) => (a.band_order ?? 0) - (b.band_order ?? 0),
  );
  const first = sorted[0];
  return first?.band_to ?? first?.band_from ?? null;
}

function effectiveDateKeyForPick(allPayrollBands, asOf) {
  const asOfDate = asOf.slice(0, 10);
  const keys = [
    ...new Set(
      allPayrollBands.map((b) =>
        b.effective_date ? String(b.effective_date).slice(0, 10) : "",
      ),
    ),
  ].filter(Boolean);
  const eligible = keys.filter((k) => k <= asOfDate).sort((a, b) => b.localeCompare(a));
  return eligible[0] ?? keys.sort((a, b) => b.localeCompare(a))[0] ?? null;
}

async function loadTaxAndPolicy(admin, tenantId) {
  const [
    { data: salaryRates },
    { data: allowanceTypes },
    { data: compensationPolicies },
    { data: ssnitRows },
    { data: casualRows },
    { data: payeRows, error: payeErr },
  ] = await Promise.all([
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
  ]);

  assert(!payeErr, payeErr?.message ?? "paye_tax_bands fetch failed");

  return {
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
    rawPayeRows: payeRows ?? [],
  };
}

async function loadSeptemberContext(admin, tenantId, period) {
  const periodStart = getPeriodStartDate(period.year, period.month);
  const periodEnd = getPeriodEndDate(period.year, period.month);

  const [
    { data: employees, error: empErr },
    taxBundle,
    { data: salaryRatesAll },
    { data: compensationPoliciesAll },
    { data: allowanceLinesAll },
  ] = await Promise.all([
    admin
      .from("employees")
      .select(
        "employee_id, staff_id, full_name, employment_type, employment_status, date_hired, appointment_end_date, position, shift, basic_salary, housing_allowance, transport_allowance, other_allowances, welfare_deduction_rate, department, contract_project",
      )
      .eq("tenant_id", tenantId),
    loadTaxAndPolicy(admin, tenantId),
    admin
      .from("salary_rate_config")
      .select(
        "position, employment_type, shift, basic_salary, effective_date, updated_at, created_at",
      )
      .eq("tenant_id", tenantId)
      .order("effective_date", { ascending: false }),
    admin
      .from("compensation_policy")
      .select(
        "position, employment_type, shift, updated_at, created_at, effective_date",
      )
      .eq("tenant_id", tenantId),
    admin
      .from("payroll_allowance_lines")
      .select(
        "employee_id, allowance_code, amount, updated_at, created_at, stage",
      )
      .eq("tenant_id", tenantId)
      .eq("payroll_month", PAYROLL_MONTH)
      .eq("stage", "processing"),
  ]);

  assert(!empErr, empErr?.message ?? "employees fetch failed");

  const [
    { data: attendance },
    { data: overtime },
    { data: loans },
    { data: processingRows, error: procErr },
    { data: historyRows, error: histErr },
  ] = await Promise.all([
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
    admin
      .from("loan_register")
      .select("*")
      .eq("tenant_id", tenantId),
    admin
      .from("payroll_processing")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("payroll_month", PAYROLL_MONTH),
    admin
      .from("payroll_history")
      .select("id, employee_id, paye_tax, payroll_month")
      .eq("tenant_id", tenantId)
      .eq("payroll_month", PAYROLL_MONTH),
  ]);

  assert(!procErr, procErr?.message ?? "payroll_processing fetch failed");
  assert(!histErr, histErr?.message ?? "payroll_history fetch failed");

  return {
    employees: employees ?? [],
    attendance: attendance ?? [],
    overtime: overtime ?? [],
    loans: loans ?? [],
    processingRows: processingRows ?? [],
    historyRows: historyRows ?? [],
    salaryRatesAll: salaryRatesAll ?? [],
    compensationPoliciesAll: compensationPoliciesAll ?? [],
    allowanceLinesAll: allowanceLinesAll ?? [],
    periodStart,
    periodEnd,
    ...taxBundle,
  };
}

function recalculateRowFull(row, employee, period, ctx) {
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

function inferFieldCause(
  field,
  stored,
  fresh,
  ctx,
  employee,
  policy,
  row,
  storedAllowanceLines,
) {
  const rowUpdated = row.updated_at ?? row.created_at ?? null;
  const hints = [];

  const matchingSalaryRates = ctx.salaryRatesAll.filter(
    (r) =>
      r.position === employee.position &&
      r.employment_type === employee.employment_type &&
      r.shift === employee.shift,
  );
  const latestSalaryRate = matchingSalaryRates[0];
  if (
    latestSalaryRate &&
    isAfter(latestSalaryRate.updated_at ?? latestSalaryRate.created_at, rowUpdated)
  ) {
    hints.push(
      `salary_rate_config updated ${isoTs(latestSalaryRate.updated_at ?? latestSalaryRate.created_at)} (effective ${latestSalaryRate.effective_date}) after payroll row ${isoTs(rowUpdated)}`,
    );
  }

  const matchingPolicies = ctx.compensationPoliciesAll.filter(
    (p) =>
      p.position === employee.position &&
      p.employment_type === employee.employment_type &&
      p.shift === employee.shift,
  );
  const latestPolicy = matchingPolicies[0];
  if (
    latestPolicy &&
    isAfter(latestPolicy.updated_at ?? latestPolicy.created_at, rowUpdated)
  ) {
    hints.push(
      `compensation_policy updated ${isoTs(latestPolicy.updated_at ?? latestPolicy.created_at)} after payroll row ${isoTs(rowUpdated)}`,
    );
  }


  const absenceCount = countAbsencesForStaff(
    ctx.attendance,
    employee.staff_id,
    2026,
    9,
  );
  const otAmount = sumOvertimeForEmployee(
    ctx.overtime,
    employee.employee_id,
    2026,
    9,
  );
  const loanRep = calculateLoanRepaymentForEmployee(
    ctx.loans,
    employee.employee_id,
  );
  const empLoans = ctx.loans.filter((l) => l.employee_id === employee.employee_id);
  const latestLoanTouch = empLoans.reduce((max, l) => {
    const t = l.updated_at ?? l.created_at;
    return t && (!max || new Date(t) > new Date(max)) ? t : max;
  }, null);

  if (
    ["absence_deduction", "days_to_pay", "basic_salary", "daily_rate", "gross_pay"].includes(
      field,
    ) &&
    absenceCount > 0
  ) {
    hints.push(`attendance: ${absenceCount} absence(s) in Sep 2026 window`);
  }

  if (field === "overtime_amount" && otAmount !== round2(stored)) {
    hints.push(`overtime_register sum for month = ${round2(otAmount)}`);
  }

  if (
    field === "loan_repayment" &&
    !almostEqual(loanRep, stored) &&
    latestLoanTouch &&
    rowUpdated &&
    isAfter(latestLoanTouch, rowUpdated)
  ) {
    hints.push(
      `loan_register touched ${isoTs(latestLoanTouch)} after payroll row ${isoTs(rowUpdated)}`,
    );
  }

  if (
    [
      "housing_allowance",
      "transport_allowance",
      "other_allowances",
      "gross_pay",
      "basic_salary",
    ].includes(field) &&
    policy &&
    !allowanceLinesMatch(storedAllowanceLines, policy.allowance_lines)
  ) {
    hints.push(
      `payroll_allowance_lines stored [${formatAllowanceLines(storedAllowanceLines)}] ≠ live policy lines [${formatAllowanceLines(policy.allowance_lines)}] — page load syncOpenPeriod refreshes lines but does not rewrite payroll_processing amounts`,
    );
    const lineTouch = (storedAllowanceLines ?? []).reduce((max, l) => {
      const t = l.updated_at ?? l.created_at;
      return t && (!max || new Date(t) > new Date(max)) ? t : max;
    }, null);
    if (lineTouch) {
      hints.push(`allowance lines last touched ${isoTs(lineTouch)}`);
    }
  }

  if (field === "paye_tax" && !almostEqual(fresh, stored)) {
    hints.push(
      "PAYE bands: period end 2026-09-30 selects effective_date 2026-09-01 ladder (Act 1178); stored row likely calculated before new bands existed",
    );
  }

  if (field === "welfare_deduction") {
    hints.push(
      "welfare is derived from gross × employee welfare % — moves with gross/policy, not PAYE bands alone",
    );
  }

  if (hints.length === 0) {
    hints.push(
      "no timestamp evidence after payroll row — may be manual edit on row, proration/days_to_pay preserved from save, or allowance/gross drift vs policy lines",
    );
  }

  return hints;
}

function recalculateRow(row, employee, period, ctx) {
  return recalculateRowFull(row, employee, period, ctx).calculated;
}

async function main() {
  if (process.argv.includes("--apply")) {
    throw new Error("This script is dry-run only — remove --apply.");
  }

  const args = parseArgs(process.argv.slice(2));
  loadEnvForce(resolve(args.envFile));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  assert(url && key, "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  assert(
    url.includes(STAGING_REF),
    `Refusing non-staging URL (expected ${STAGING_REF}, got ${url})`,
  );
  assert(
    !url.includes(PRODUCTION_REF),
    "Refusing production URL for this dry-run script.",
  );

  const admin = createClient(url, key, { auth: { persistSession: false } });
  const period = resolveSelectedPeriod(2026, 9);
  assert(period.payrollMonth === PAYROLL_MONTH, "Period mismatch");

  const ctx = await loadSeptemberContext(admin, args.tenantId, period);
  const employeeById = new Map(ctx.employees.map((e) => [e.employee_id, e]));

  console.log(
    `DRY-RUN ONLY | tenant=${args.tenantId} | month=${PAYROLL_MONTH} | processing rows=${ctx.processingRows.length}`,
  );
  console.log(
    `payroll_history rows for 2026-09 (read-only check): ${ctx.historyRows.length} — script performs no writes`,
  );

  const allBands = ctx.taxConfigs.payeBands;
  const sepEnd = getPeriodEndDate(2026, 9);
  const augEnd = getPeriodEndDate(2026, 8);
  const sepPicked = pickPayeBandsForDate(allBands, sepEnd);
  const augPicked = pickPayeBandsForDate(allBands, augEnd);
  const sepEffective = effectiveDateKeyForPick(allBands, sepEnd);
  const augEffective = effectiveDateKeyForPick(allBands, augEnd);

  console.log("\n--- PAYE ladder checks ---");
  console.log(`August 2026 period end ${augEnd} → effective_date ${augEffective}`);
  console.log(`  first band top: ${ladderTopOfFirstBand(augPicked)} (expect 490 pre–Act 1178)`);
  console.log(`September 2026 period end ${sepEnd} → effective_date ${sepEffective}`);
  console.log(`  first band top: ${ladderTopOfFirstBand(sepPicked)} (expect 588 Act 1178)`);

  assert(augEffective === "2026-01-01", `August must use 2026-01-01 ladder, got ${augEffective}`);
  assert(sepEffective === "2026-09-01", `September must use 2026-09-01 ladder, got ${sepEffective}`);

  const sanityPaye = calculatePayeTax(1000, sepPicked);
  console.log(`\nSanity: taxable GHS 1,000 → PAYE ${sanityPaye.toFixed(2)} (expect 54.60)`);
  assert(
    Math.abs(sanityPaye - 54.6) < 0.01,
    `Sanity PAYE failed: ${sanityPaye}`,
  );

  const augPeriod = resolveSelectedPeriod(2026, 8);
  const augSample = ctx.processingRows[0];
  if (augSample) {
    const augEmp = employeeById.get(augSample.employee_id);
    if (augEmp && augEmp.employment_type !== "Casual") {
      const augCalc = recalculateRow(augSample, augEmp, augPeriod, ctx);
      const augBandsUsed = pickPayeBandsForDate(allBands, augEnd);
      assert(
        ladderTopOfFirstBand(augBandsUsed) === 490,
        "August calculatePayrollRow must use Jan 2026 ladder",
      );
      console.log(
        `\nAugust 2026 spot-check (${augEmp.staff_id}): recalc PAYE=${augCalc.paye_tax.toFixed(2)} under ${augEffective} ladder`,
      );
    }
  }

  console.log("\n--- Per employee (September 2026 open processing) ---");
  console.log(
    "staff".padEnd(8) +
      "name".padEnd(22) +
      "type".padEnd(12) +
      "taxable".padStart(10) +
      "paye_old".padStart(10) +
      "paye_new".padStart(10) +
      "diff".padStart(8) +
      "netΔ".padStart(8) +
      "ssnitΔ".padStart(8),
  );

  const allowanceByEmployee = new Map();
  for (const line of ctx.allowanceLinesAll) {
    const list = allowanceByEmployee.get(line.employee_id) ?? [];
    list.push(line);
    allowanceByEmployee.set(line.employee_id, list);
  }

  let totalOldPaye = 0;
  let totalNewPaye = 0;
  let totalNetDelta = 0;
  let totalPayeOnlyNetDelta = 0;
  let casualCount = 0;
  let ssnitMismatch = 0;
  let rowsWithAnyDiff = 0;

  for (const row of ctx.processingRows) {
    const employee = employeeById.get(row.employee_id);
    if (!employee) {
      console.warn(`SKIP ${row.employee_id}: no employee master`);
      continue;
    }

    const { calculated, payload, policy, taxableIncome } = recalculateRowFull(
      row,
      employee,
      period,
      ctx,
    );
    const storedPaye = round2(row.paye_tax);
    const newPaye = round2(calculated.paye_tax);
    const storedSsnit = round2(row.employee_ssnit);
    const newSsnit = round2(calculated.employee_ssnit);
    const payeDiff = round2(newPaye - storedPaye);
    const netDelta = round2(Number(calculated.net_pay) - Number(row.net_pay));
    const payeOnlyNetDelta = round2(-payeDiff);
    const otherNetDelta = round2(netDelta - payeOnlyNetDelta);
    const ssnitDelta = round2(newSsnit - storedSsnit);

    totalOldPaye += storedPaye;
    totalNewPaye += newPaye;
    totalNetDelta += netDelta;
    totalPayeOnlyNetDelta += payeOnlyNetDelta;

    const type = String(employee.employment_type ?? "").trim();
    if (type === "Casual") {
      casualCount += 1;
    }

    if (ssnitDelta !== 0) {
      ssnitMismatch += 1;
    }

    const name = String(employee.full_name ?? "").slice(0, 20);
    console.log(
      String(employee.staff_id).padEnd(8) +
        name.padEnd(22) +
        type.slice(0, 11).padEnd(12) +
        taxableIncome.toFixed(2).padStart(10) +
        storedPaye.toFixed(2).padStart(10) +
        newPaye.toFixed(2).padStart(10) +
        payeDiff.toFixed(2).padStart(8) +
        netDelta.toFixed(2).padStart(8) +
        ssnitDelta.toFixed(2).padStart(8),
    );
  }

  console.log("\n--- Field-by-field diffs (stored vs fresh calculatePayrollRow) ---");
  console.log(
    `payroll_processing row updated_at shown for evidence; no DB writes.\n`,
  );

  for (const row of ctx.processingRows) {
    const employee = employeeById.get(row.employee_id);
    if (!employee) continue;

    const storedAllowanceLines = allowanceByEmployee.get(row.employee_id) ?? [];
    const { calculated, payload, policy, taxableIncome } = recalculateRowFull(
      row,
      employee,
      period,
      ctx,
    );

    const storedTaxable = round2(
      Math.max(Number(row.gross_pay) - Number(row.employee_ssnit), 0),
    );
    const fieldDiffs = [];

    for (const field of NUMERIC_COMPARE_FIELDS) {
      const storedVal = round2(row[field] ?? 0);
      const freshVal = round2(payload[field] ?? 0);
      if (!almostEqual(storedVal, freshVal)) {
        fieldDiffs.push({ field, storedVal, freshVal });
      }
    }
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

    if (fieldDiffs.length === 0) continue;
    rowsWithAnyDiff += 1;

    console.log(`\n### ${employee.staff_id} — ${employee.full_name} (${employee.employment_type})`);
    console.log(
      `payroll_processing.updated_at: ${isoTs(row.updated_at ?? row.created_at)}`,
    );

    for (const diff of fieldDiffs) {
      console.log(
        `  ${diff.field}: stored ${diff.storedVal.toFixed(2)} → fresh ${diff.freshVal.toFixed(2)} (Δ ${round2(diff.freshVal - diff.storedVal).toFixed(2)})`,
      );
      const causes = inferFieldCause(
        diff.field.startsWith("taxable") ? "gross_pay" : diff.field,
        diff.storedVal,
        diff.freshVal,
        ctx,
        employee,
        policy,
        row,
        storedAllowanceLines,
      );
      for (const cause of causes) {
        console.log(`    → ${cause}`);
      }
    }

    if (storedAllowanceLines.length || policy?.allowance_lines?.length) {
      console.log(
        `  allowance lines stored: [${formatAllowanceLines(storedAllowanceLines)}]`,
      );
      console.log(
        `  allowance lines policy: [${formatAllowanceLines(policy?.allowance_lines ?? [])}]`,
      );
    }

    const netDelta = round2(Number(calculated.net_pay) - Number(row.net_pay));
    const payeOnlyNet = round2(-(round2(calculated.paye_tax) - round2(row.paye_tax)));
    console.log(
      `  net_pay Δ total ${netDelta.toFixed(2)} | attributable to PAYE only ${payeOnlyNet.toFixed(2)} | other ${round2(netDelta - payeOnlyNet).toFixed(2)}`,
    );
  }

  console.log(`\nRows with ≥1 field difference: ${rowsWithAnyDiff} / ${ctx.processingRows.length}`);

  console.log("\n--- Totals ---");
  console.log(`Stored PAYE sum:      ${round2(totalOldPaye).toFixed(2)}`);
  console.log(`Recalculated PAYE sum: ${round2(totalNewPaye).toFixed(2)}`);
  console.log(
    `PAYE delta:           ${round2(totalNewPaye - totalOldPaye).toFixed(2)}`,
  );
  console.log(`Sum of net_pay change (fresh − stored): ${round2(totalNetDelta).toFixed(2)}`);
  console.log(
    `  of which PAYE-only (lower tax → higher net): ${round2(totalPayeOnlyNetDelta).toFixed(2)}`,
  );
  console.log(
    `  of which other fields (gross/welfare/etc.): ${round2(totalNetDelta - totalPayeOnlyNetDelta).toFixed(2)}`,
  );
  console.log(`Casual employees: ${casualCount}`);
  console.log(
    `Rows with SSNIT delta ≠ 0 (summary table): ${ssnitMismatch}`,
  );
  console.log("\nNo database writes were performed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
