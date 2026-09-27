/**
 * READ-ONLY production reconcile: Sep 2026 stored vs Davors Facilities BU page view.
 *
 * npx tsx scripts/probe-sep-2026-davors-facilities-reconcile-production.ts \
 *   --env-file .env.local.backup --allow-production
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { filterEmployeesForPayrollPeriod } from "../app/dashboard/hr-payroll/employee-utils";
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
import { fetchStatutoryPayrollTaxConfigs } from "../app/dashboard/hr-payroll/statutory-payroll-config-utils";
import {
  getPeriodEndDate,
  getPeriodStartDate,
  resolveSelectedPeriod,
} from "../app/dashboard/hr-payroll/payroll-period-utils";
import { getAttendanceMonthBounds } from "../app/dashboard/hr-payroll/attendance-register-utils";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const DAVORS = "00000001-0000-4000-8000-000000000001";
const PAYROLL_MONTH = "2026-09-01";
const FACILITIES_NAME = "Davors Facilities";

const NUMERIC_FIELDS = [
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

function round2(v) {
  return Math.round(Number(v) * 100) / 100;
}

function almostEqual(a, b, eps = 0.005) {
  return Math.abs(round2(a) - round2(b)) <= eps;
}

function parseArgs() {
  const argv = process.argv.slice(2);
  const envIdx = argv.indexOf("--env-file");
  return {
    envFile:
      envIdx >= 0 && argv[envIdx + 1]
        ? resolve(process.cwd(), argv[envIdx + 1])
        : resolve(process.cwd(), ".env.local.backup"),
    allowProduction: argv.includes("--allow-production"),
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
    welfare_deduction_rate: emp.welfare_deduction_rate ?? null,
    department: emp.department,
    contract_project: emp.contract_project,
  };
}

function pageLiveCalc(row, employee, period, ctx) {
  const source = toEmployeeSource(employee);
  const policy = resolvePayrollPolicyCompensation(
    source,
    ctx.policyConfig,
    new Date(getPeriodEndDate(period.year, period.month)),
  );
  return calculatePayrollRow(
    source,
    period,
    ctx.taxConfigs,
    {
      absenceCount: countAbsencesForStaff(
        ctx.periodAttendance,
        source.staff_id,
        period.year,
        period.month,
      ),
      overtimeAmount: sumOvertimeForEmployee(
        ctx.periodOvertime,
        source.employee_id,
        period.year,
        period.month,
      ),
      loanRepayment: calculateLoanRepaymentForEmployee(
        ctx.pageLoans,
        source.employee_id,
      ),
    },
    buildManualInputsFromRow(row, period.totalWorkingDays),
    policy,
  );
}

function resyncStyleCalc(row, employee, period, ctx) {
  const source = toEmployeeSource(employee);
  const policy = resolvePayrollPolicyCompensation(
    source,
    ctx.policyConfig,
    new Date(getPeriodEndDate(period.year, period.month)),
  );
  return calculatePayrollRow(
    source,
    period,
    ctx.resyncTaxConfigs,
    {
      absenceCount: countAbsencesForStaff(
        ctx.tenantAttendance,
        source.staff_id,
        period.year,
        period.month,
      ),
      overtimeAmount: sumOvertimeForEmployee(
        ctx.tenantOvertime,
        source.employee_id,
        period.year,
        period.month,
      ),
      loanRepayment: calculateLoanRepaymentForEmployee(
        ctx.allLoans,
        source.employee_id,
      ),
    },
    buildManualInputsFromRow(row, period.totalWorkingDays),
    policy,
  );
}

function sumRows(rows, pick) {
  return round2(rows.reduce((s, r) => s + pick(r), 0));
}

async function loadTenantTaxConfigs(admin, tenantId) {
  const [{ data: ssnitRows }, { data: casualRows }, { data: payeRows }] =
    await Promise.all([
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
  return {
    ssnitRows: mapSsnitConfigRows(ssnitRows ?? []),
    casualRows: mapCasualTaxConfigRows(casualRows ?? []),
    payeBands: mapPayrollPayeBandRows(payeRows ?? []),
  };
}

async function main() {
  const { envFile, allowProduction } = parseArgs();
  loadEnvForce(envFile);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !key) throw new Error("Missing Supabase env");
  const ref = url.match(/https:\/\/([^.]+)\./)?.[1] ?? "";
  if (ref === STAGING_REF) throw new Error("This probe is for production only");
  if (ref === PRODUCTION_REF && !allowProduction) {
    throw new Error("Pass --allow-production for production ref");
  }

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const period = resolveSelectedPeriod(2026, 9);
  const periodStart = getPeriodStartDate(period.year, period.month);
  const periodEnd = getPeriodEndDate(period.year, period.month);
  const { start: attendanceStart, end: attendanceEnd } = getAttendanceMonthBounds(
    period.year,
    period.month,
  );

  const { data: buRows } = await admin
    .from("business_units")
    .select("id, name, is_primary")
    .eq("tenant_id", DAVORS)
    .order("name");
  const facilitiesBu =
    (buRows ?? []).find((b) =>
      String(b.name ?? "")
        .trim()
        .toLowerCase()
        .includes("facilities"),
    ) ?? null;
  if (!facilitiesBu) {
    console.log("Business units:", buRows);
    throw new Error(`Could not find BU matching ${FACILITIES_NAME}`);
  }
  console.log("Davors Facilities BU:", facilitiesBu.id, facilitiesBu.name);

  const [
    { data: processingRows },
    { data: employees },
    { data: salaryRates },
    { data: allowanceTypes },
    { data: compensationPolicies },
    statutoryBundle,
    resyncTaxConfigs,
    { data: tenantAttendance },
    { data: tenantOvertime },
    { data: allLoans },
    { data: pageLoans },
    { data: resyncEvent },
  ] = await Promise.all([
    admin
      .from("payroll_processing")
      .select("*")
      .eq("tenant_id", DAVORS)
      .eq("payroll_month", PAYROLL_MONTH)
      .order("employee_id"),
    admin
      .from("employees")
      .select(
        "employee_id, staff_id, full_name, employment_type, employment_status, date_hired, appointment_end_date, position, shift, basic_salary, housing_allowance, transport_allowance, other_allowances, welfare_deduction_rate, department, contract_project, business_unit_id",
      )
      .eq("tenant_id", DAVORS),
    admin
      .from("salary_rate_config")
      .select("*")
      .eq("tenant_id", DAVORS)
      .order("effective_date", { ascending: false }),
    admin
      .from("allowance_types")
      .select("id, code, name, is_active, sort_order")
      .eq("tenant_id", DAVORS)
      .order("sort_order", { ascending: true }),
    admin.from("compensation_policy").select("*").eq("tenant_id", DAVORS),
    fetchStatutoryPayrollTaxConfigs(admin),
    loadTenantTaxConfigs(admin, DAVORS),
    admin
      .from("attendance_register")
      .select("staff_id, date, attendance_status, updated_at, created_at")
      .eq("tenant_id", DAVORS)
      .gte("date", periodStart)
      .lte("date", periodEnd),
    admin
      .from("overtime_register")
      .select("employee_id, date, overtime_amount, updated_at, created_at")
      .eq("tenant_id", DAVORS)
      .gte("date", periodStart)
      .lte("date", periodEnd),
    admin.from("loan_register").select("*").eq("tenant_id", DAVORS),
    admin
      .from("loan_register")
      .select("*")
      .eq("tenant_id", DAVORS)
      .or("outstanding_balance.gt.0.01,outstanding_balance.is.null"),
    admin
      .from("system_event_log")
      .select("id, event_name, created_at, metadata, message")
      .eq("event_name", "payroll_processing_full_resync")
      .order("created_at", { ascending: false })
      .limit(5),
  ]);

  const buNameById = new Map(
    (buRows ?? []).map((b) => [String(b.id), String(b.name ?? "")]),
  );
  const employeeById = new Map((employees ?? []).map((e) => [e.employee_id, e]));

  console.log("\n=== 1) All stored Sep 2026 payroll_processing rows ===");
  console.log(`Count: ${(processingRows ?? []).length}`);
  let storedGross = 0;
  let storedDed = 0;
  let storedNet = 0;
  for (const row of processingRows ?? []) {
    const emp = employeeById.get(row.employee_id);
    const empBu = emp?.business_unit_id ?? null;
    const buLabel = empBu ? buNameById.get(String(empBu)) ?? empBu : "(null / workspace default)";
    const inFacilities =
      empBu && String(empBu) === String(facilitiesBu.id);
    storedGross += round2(Number(row.gross_pay) || 0);
    storedDed += round2(Number(row.total_deductions) || 0);
    storedNet += round2(Number(row.net_pay) || 0);
    console.log({
      staff_id: emp?.staff_id ?? "?",
      processing_business_unit_id: row.business_unit_id ?? null,
      employee_business_unit_id: empBu,
      bu_name: buLabel,
      in_davors_facilities_view: inFacilities,
      gross: round2(row.gross_pay),
      total_deductions: round2(row.total_deductions),
      net: round2(row.net_pay),
      paye: round2(row.paye_tax),
      welfare: round2(row.welfare_deduction),
    });
  }
  console.log("Stored totals (all rows):", {
    gross: round2(storedGross),
    total_deductions: round2(storedDed),
    net: round2(storedNet),
  });

  const excluded = (processingRows ?? []).filter((row) => {
    const emp = employeeById.get(row.employee_id);
    return !emp || String(emp.business_unit_id ?? "") !== String(facilitiesBu.id);
  });
  console.log("\nExcluded from Davors Facilities BU filter:", excluded.length);
  for (const row of excluded) {
    const emp = employeeById.get(row.employee_id);
    console.log({
      staff_id: emp?.staff_id,
      full_name: emp?.full_name,
      employee_business_unit_id: emp?.business_unit_id,
      bu_name: emp?.business_unit_id
        ? buNameById.get(String(emp.business_unit_id))
        : "(null)",
      reason:
        !emp
          ? "employee missing"
          : String(emp.business_unit_id ?? "") !== String(facilitiesBu.id)
            ? "employees.business_unit_id !== Davors Facilities"
            : "unknown",
      gross: round2(row.gross_pay),
      total_deductions: round2(row.total_deductions),
      net: round2(row.net_pay),
    });
  }

  const facilitiesEmployees = (employees ?? []).filter(
    (e) => String(e.business_unit_id ?? "") === String(facilitiesBu.id),
  );
  const facilitiesPeriodEmployees = filterEmployeesForPayrollPeriod(
    facilitiesEmployees,
    period.year,
    period.month,
  );
  const facilitiesIds = new Set(
    facilitiesPeriodEmployees.map((e) => e.employee_id),
  );

  const { data: pageAttendanceWide } = await admin
    .from("attendance_register")
    .select("staff_id, date, attendance_status")
    .gte("date", attendanceStart)
    .lte("date", attendanceEnd);

  const { data: pageOvertimeWide } = await admin
    .from("overtime_register")
    .select("employee_id, date, overtime_amount")
    .gte("date", attendanceStart)
    .lte("date", attendanceEnd);

  const taxConfigs =
    statutoryBundle.error || statutoryBundle.taxConfigs.payeBands.length === 0
      ? (console.log(
          "Statutory loader empty/error — using tenant tax configs for page calc:",
          statutoryBundle.error,
        ),
        resyncTaxConfigs)
      : statutoryBundle.taxConfigs;

  const ctx = {
    policyConfig: {
      salaryRates: salaryRates ?? [],
      allowanceTypes: allowanceTypes ?? [],
      compensationPolicies: compensationPolicies ?? [],
    },
    taxConfigs,
    resyncTaxConfigs,
    periodAttendance: pageAttendanceWide ?? [],
    periodOvertime: pageOvertimeWide ?? [],
    tenantAttendance: tenantAttendance ?? [],
    tenantOvertime: tenantOvertime ?? [],
    pageLoans: pageLoans ?? [],
    allLoans: allLoans ?? [],
  };

  console.log("\n=== 2) Davors Facilities: stored vs page live calc ===");
  const facRows = (processingRows ?? []).filter((r) =>
    facilitiesIds.has(r.employee_id),
  );
  console.log(`Rows in Facilities BU view: ${facRows.length}`);

  const diffs = [];
  let liveGross = 0;
  let liveDed = 0;
  let liveNet = 0;
  let liveEmployerSsnit = 0;

  for (const row of facRows) {
    const emp = employeeById.get(row.employee_id);
    const live = pageLiveCalc(row, emp, period, ctx);
    liveGross += round2(live.gross_pay);
    liveDed += round2(live.total_deductions);
    liveNet += round2(live.net_pay);
    liveEmployerSsnit += round2(live.employer_ssnit) + round2(live.tier2);

    const rowDiffs = [];
    for (const field of NUMERIC_FIELDS) {
      const stored = round2(Number(row[field]) || 0);
      const fresh = round2(Number(live[field]) || 0);
      if (!almostEqual(stored, fresh)) {
        rowDiffs.push({ field, stored, live: fresh, delta: round2(fresh - stored) });
      }
    }
    if (rowDiffs.length) {
      diffs.push({ staff_id: emp?.staff_id, rowDiffs });
    }
  }

  console.log("Page-style live totals (Facilities 20):", {
    gross: round2(liveGross),
    total_deductions: round2(liveDed),
    net: round2(liveNet),
    employer_ssnit_cost: round2(liveEmployerSsnit),
  });
  console.log("Stored totals (Facilities subset):", {
    gross: sumRows(facRows, (r) => Number(r.gross_pay)),
    total_deductions: sumRows(facRows, (r) => Number(r.total_deductions)),
    net: sumRows(facRows, (r) => Number(r.net_pay)),
  });
  console.log(
    "Live minus stored deductions (Facilities):",
    round2(liveDed - sumRows(facRows, (r) => Number(r.total_deductions))),
  );

  for (const d of diffs) {
    console.log("\nDiff", d.staff_id);
    for (const f of d.rowDiffs) {
      console.log(`  ${f.field}: stored=${f.stored} live=${f.live} Δ=${f.delta}`);
    }
  }

  console.log("\n--- Resync-script input parity (tenant tax + all loans) ---");
  for (const row of facRows) {
    const emp = employeeById.get(row.employee_id);
    const resyncLive = resyncStyleCalc(row, emp, period, ctx);
    const page = pageLiveCalc(row, emp, period, ctx);
    const dedDelta = round2(
      Number(page.total_deductions) - Number(resyncLive.total_deductions),
    );
    if (Math.abs(dedDelta) > 0.009) {
      console.log(emp?.staff_id, "page vs resync-style ded Δ", dedDelta, {
        page_loan: round2(page.loan_repayment),
        resync_loan: round2(resyncLive.loan_repayment),
        page_absence: round2(page.absence_deduction),
        resync_absence: round2(resyncLive.absence_deduction),
        page_ot: round2(page.overtime_amount),
        resync_ot: round2(resyncLive.overtime_amount),
        page_welfare: round2(page.welfare_deduction),
        resync_welfare: round2(resyncLive.welfare_deduction),
      });
    }
  }

  const resyncTs =
    (resyncEvent ?? []).find((e) => {
      const meta = e.metadata ?? {};
      return (
        String(meta.payroll_month ?? "").slice(0, 10) === PAYROLL_MONTH ||
        String(meta.tenant_id ?? "") === DAVORS
      );
    })?.created_at ?? (resyncEvent ?? [])[0]?.created_at;

  console.log("\n=== 3) Changes after full resync ===");
  console.log("Latest payroll_processing_full_resync:", resyncEvent ?? []);
  console.log("Resync timestamp used:", resyncTs);

  function afterResync(ts) {
    if (!ts) return null;
    return (value) => value && new Date(value).getTime() > new Date(ts).getTime();
  }
  const isAfter = afterResync(resyncTs);

  if (resyncTs) {
    const touchedEmployees = (employees ?? []).filter(
      (e) =>
        facilitiesIds.has(e.employee_id) &&
        (isAfter(e.updated_at) || isAfter(e.created_at)),
    );
    console.log("Facilities employees updated after resync:", touchedEmployees.length);
    for (const e of touchedEmployees.slice(0, 10)) {
      console.log(e.staff_id, e.updated_at);
    }

    const staffInFac = new Set(facilitiesPeriodEmployees.map((e) => e.staff_id));
    const attTouches = (tenantAttendance ?? []).filter(
      (a) => staffInFac.has(a.staff_id) && (isAfter(a.updated_at) || isAfter(a.created_at)),
    );
    console.log("Sep attendance rows touched after resync (Facilities staff):", attTouches.length);
    for (const a of attTouches.slice(0, 15)) {
      console.log(a.staff_id, a.date, a.attendance_status, a.updated_at);
    }

    const otTouches = (tenantOvertime ?? []).filter(
      (o) =>
        facilitiesIds.has(o.employee_id) &&
        (isAfter(o.updated_at) || isAfter(o.created_at)),
    );
    console.log("Sep overtime rows touched after resync (Facilities):", otTouches.length);

    const loanEmpIds = new Set(facilitiesPeriodEmployees.map((e) => e.employee_id));
    const loanTouches = (allLoans ?? []).filter(
      (l) =>
        loanEmpIds.has(l.employee_id) &&
        (isAfter(l.updated_at) || isAfter(l.created_at)),
    );
    console.log("Loans touched after resync (Facilities employees):", loanTouches.length);
    for (const l of loanTouches) {
      console.log(l.employee_id, l.updated_at, l.outstanding_balance);
    }

    const procTouches = facRows.filter((r) => isAfter(r.updated_at));
    console.log("Facilities processing rows updated after resync:", procTouches.length);
  } else {
    console.log("(No resync event found — skip post-resync comparison)");
  }

  console.log("\n=== 4) Lock / multi-BU (code behavior summary) ===");
  console.log(
    "Lock RPC scopes month_end_close by (tenant_id, business_unit_id, month).",
  );
  console.log(
    "Client sends only employees in active BU + recalculated rows for those employee_ids.",
  );
  console.log(
    "Employees in other BUs stay in payroll_processing until that BU is locked separately.",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
