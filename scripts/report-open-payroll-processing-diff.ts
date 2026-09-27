/**
 * READ-ONLY: stored payroll_processing vs fresh calculatePayrollRow (full field compare).
 * Never writes. Does not abort on disallowed diffs — reports all rows.
 *
 *   npx tsx scripts/report-open-payroll-processing-diff.ts --env-file .env.local.backup \
 *     --allow-production --payroll-month 2026-09-01 --tenant 00000001-0000-4000-8000-000000000001
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

const PAYE_WELFARE_ROLLUP_FIELDS = new Set([
  "paye_tax",
  "welfare_deduction",
  "total_deductions",
  "net_pay",
]);

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
  if (value == null || value === "") return "(none)";
  const s = String(value);
  return s.length >= 19 ? s.slice(0, 19).replace("T", " ") : s;
}

function isAfter(a, b) {
  if (!a || !b) return false;
  return new Date(a).getTime() > new Date(b).getTime();
}

function parseArgs(argv) {
  const envIdx = argv.indexOf("--env-file");
  const monthIdx = argv.indexOf("--payroll-month");
  const tenantIdx = argv.indexOf("--tenant");
  return {
    envFile:
      envIdx >= 0 && argv[envIdx + 1] ? argv[envIdx + 1] : ".env.staging.local",
    allowProduction: argv.includes("--allow-production"),
    payrollMonth:
      monthIdx >= 0 && argv[monthIdx + 1]
        ? String(argv[monthIdx + 1]).slice(0, 10)
        : "2026-09-01",
    tenantId:
      tenantIdx >= 0 && argv[tenantIdx + 1]
        ? argv[tenantIdx + 1]
        : DAVORS,
  };
}

function isOpenProcessingStatus(status) {
  return OPEN_STATUSES.has(String(status ?? "").trim().toLowerCase());
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
    { data: hrPayrollSettings },
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
    admin
      .from("hr_payroll_settings")
      .select(
        "tenant_id, default_welfare_deduction_rate, created_at, updated_at, business_unit_id",
      )
      .eq("tenant_id", tenantId),
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
    hrPayrollSettings: hrPayrollSettings ?? [],
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
  return { calculated, payload, policy, taxableIncome };
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

  const netDelta = round2(Number(calculated.net_pay) - Number(row.net_pay));
  const payeDelta = round2(calculated.paye_tax - row.paye_tax);
  const welfareDelta = round2(calculated.welfare_deduction - row.welfare_deduction);
  const payeOnlyNet = round2(-payeDelta);
  const welfareOnlyNet = round2(-welfareDelta);
  const otherNet = round2(netDelta - payeOnlyNet - welfareOnlyNet);

  const unexpected = fieldDiffs.filter(
    (d) => !PAYE_WELFARE_ROLLUP_FIELDS.has(d.field),
  );

  return {
    calculated,
    payload,
    fieldDiffs,
    netDelta,
    payeOnlyNet,
    welfareOnlyNet,
    otherNet,
    unexpected,
    storedWelfare: round2(row.welfare_deduction ?? 0),
    freshWelfare: round2(calculated.welfare_deduction),
  };
}

function welfareEvidence(row, employee, ctx) {
  const rowTs = row.updated_at ?? row.created_at ?? null;
  const lines = [];
  lines.push(
    `payroll_processing: created ${isoTs(row.created_at)} updated ${isoTs(row.updated_at)} stored welfare=${round2(row.welfare_deduction ?? 0).toFixed(2)}`,
  );
  lines.push(
    `employees.welfare_deduction_rate (current): ${employee.welfare_deduction_rate ?? "(null)"}%`,
  );

  const settings = ctx.hrPayrollSettings ?? [];
  if (settings.length === 0) {
    lines.push("hr_payroll_settings: (no row for tenant)");
  } else {
    for (const s of settings) {
      lines.push(
        `hr_payroll_settings BU=${s.business_unit_id ?? "null"} default_rate=${s.default_welfare_deduction_rate ?? "(null)"}% created ${isoTs(s.created_at)} updated ${isoTs(s.updated_at)}`,
      );
      if (rowTs && isAfter(s.updated_at, rowTs)) {
        lines.push(
          "  → default/settings updated AFTER payroll row last write (rates on employees may have changed without persisting open payroll rows)",
        );
      }
    }
  }

  const rate = Number(employee.welfare_deduction_rate) || 0;
  if (rate > 0 && almostEqual(row.welfare_deduction ?? 0, 0)) {
    lines.push(
      "Stored welfare is 0 but employee has a positive rate — row was last persisted before welfare was applied in calculatePayrollRow (UI recalc is in-memory only on page load).",
    );
  }
  if (rate === 0 && !almostEqual(row.welfare_deduction ?? 0, 0)) {
    lines.push("Employee rate is 0/null but stored welfare is non-zero (manual legacy or override).");
  }

  return lines;
}

/** When onlyCasual is true, sum only Casual employees; when false, sum all rows. */
function sumField(rows, field, employeeById, onlyCasual = false) {
  let sum = 0;
  for (const row of rows) {
    const emp = employeeById.get(row.employee_id);
    if (onlyCasual && String(emp?.employment_type ?? "") !== "Casual") {
      continue;
    }
    sum += round2(row[field] ?? 0);
  }
  return round2(sum);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  loadEnvForce(resolve(args.envFile));

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
    assert(args.allowProduction, "Refusing production without --allow-production");
  }

  const admin = createClient(url, key, { auth: { persistSession: false } });
  const PAYROLL_MONTH = args.payrollMonth;
  const year = Number(PAYROLL_MONTH.slice(0, 4));
  const month = Number(PAYROLL_MONTH.slice(5, 7));
  const period = resolveSelectedPeriod(year, month);

  console.log(
    `READ-ONLY REPORT | env=${args.envFile} | target=${isProduction ? "PRODUCTION" : "STAGING"} | tenant=${args.tenantId} | month=${PAYROLL_MONTH}`,
  );
  console.log("No database writes.\n");

  const ctx = await loadContext(admin, args.tenantId, period, PAYROLL_MONTH);

  const lockStatus = ctx.closeRecord?.lock_status ?? null;
  console.log("--- Month guards ---");
  console.log(
    `payroll_history rows for ${PAYROLL_MONTH}: ${ctx.historyRows.length}`,
  );
  console.log(
    `month_end_close.lock_status: ${lockStatus ?? "(none — month open)"}`,
  );
  if (
    lockStatus === PAYROLL_STATUS_LOCKED ||
    lockStatus === PAYROLL_STATUS_PARTIALLY_LOCKED
  ) {
    console.log("WARNING: month is locked/partially locked on this tenant record.");
  }

  const { data: procRows, error: procErr } = await admin
    .from("payroll_processing")
    .select("*")
    .eq("tenant_id", args.tenantId)
    .eq("payroll_month", PAYROLL_MONTH);
  assert(!procErr, procErr?.message ?? "payroll_processing fetch failed");

  const openRows = (procRows ?? []).filter((r) => isOpenProcessingStatus(r.status));
  const employeeById = new Map(ctx.employees.map((e) => [e.employee_id, e]));
  const allowanceByEmployee = new Map();
  for (const line of ctx.allowanceLinesAll) {
    const list = allowanceByEmployee.get(line.employee_id) ?? [];
    list.push(line);
    allowanceByEmployee.set(line.employee_id, list);
  }

  const comparisons = [];
  for (const row of openRows) {
    const employee = employeeById.get(row.employee_id);
    if (!employee) continue;
    const cmp = compareRow(row, employee, period, ctx, allowanceByEmployee);
    if (cmp.fieldDiffs.length > 0) {
      comparisons.push({ row, employee, ...cmp });
    }
  }

  comparisons.sort((a, b) =>
    String(a.employee.staff_id).localeCompare(String(b.employee.staff_id)),
  );

  console.log(`\nOpen payroll_processing rows: ${openRows.length}`);
  console.log(`Rows with ≥1 field difference: ${comparisons.length}\n`);

  const unexpectedRows = comparisons.filter((c) => c.unexpected.length > 0);
  if (unexpectedRows.length > 0) {
    console.log("=== FLAG: ROWS WITH DIFFS OUTSIDE paye / welfare / total_deductions / net_pay ===");
    for (const c of unexpectedRows) {
      console.log(
        `  ${c.employee.staff_id} ${c.employee.full_name}: ${c.unexpected.map((d) => d.field).join(", ")}`,
      );
    }
    console.log("");
  } else {
    console.log(
      "=== No rows differ outside paye_tax, welfare_deduction, total_deductions, net_pay (plus none on taxable/allowance lines). ===\n",
    );
  }

  console.log("--- Per differing row ---");
  for (const c of comparisons) {
    console.log(
      `\n### ${c.employee.staff_id} — ${c.employee.full_name} (${c.employee.employment_type})`,
    );
    console.log(
      `welfare_deduction_rate: ${c.employee.welfare_deduction_rate ?? "(null)"}%`,
    );
    for (const d of c.fieldDiffs) {
      console.log(
        `  ${d.field}: stored ${d.storedVal.toFixed(2)} → fresh ${d.freshVal.toFixed(2)} (Δ ${round2(d.freshVal - d.storedVal).toFixed(2)})`,
      );
    }
    console.log(
      `  net_pay Δ total ${c.netDelta.toFixed(2)} | PAYE-only (Act 1178) ${c.payeOnlyNet.toFixed(2)} | welfare ${c.welfareOnlyNet.toFixed(2)} | other ${c.otherNet.toFixed(2)}`,
    );
    if (c.fieldDiffs.some((d) => d.field === "welfare_deduction") || c.storedWelfare === 0 && c.freshWelfare > 0) {
      console.log("  Welfare evidence:");
      for (const line of welfareEvidence(c.row, c.employee, ctx)) {
        console.log(`    ${line}`);
      }
    }
  }

  const storedTotals = {
    paye: sumField(openRows, "paye_tax", employeeById),
    welfare: sumField(openRows, "welfare_deduction", employeeById),
    totalDed: sumField(openRows, "total_deductions", employeeById),
    net: sumField(openRows, "net_pay", employeeById),
    ssnit: sumField(openRows, "employee_ssnit", employeeById),
    casualPaye: 0,
    casualNet: 0,
    casualSsnit: 0,
  };
  const freshTotals = { ...storedTotals };
  let ssnitMismatch = 0;
  for (const row of openRows) {
    const employee = employeeById.get(row.employee_id);
    if (!employee) continue;
    const { calculated } = recalculateRow(row, employee, period, ctx);
    freshTotals.paye += round2(calculated.paye_tax);
    freshTotals.welfare += round2(calculated.welfare_deduction);
    freshTotals.totalDed += round2(calculated.total_deductions);
    freshTotals.net += round2(calculated.net_pay);
    freshTotals.ssnit += round2(calculated.employee_ssnit);
    if (!almostEqual(row.employee_ssnit, calculated.employee_ssnit)) {
      ssnitMismatch += 1;
    }
    if (String(employee.employment_type ?? "") === "Casual") {
      storedTotals.casualPaye += round2(row.paye_tax);
      storedTotals.casualNet += round2(row.net_pay);
      storedTotals.casualSsnit += round2(row.employee_ssnit);
      freshTotals.casualPaye += round2(calculated.paye_tax);
      freshTotals.casualNet += round2(calculated.net_pay);
      freshTotals.casualSsnit += round2(calculated.employee_ssnit);
    }
  }
  freshTotals.paye = round2(
    openRows.reduce((s, row) => {
      const e = employeeById.get(row.employee_id);
      if (!e) return s;
      return s + round2(recalculateRow(row, e, period, ctx).calculated.paye_tax);
    }, 0),
  );
  freshTotals.welfare = round2(
    openRows.reduce((s, row) => {
      const e = employeeById.get(row.employee_id);
      if (!e) return s;
      return (
        s + round2(recalculateRow(row, e, period, ctx).calculated.welfare_deduction)
      );
    }, 0),
  );
  freshTotals.totalDed = round2(
    openRows.reduce((s, row) => {
      const e = employeeById.get(row.employee_id);
      if (!e) return s;
      return (
        s + round2(recalculateRow(row, e, period, ctx).calculated.total_deductions)
      );
    }, 0),
  );
  freshTotals.net = round2(
    openRows.reduce((s, row) => {
      const e = employeeById.get(row.employee_id);
      if (!e) return s;
      return s + round2(recalculateRow(row, e, period, ctx).calculated.net_pay);
    }, 0),
  );
  freshTotals.ssnit = round2(
    openRows.reduce((s, row) => {
      const e = employeeById.get(row.employee_id);
      if (!e) return s;
      return s + round2(recalculateRow(row, e, period, ctx).calculated.employee_ssnit);
    }, 0),
  );

  storedTotals.paye = sumField(openRows, "paye_tax", employeeById);
  storedTotals.welfare = sumField(openRows, "welfare_deduction", employeeById);
  storedTotals.totalDed = sumField(openRows, "total_deductions", employeeById);
  storedTotals.net = sumField(openRows, "net_pay", employeeById);
  storedTotals.ssnit = sumField(openRows, "employee_ssnit", employeeById);
  storedTotals.casualPaye = sumField(openRows, "paye_tax", employeeById, true);
  storedTotals.casualNet = sumField(openRows, "net_pay", employeeById, true);
  storedTotals.casualSsnit = sumField(
    openRows,
    "employee_ssnit",
    employeeById,
    true,
  );

  freshTotals.casualPaye = round2(
    openRows.reduce((s, row) => {
      const e = employeeById.get(row.employee_id);
      if (!e || String(e.employment_type) !== "Casual") return s;
      return s + round2(recalculateRow(row, e, period, ctx).calculated.paye_tax);
    }, 0),
  );
  freshTotals.casualNet = round2(
    openRows.reduce((s, row) => {
      const e = employeeById.get(row.employee_id);
      if (!e || String(e.employment_type) !== "Casual") return s;
      return s + round2(recalculateRow(row, e, period, ctx).calculated.net_pay);
    }, 0),
  );
  freshTotals.casualSsnit = round2(
    openRows.reduce((s, row) => {
      const e = employeeById.get(row.employee_id);
      if (!e || String(e.employment_type) !== "Casual") return s;
      return s + round2(recalculateRow(row, e, period, ctx).calculated.employee_ssnit);
    }, 0),
  );

  console.log("\n--- Totals (all open rows) ---");
  console.log(
    `PAYE:              stored ${storedTotals.paye.toFixed(2)} → fresh ${freshTotals.paye.toFixed(2)} (Δ ${round2(freshTotals.paye - storedTotals.paye).toFixed(2)})`,
  );
  console.log(
    `welfare_deduction: stored ${storedTotals.welfare.toFixed(2)} → fresh ${freshTotals.welfare.toFixed(2)} (Δ ${round2(freshTotals.welfare - storedTotals.welfare).toFixed(2)})`,
  );
  console.log(
    `total_deductions:  stored ${storedTotals.totalDed.toFixed(2)} → fresh ${freshTotals.totalDed.toFixed(2)} (Δ ${round2(freshTotals.totalDed - storedTotals.totalDed).toFixed(2)})`,
  );
  console.log(
    `net_pay:           stored ${storedTotals.net.toFixed(2)} → fresh ${freshTotals.net.toFixed(2)} (Δ ${round2(freshTotals.net - storedTotals.net).toFixed(2)})`,
  );
  console.log(
    `employee_ssnit:    stored ${storedTotals.ssnit.toFixed(2)} → fresh ${freshTotals.ssnit.toFixed(2)} | per-row mismatches: ${ssnitMismatch}`,
  );
  console.log(
    `Casual PAYE:       stored ${storedTotals.casualPaye.toFixed(2)} → fresh ${freshTotals.casualPaye.toFixed(2)} ${almostEqual(storedTotals.casualPaye, freshTotals.casualPaye) ? "(unchanged)" : "CHANGED"}`,
  );
  console.log(
    `Casual net:        stored ${storedTotals.casualNet.toFixed(2)} → fresh ${freshTotals.casualNet.toFixed(2)} ${almostEqual(storedTotals.casualNet, freshTotals.casualNet) ? "(unchanged)" : "CHANGED"}`,
  );
  console.log(
    `Casual SSNIT:      stored ${storedTotals.casualSsnit.toFixed(2)} → fresh ${freshTotals.casualSsnit.toFixed(2)} ${almostEqual(storedTotals.casualSsnit, freshTotals.casualSsnit) ? "(unchanged)" : "CHANGED"}`,
  );

  console.log("\nReport complete. No database writes.");
}

main().catch((err) => {
  console.error("FAIL:", err.message ?? err);
  process.exit(1);
});
