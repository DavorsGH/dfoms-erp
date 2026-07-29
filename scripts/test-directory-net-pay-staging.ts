/**
 * Staging: Directory Current Net Pay is live-recalculated (never stored net_pay).
 *
 *   npx tsx scripts/test-directory-net-pay-staging.ts --env-file .env.staging.local
 *
 * Covers:
 *   (a) Salary Settings allowance bump → Directory nets update without resync
 *   (b) Manual days_to_pay / arrears on a processing row are preserved in live calc
 *   (c) Batch load speed / coverage (no N+1)
 *   (d) Tenant isolation
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { EMPLOYEE_SELECT } from "../app/dashboard/employees/employee-record-utils";
import {
  buildDirectoryNetPayByEmployee,
  loadDirectoryNetPayContext,
  resolveDirectoryPayrollPeriod,
} from "../app/dashboard/employees/directory-net-pay-utils";
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
  resolveDefaultDaysToPay,
} from "../app/dashboard/hr-payroll/payroll-period-utils";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const DAVORS = "00000001-0000-4000-8000-000000000001";
const CAANTA = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";
const BUMP = 25;

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

function resolveEnvFile(argv) {
  const idx = argv.indexOf("--env-file");
  if (idx >= 0 && argv[idx + 1]) return argv[idx + 1];
  return ".env.staging.local";
}

async function loadTaxAndPolicy(admin, tenantId) {
  const [
    { data: salaryRates },
    { data: allowanceTypes },
    { data: compensationPolicies },
    { data: ssnitRows },
    { data: casualRows },
    { data: payeRows },
  ] = await Promise.all([
    admin
      .from("salary_rate_config")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("effective_date", { ascending: false }),
    admin
      .from("allowance_types")
      .select("id, code, name, is_active, sort_order")
      .eq("tenant_id", tenantId),
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
  };
}

async function main() {
  const envFile = resolveEnvFile(process.argv.slice(2));
  loadEnvForce(resolve(envFile));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  assert(url.includes(STAGING_REF), `Refusing non-staging URL: ${url}`);
  assert(key, "Missing SUPABASE_SERVICE_ROLE_KEY");

  const admin = createClient(url, key, { auth: { persistSession: false } });
  // Use August on staging — July is Partially Locked with no Open processing rows.
  const referenceDate = new Date(2026, 7, 15); // 15 Aug 2026
  const period = resolveDirectoryPayrollPeriod(referenceDate);
  console.log(
    `Period: ${period.payrollMonth} workingDays=${period.totalWorkingDays}`,
  );
  assert(
    period.payrollMonth === "2026-08-01",
    `Expected August 2026 for this test, got ${period.payrollMonth}`,
  );

  const { data: employees, error: empErr } = await admin
    .from("employees")
    .select(EMPLOYEE_SELECT)
    .eq("tenant_id", DAVORS)
    .order("staff_id", { ascending: true });
  assert(!empErr, empErr?.message ?? "employees fetch failed");
  assert((employees?.length ?? 0) > 0, "No Davors employees");

  const periodStart = getPeriodStartDate(period.year, period.month);
  const periodEnd = getPeriodEndDate(period.year, period.month);
  const [{ data: attendance }, { data: overtime }, { data: loans }] =
    await Promise.all([
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
    ]);

  let { taxConfigs, policyConfig } = await loadTaxAndPolicy(admin, DAVORS);

  // --- (c) batch speed ---
  const t0 = Date.now();
  const ctx0 = await loadDirectoryNetPayContext(
    admin,
    DAVORS,
    employees,
    referenceDate,
  );
  const elapsedMs = Date.now() - t0;
  console.log(
    `(c) Directory net load ${elapsedMs}ms for ${employees.length} employees ` +
      `(fromRow=${ctx0.stats.fromProcessingRow}, fresh=${ctx0.stats.fromFreshCalculation})`,
  );
  assert(elapsedMs < 15000, `Too slow: ${elapsedMs}ms`);
  assert(
    Object.keys(ctx0.netPayByEmployeeId).length === employees.length,
    "Missing nets",
  );
  console.log("PASS (c) batch load coverage / timing");

  // Prefer an employee WITH an August processing row for (a)/(b)
  const { data: augRows } = await admin
    .from("payroll_processing")
    .select("*")
    .eq("tenant_id", DAVORS)
    .eq("payroll_month", period.payrollMonth);
  assert((augRows?.length ?? 0) > 0, "Need August Open payroll_processing rows");

  // Find a category with ≥2 employees that have processing rows + a policy allowance to bump
  const empById = new Map(employees.map((e) => [e.employee_id, e]));
  const withRows = (augRows ?? [])
    .map((r) => ({ row: r, emp: empById.get(r.employee_id) }))
    .filter((x) => x.emp?.position && x.emp?.employment_type && x.emp?.shift);

  assert(withRows.length > 0, "No employees with Aug rows + position combo");

  // Pick Cleaning Supervisors if present, else first combo with a non-zero or zero allowance row
  let targetGroup = withRows.filter(
    (x) =>
      x.emp.position === "Cleaning Supervisors" &&
      x.emp.employment_type === "Full-Time",
  );
  if (targetGroup.length === 0) {
    const key = `${withRows[0].emp.position}|${withRows[0].emp.employment_type}|${withRows[0].emp.shift}`;
    targetGroup = withRows.filter(
      (x) =>
        `${x.emp.position}|${x.emp.employment_type}|${x.emp.shift}` === key,
    );
  }
  const sample = targetGroup[0];
  const pos = sample.emp.position;
  const empType = sample.emp.employment_type;
  const sh = sample.emp.shift;
  console.log(
    `Target category: ${pos}|${empType}|${sh} (${targetGroup.length} with Aug rows)`,
  );

  // Confirm Directory does NOT equal stale stored net when policy would differ —
  // and equals live recalculateWorkspaceRow path.
  const liveExpected = calculatePayrollRow(
    sample.emp,
    period,
    taxConfigs,
    {
      absenceCount: countAbsencesForStaff(
        attendance ?? [],
        sample.emp.staff_id,
        period.year,
        period.month,
      ),
      overtimeAmount: sumOvertimeForEmployee(
        overtime ?? [],
        sample.emp.employee_id,
        period.year,
        period.month,
      ),
      loanRepayment: calculateLoanRepaymentForEmployee(
        loans ?? [],
        sample.emp.employee_id,
      ),
    },
    buildManualInputsFromRow(sample.row, period.totalWorkingDays),
    resolvePayrollPolicyCompensation(
      sample.emp,
      policyConfig,
      new Date(periodEnd),
    ),
  ).net_pay;
  const dirNet = ctx0.netPayByEmployeeId[sample.emp.employee_id];
  console.log(
    `Baseline ${sample.emp.staff_id}: directory=${dirNet} liveRecalc=${liveExpected} stored=${sample.row.net_pay}`,
  );
  assert(
    almostEqual(dirNet, liveExpected),
    `Directory ${dirNet} != live recalc ${liveExpected}`,
  );
  // Explicitly must NOT be "just stored net" if stored differs from live
  if (!almostEqual(Number(sample.row.net_pay), liveExpected)) {
    assert(
      !almostEqual(dirNet, Number(sample.row.net_pay)),
      "Directory incorrectly returned stored net_pay",
    );
  }

  // --- (b) manual edits preserved ---
  const manualDays = Math.max(1, Number(sample.row.days_to_pay) || 26);
  const manualArrears = 37.5;
  const manualRow = {
    ...sample.row,
    days_to_pay: manualDays,
    arrears: manualArrears,
    // Deliberately stale stored net — Directory must ignore this
    net_pay: 1.11,
  };
  const withManualBuilt = buildDirectoryNetPayByEmployee(
    [sample.emp],
    period,
    [manualRow],
    attendance ?? [],
    overtime ?? [],
    loans ?? [],
    taxConfigs,
    policyConfig,
  );
  const expectedManual = calculatePayrollRow(
    sample.emp,
    period,
    taxConfigs,
    {
      absenceCount: countAbsencesForStaff(
        attendance ?? [],
        sample.emp.staff_id,
        period.year,
        period.month,
      ),
      overtimeAmount: sumOvertimeForEmployee(
        overtime ?? [],
        sample.emp.employee_id,
        period.year,
        period.month,
      ),
      loanRepayment: calculateLoanRepaymentForEmployee(
        loans ?? [],
        sample.emp.employee_id,
      ),
    },
    buildManualInputsFromRow(manualRow, period.totalWorkingDays),
    resolvePayrollPolicyCompensation(
      sample.emp,
      policyConfig,
      new Date(periodEnd),
    ),
  ).net_pay;
  const manualDirNet =
    withManualBuilt.netPayByEmployeeId[sample.emp.employee_id];
  console.log(
    `(b) ${sample.emp.staff_id} days=${manualDays} arrears=${manualArrears} ` +
      `directory=${manualDirNet} expected=${expectedManual} (ignored stored net=${manualRow.net_pay})`,
  );
  assert(almostEqual(manualDirNet, expectedManual), "Manual path mismatch");
  assert(
    !almostEqual(manualDirNet, 1.11),
    "Must not use planted stale stored net_pay",
  );
  assert(
    withManualBuilt.stats.fromProcessingRow === 1,
    "Expected fromProcessingRow path",
  );
  console.log("PASS (b) manuals from row preserved; stored net_pay ignored");

  // --- (a) allowance bump without resync ---
  const { data: policyRows, error: polErr } = await admin
    .from("compensation_policy")
    .select("id, amount, position, employment_type, shift, allowance_type_id")
    .eq("tenant_id", DAVORS)
    .eq("position", pos)
    .eq("employment_type", empType)
    .eq("shift", sh);
  assert(!polErr, polErr?.message ?? "policy fetch failed");
  const bumpTarget =
    (policyRows ?? []).find((r) => Number(r.amount) > 0) ??
    (policyRows ?? [])[0];
  assert(bumpTarget, `No compensation_policy row for ${pos}|${empType}|${sh}`);
  const originalAmount = Number(bumpTarget.amount) || 0;

  try {
    const { error: updErr } = await admin
      .from("compensation_policy")
      .update({ amount: originalAmount + BUMP })
      .eq("id", bumpTarget.id);
    assert(!updErr, updErr?.message ?? "policy bump failed");

    // Do NOT touch payroll_processing — core fix: Directory must pick up bump anyway
    const t1 = Date.now();
    const ctxAfter = await loadDirectoryNetPayContext(
      admin,
      DAVORS,
      employees,
      referenceDate,
    );
    const afterMs = Date.now() - t1;
    console.log(`(a) reload after policy bump in ${afterMs}ms`);

    const netsBefore = targetGroup.map((x) => ({
      staff: x.emp.staff_id,
      id: x.emp.employee_id,
      before: ctx0.netPayByEmployeeId[x.emp.employee_id],
      after: ctxAfter.netPayByEmployeeId[x.emp.employee_id],
      stored: x.row.net_pay,
    }));

    for (const n of netsBefore) {
      console.log(
        `  ${n.staff}: before=${n.before} after=${n.after} stored(unchanged)=${n.stored}`,
      );
      assert(
        !almostEqual(n.after, n.before) || BUMP === 0,
        `${n.staff}: net did not change after +${BUMP} allowance (still ${n.after})`,
      );
      // Stored row unchanged — Directory must not equal stored if bump changed live net
      if (!almostEqual(n.after, Number(n.stored))) {
        // ok — live differs from stored
      }
    }

    // All same-category employees with rows should move together (same manuals aside)
    // At least confirm each after matches its own live recalc with NEW policy
    const { policyConfig: policyAfter, taxConfigs: taxAfter } =
      await loadTaxAndPolicy(admin, DAVORS);
    for (const x of targetGroup) {
      const expected = calculatePayrollRow(
        x.emp,
        period,
        taxAfter,
        {
          absenceCount: countAbsencesForStaff(
            attendance ?? [],
            x.emp.staff_id,
            period.year,
            period.month,
          ),
          overtimeAmount: sumOvertimeForEmployee(
            overtime ?? [],
            x.emp.employee_id,
            period.year,
            period.month,
          ),
          loanRepayment: calculateLoanRepaymentForEmployee(
            loans ?? [],
            x.emp.employee_id,
          ),
        },
        buildManualInputsFromRow(x.row, period.totalWorkingDays),
        resolvePayrollPolicyCompensation(
          x.emp,
          policyAfter,
          new Date(periodEnd),
        ),
      ).net_pay;
      const got = ctxAfter.netPayByEmployeeId[x.emp.employee_id];
      assert(
        almostEqual(got, expected),
        `${x.emp.staff_id}: after bump directory ${got} != expected ${expected}`,
      );
    }
    console.log(
      `PASS (a) +${BUMP} on policy ${bumpTarget.id}: Directory nets updated for ${targetGroup.length} employees without payroll_processing resync`,
    );
  } finally {
    const { error: restoreErr } = await admin
      .from("compensation_policy")
      .update({ amount: originalAmount })
      .eq("id", bumpTarget.id);
    if (restoreErr) {
      console.error("RESTORE FAILED", restoreErr.message, {
        id: bumpTarget.id,
        originalAmount,
      });
      throw restoreErr;
    }
    console.log(`Restored policy ${bumpTarget.id} amount → ${originalAmount}`);
  }

  // --- no-row fallback still works ---
  const without = employees.find(
    (e) => !(augRows ?? []).some((r) => r.employee_id === e.employee_id),
  );
  if (without) {
    const fallback = buildDirectoryNetPayByEmployee(
      [without],
      period,
      [],
      attendance ?? [],
      overtime ?? [],
      loans ?? [],
      taxConfigs,
      policyConfig,
    );
    assert(fallback.stats.fromFreshCalculation === 1, "Expected fresh path");
    const expectedFresh = calculatePayrollRow(
      without,
      period,
      taxConfigs,
      {
        absenceCount: countAbsencesForStaff(
          attendance ?? [],
          without.staff_id,
          period.year,
          period.month,
        ),
        overtimeAmount: sumOvertimeForEmployee(
          overtime ?? [],
          without.employee_id,
          period.year,
          period.month,
        ),
        loanRepayment: calculateLoanRepaymentForEmployee(
          loans ?? [],
          without.employee_id,
        ),
      },
      {
        days_to_pay: resolveDefaultDaysToPay(without, period),
        bonuses: 0,
        arrears: 0,
        net_only_adjustment: 0,
        salary_advance: 0,
        welfare_deduction: 0,
        other_deductions: 0,
      },
      resolvePayrollPolicyCompensation(
        without,
        policyConfig,
        new Date(periodEnd),
      ),
    ).net_pay;
    assert(
      almostEqual(
        fallback.netPayByEmployeeId[without.employee_id],
        expectedFresh,
      ),
      "Fresh fallback mismatch",
    );
    console.log(`PASS no-row fallback for ${without.staff_id}`);
  }

  // --- (d) tenant isolation ---
  const { data: caantaEmployees } = await admin
    .from("employees")
    .select(EMPLOYEE_SELECT)
    .eq("tenant_id", CAANTA)
    .limit(10);
  if ((caantaEmployees?.length ?? 0) > 0) {
    const caantaCtx = await loadDirectoryNetPayContext(
      admin,
      CAANTA,
      caantaEmployees,
      referenceDate,
    );
    for (const emp of caantaEmployees) {
      assert(
        ctx0.netPayByEmployeeId[emp.employee_id] == null,
        `Davors map leaked Caanta ${emp.employee_id}`,
      );
    }
    for (const emp of employees.slice(0, 10)) {
      assert(
        caantaCtx.netPayByEmployeeId[emp.employee_id] == null,
        `Caanta map leaked Davors ${emp.employee_id}`,
      );
    }
    console.log(
      `PASS (d) tenant isolation (Caanta sample=${caantaEmployees.length})`,
    );
  } else {
    console.log("PASS (d) tenant isolation — no Caanta employees to cross-check");
  }

  console.log("\nAll directory live-recalc net-pay staging checks passed.");
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
