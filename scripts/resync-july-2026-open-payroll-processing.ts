/**
 * One-shot: refresh OPEN July 2026 payroll_processing rows against current
 * Salary Settings (same formula as prepareRowsToLock).
 *
 * Preserves each row's manual fields via buildManualInputsFromRow
 * (days_to_pay, bonuses, arrears, net_only_adjustment, salary_advance,
 * welfare_deduction, other_deductions). Refreshes processing allowance lines.
 *
 * NEVER touches payroll_history or locked months.
 *
 * Usage:
 *   npx tsx scripts/resync-july-2026-open-payroll-processing.ts --env-file .env.staging.local --dry-run
 *   npx tsx scripts/resync-july-2026-open-payroll-processing.ts --env-file .env.staging.local --apply
 *   npx tsx scripts/resync-july-2026-open-payroll-processing.ts --env-file .env.local.backup --dry-run --allow-production
 *   npx tsx scripts/resync-july-2026-open-payroll-processing.ts --env-file .env.local.backup --apply --allow-production
 *
 * Staging with no July rows: script seeds one temporary Open July row, runs
 * dry-run/apply verification, then deletes the seed (unless --keep-seed).
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
  PAYROLL_STATUS_OPEN,
  PAYROLL_STATUS_PARTIALLY_LOCKED,
  getPeriodEndDate,
  getPeriodStartDate,
  resolveSelectedPeriod,
} from "../app/dashboard/hr-payroll/payroll-period-utils";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const DAVORS = "00000001-0000-4000-8000-000000000001";
const DEFAULT_PAYROLL_MONTH = "2026-07-01";
const OPEN_STATUSES = new Set(["open", "processing"]);

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

function almostEqual(a, b, eps = 0.02) {
  return Math.abs(Number(a) - Number(b)) <= eps;
}

function parseArgs(argv) {
  const envIdx = argv.indexOf("--env-file");
  const monthIdx = argv.indexOf("--payroll-month");
  return {
    envFile:
      envIdx >= 0 && argv[envIdx + 1] ? argv[envIdx + 1] : ".env.staging.local",
    apply: argv.includes("--apply"),
    allowProduction: argv.includes("--allow-production"),
    keepSeed: argv.includes("--keep-seed"),
    payrollMonth:
      monthIdx >= 0 && argv[monthIdx + 1]
        ? String(argv[monthIdx + 1]).slice(0, 10)
        : DEFAULT_PAYROLL_MONTH,
    tenantId:
      argv.includes("--tenant") && argv[argv.indexOf("--tenant") + 1]
        ? argv[argv.indexOf("--tenant") + 1]
        : DAVORS,
  };
}

function isOpenProcessingStatus(status) {
  return OPEN_STATUSES.has(String(status ?? "").trim().toLowerCase());
}

/** Service-role wrapper — delegates to shared upsert sync. */
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

/** Only update columns that exist on the fetched row (staging schema lag). */
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
  };
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
  ] = await Promise.all([
    admin
      .from("employees")
      .select(
        "employee_id, staff_id, full_name, employment_type, employment_status, date_hired, appointment_end_date, position, shift, basic_salary, housing_allowance, transport_allowance, other_allowances, department, contract_project",
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
  ]);

  assert(!empErr, empErr?.message ?? "employees fetch failed");
  assert(!attErr, attErr?.message ?? "attendance fetch failed");
  assert(!otErr, otErr?.message ?? "overtime fetch failed");
  assert(!loanErr, loanErr?.message ?? "loans fetch failed");

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
  return { calculated, payload, policy };
}

async function fetchOpenJulyRows(admin, tenantId, payrollMonth) {
  const { data, error } = await admin
    .from("payroll_processing")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("payroll_month", payrollMonth);
  assert(!error, error?.message ?? "payroll_processing fetch failed");
  return (data ?? []).filter((row) => isOpenProcessingStatus(row.status));
}

async function seedStagingJulyRow(
  admin,
  tenantId,
  employees,
  policyConfig,
  payrollMonth,
) {
  // Prefer an employee whose Position×Type×Shift resolves a non-zero basic,
  // so the resync delta is meaningful on staging.
  let emp =
    employees.find((e) => {
      if (e.employment_status !== "Active") return false;
      const policy = resolvePayrollPolicyCompensation(
        toEmployeeSource(e),
        policyConfig,
        new Date("2026-07-31"),
      );
      return (policy?.basic_salary ?? 0) > 0;
    }) ?? null;
  if (!emp) {
    emp =
      employees.find((e) => e.employment_status === "Active") ?? employees[0];
  }
  assert(emp, "No employee available to seed");

  const resolved = resolvePayrollPolicyCompensation(
    toEmployeeSource(emp),
    policyConfig,
    new Date("2026-07-31"),
  );
  console.log(
    `Seed employee ${emp.staff_id} live policy basic=${resolved?.basic_salary ?? 0} gross≈${(resolved?.basic_salary ?? 0) + (resolved?.housing_allowance ?? 0) + (resolved?.transport_allowance ?? 0) + (resolved?.other_allowances ?? 0)}`,
  );

  const { data: template } = await admin
    .from("payroll_processing")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("employee_id", emp.employee_id)
    .order("payroll_month", { ascending: false })
    .limit(1)
    .maybeSingle();

  const base = template
    ? Object.fromEntries(
        Object.entries(template).filter(
          ([k]) => !["id", "created_at", "updated_at"].includes(k),
        ),
      )
    : {
        status: PAYROLL_STATUS_OPEN,
        employee_id: emp.employee_id,
        basic_salary: 578.95,
        housing_allowance: 0,
        transport_allowance: 0,
        other_allowances: 0,
        daily_rate: 0,
        days_to_pay: 27,
        absence_deduction: 0,
        overtime_amount: 0,
        loan_repayment: 0,
        bonuses: 0,
        arrears: 0,
        salary_advance: 0,
        welfare_deduction: 0,
        other_deductions: 0,
        gross_pay: 578.95,
        employee_ssnit: 0,
        employer_ssnit: 0,
        tier2: 0,
        paye_tax: 0,
        total_deductions: 28.95,
        net_pay: 550,
        department: emp.department,
        project_contract: emp.contract_project,
      };

  const seedPayload = {
    ...base,
    tenant_id: tenantId,
    payroll_month: payrollMonth,
    employee_id: emp.employee_id,
    status: PAYROLL_STATUS_OPEN,
    // Intentionally stale vs current policy so resync has a visible delta.
    basic_salary: 578.95,
    other_allowances: 0,
    gross_pay: 578.95,
    net_pay: 550,
  };

  const { data: seeded, error } = await admin
    .from("payroll_processing")
    .insert(seedPayload)
    .select("*")
    .single();
  assert(!error, error?.message ?? "Failed to seed July row");
  console.log(
    `Seeded temporary July Open row id=${seeded.id} employee=${emp.staff_id} (${emp.employee_id}) stale net=${seeded.net_pay}`,
  );
  return seeded;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // If --apply is set, dry-run preview still prints first unless only --apply
  // without wanting preview — we always print before/after; apply only writes.
  const willApply = args.apply;
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
    `Mode: ${willApply ? "APPLY" : "DRY-RUN"} | env=${args.envFile} | ` +
      `target=${isProduction ? "PRODUCTION" : "STAGING"} | tenant=${args.tenantId} | month=${PAYROLL_MONTH}`,
  );

  const ctx = await loadContext(admin, args.tenantId, period, PAYROLL_MONTH);
  const employeeById = new Map(ctx.employees.map((e) => [e.employee_id, e]));

  const lockStatus = ctx.closeRecord?.lock_status ?? null;
  const isFullyLocked = lockStatus === PAYROLL_STATUS_LOCKED;
  const isPartiallyLocked = lockStatus === PAYROLL_STATUS_PARTIALLY_LOCKED;

  if (isFullyLocked) {
    throw new Error(
      `Refuse: ${PAYROLL_MONTH} month_end_close.lock_status=${lockStatus}. ` +
        `Fully locked periods must not be resynced.`,
    );
  }

  if (isPartiallyLocked && isProduction) {
    throw new Error(
      `Refuse: ${PAYROLL_MONTH} is Partially Locked on production. ` +
        `Reopen the period in UI before resyncing processing rows.`,
    );
  }

  if (isPartiallyLocked && isStaging) {
    console.warn(
      `WARNING: ${PAYROLL_MONTH} is Partially Locked on staging (notes=${JSON.stringify(ctx.closeRecord?.notes ?? null)}). ` +
        `Will only run a temporary seed → resync → delete test; payroll_history is not touched.`,
    );
  } else {
    console.log(
      `month_end_close.lock_status=${lockStatus ?? "(none)"} — OK to touch Open processing rows`,
    );
  }

  let seededId = null;
  let openRows = await fetchOpenJulyRows(admin, args.tenantId, PAYROLL_MONTH);

  // On partially-locked staging, ignore any stray processing rows and force seed-only test.
  if (isPartiallyLocked && isStaging) {
    openRows = [];
  }

  if (openRows.length === 0 && isStaging) {
    console.log(
      `No Open ${PAYROLL_MONTH} rows on staging — seeding temporary test row…`,
    );
    const seeded = await seedStagingJulyRow(
      admin,
      args.tenantId,
      ctx.employees,
      ctx.policyConfig,
      PAYROLL_MONTH,
    );
    seededId = seeded.id;
    openRows = [seeded];
  }

  assert(
    openRows.length > 0,
    "No Open/Processing July payroll_processing rows to resync",
  );
  console.log(`Open July rows to consider: ${openRows.length}`);

  const plans = [];
  for (const row of openRows) {
    const employee = employeeById.get(row.employee_id);
    if (!employee) {
      console.warn(
        `SKIP ${row.employee_id}: no employees row (would lock as stale too)`,
      );
      continue;
    }
    const { calculated, payload, policy } = recalculateRow(
      row,
      employee,
      period,
      ctx,
    );
    const update = payloadForExistingRow(row, payload);
    plans.push({
      row,
      employee,
      calculated,
      payload,
      update,
      policy,
      manuals: buildManualInputsFromRow(row, period.totalWorkingDays),
    });
  }

  console.log("\n--- Before → After (basic / gross / abs_ded / net) ---");
  console.log(
    "staff".padEnd(10) +
      "basic".padStart(10) +
      "→".padStart(3) +
      "basic".padStart(10) +
      "gross".padStart(10) +
      "→".padStart(3) +
      "gross".padStart(10) +
      "abs".padStart(8) +
      "→".padStart(3) +
      "abs".padStart(8) +
      "net".padStart(10) +
      "→".padStart(3) +
      "net".padStart(10) +
      "  days",
  );

  let changed = 0;
  for (const plan of plans) {
    const before = plan.row;
    const after = plan.calculated;
    const delta =
      !almostEqual(before.basic_salary, after.basic_salary) ||
      !almostEqual(before.gross_pay, after.gross_pay) ||
      !almostEqual(before.net_pay, after.net_pay) ||
      !almostEqual(before.absence_deduction, after.absence_deduction);
    if (delta) changed += 1;
    console.log(
      String(plan.employee.staff_id).padEnd(10) +
        Number(before.basic_salary).toFixed(2).padStart(10) +
        " →" +
        Number(after.basic_salary).toFixed(2).padStart(10) +
        Number(before.gross_pay).toFixed(2).padStart(10) +
        " →" +
        Number(after.gross_pay).toFixed(2).padStart(10) +
        Number(before.absence_deduction || 0).toFixed(2).padStart(8) +
        " →" +
        Number(after.absence_deduction).toFixed(2).padStart(8) +
        Number(before.net_pay).toFixed(2).padStart(10) +
        " →" +
        Number(after.net_pay).toFixed(2).padStart(10) +
        `  days=${plan.manuals.days_to_pay} (preserved) policyBasic=${plan.policy?.basic_salary ?? "n/a"}`,
    );
  }
  console.log(
    `\nPlans: ${plans.length} | with numeric change: ${changed} | mode=${willApply ? "APPLY" : "DRY-RUN"}`,
  );

  if (!willApply) {
    console.log(
      "\nDry-run only — no writes. Re-run with --apply to persist updates.",
    );
    if (seededId && !args.keepSeed) {
      await admin.from("payroll_processing").delete().eq("id", seededId);
      console.log(`Cleaned up staging seed ${seededId}`);
    }
    return;
  }

  let updated = 0;
  for (const plan of plans) {
    const { error: updErr } = await admin
      .from("payroll_processing")
      .update(plan.update)
      .eq("id", plan.row.id)
      .eq("tenant_id", args.tenantId)
      .eq("payroll_month", PAYROLL_MONTH);

    assert(!updErr, updErr?.message ?? `Update failed for ${plan.row.id}`);

    if (plan.policy?.allowance_lines) {
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
    updated += 1;
  }

  console.log(`\nApplied updates to ${updated} Open July payroll_processing rows.`);

  // Verify a sample from DB
  const { data: afterRows } = await admin
    .from("payroll_processing")
    .select("id, employee_id, basic_salary, gross_pay, net_pay, absence_deduction, days_to_pay")
    .eq("tenant_id", args.tenantId)
    .eq("payroll_month", PAYROLL_MONTH)
    .in(
      "id",
      plans.map((p) => p.row.id),
    );

  for (const plan of plans) {
    const stored = (afterRows ?? []).find((r) => r.id === plan.row.id);
    assert(stored, `Missing row after apply: ${plan.row.id}`);
    assert(
      almostEqual(stored.net_pay, plan.calculated.net_pay),
      `${plan.employee.staff_id} stored net ${stored.net_pay} != expected ${plan.calculated.net_pay}`,
    );
    assert(
      Number(stored.days_to_pay) === Number(plan.manuals.days_to_pay),
      `${plan.employee.staff_id} days_to_pay not preserved`,
    );
  }
  console.log("Post-apply verification: stored nets match recalculated payloads.");

  // Directory loader should now return the refreshed nets for these employees
  const { loadDirectoryNetPayContext } = await import(
    "../app/dashboard/employees/directory-net-pay-utils"
  );
  const sampleEmployees = plans.map((p) => {
    const e = p.employee;
    return { ...e };
  });
  const dirCtx = await loadDirectoryNetPayContext(
    admin,
    args.tenantId,
    sampleEmployees,
    // Match Directory period to the month we just resynced (not "today").
    new Date(period.year, period.month - 1, 15),
  );
  for (const plan of plans) {
    const dirNet = dirCtx.netPayByEmployeeId[plan.employee.employee_id];
    assert(
      almostEqual(dirNet, plan.calculated.net_pay),
      `Directory net ${dirNet} != refreshed ${plan.calculated.net_pay} for ${plan.employee.staff_id}`,
    );
  }
  console.log(
    `Directory Current Net Pay path now matches refreshed stored nets ` +
      `(fromProcessingRow=${dirCtx.stats.fromProcessingRow}).`,
  );

  if (seededId && !args.keepSeed) {
    await admin.from("payroll_processing").delete().eq("id", seededId);
    console.log(`Cleaned up staging seed ${seededId}`);
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
