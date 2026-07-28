/**
 * Staging: Employee Directory current-period net pay (read + temporary seed).
 *
 *   npx tsx scripts/test-directory-net-pay-staging.ts
 *   npx tsx scripts/test-directory-net-pay-staging.ts --env-file .env.staging.local
 *
 * Staging may have no July payroll_processing rows; this script seeds one Davors
 * row (and optionally one Caanta row) for parity / isolation checks, then deletes them.
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
const SEEDED_NET = 9876.54;
const SEEDED_CAANTA_NET = 1111.11;

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

function resolveEnvFile(argv) {
  const idx = argv.indexOf("--env-file");
  if (idx >= 0 && argv[idx + 1]) return argv[idx + 1];
  return ".env.staging.local";
}

function almostEqual(a, b, eps = 0.02) {
  return Math.abs(Number(a) - Number(b)) <= eps;
}

async function main() {
  const envFile = resolveEnvFile(process.argv.slice(2));
  loadEnvForce(resolve(envFile));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  assert(url.includes(STAGING_REF), `Refusing non-staging URL: ${url}`);
  assert(key, "Missing SUPABASE_SERVICE_ROLE_KEY");

  const admin = createClient(url, key, { auth: { persistSession: false } });
  // Mirror Payroll Processing default: calendar current month (Jul 2026 now).
  const referenceDate = new Date(2026, 6, 15); // 15 Jul 2026 local
  const period = resolveDirectoryPayrollPeriod(referenceDate);
  console.log(
    `Period: ${period.payrollMonth} (${period.year}-${String(period.month).padStart(2, "0")}), workingDays=${period.totalWorkingDays}`,
  );
  assert(
    period.payrollMonth === "2026-07-01",
    `Expected July 2026 open period, got ${period.payrollMonth}`,
  );

  const { data: employees, error: empErr } = await admin
    .from("employees")
    .select(EMPLOYEE_SELECT)
    .eq("tenant_id", DAVORS)
    .order("staff_id", { ascending: true });
  assert(!empErr, empErr?.message ?? "employees fetch failed");
  assert((employees?.length ?? 0) > 0, "No Davors employees on staging");

  const periodStart = getPeriodStartDate(period.year, period.month);
  const periodEnd = getPeriodEndDate(period.year, period.month);
  const [
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

  // --- (b) no-row fallback (staging often has zero July rows) ---
  const tFresh0 = Date.now();
  const ctxFresh = await loadDirectoryNetPayContext(
    admin,
    DAVORS,
    employees,
    referenceDate,
  );
  const freshElapsed = Date.now() - tFresh0;
  console.log(
    `Pre-seed Directory load ${freshElapsed}ms for ${employees.length} employees ` +
      `(fromRow=${ctxFresh.stats.fromProcessingRow}, fresh=${ctxFresh.stats.fromFreshCalculation})`,
  );
  assert(
    Object.keys(ctxFresh.netPayByEmployeeId).length === employees.length,
    "Missing net pay for some employees (fresh path)",
  );

  const without = employees[0];
  const fallbackBuilt = buildDirectoryNetPayByEmployee(
    [without],
    period,
    [], // no processing rows → must use fresh calc
    attendance ?? [],
    overtime ?? [],
    loans ?? [],
    taxConfigs,
    policyConfig,
  );
  assert(
    fallbackBuilt.stats.fromFreshCalculation === 1,
    "Expected fresh-calculation path when processing row is absent",
  );
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
    resolvePayrollPolicyCompensation(without, policyConfig, new Date(periodEnd)),
  ).net_pay;
  const fallbackNet = fallbackBuilt.netPayByEmployeeId[without.employee_id];
  console.log(
    `(b) ${without.staff_id} fallbackNet=${fallbackNet} expectedFresh=${expectedFresh} days=${resolveDefaultDaysToPay(without, period)}`,
  );
  assert(
    almostEqual(fallbackNet, expectedFresh),
    `Fallback net ${fallbackNet} != expected ${expectedFresh}`,
  );
  assert(
    almostEqual(ctxFresh.netPayByEmployeeId[without.employee_id], expectedFresh),
    "Loader fresh path should match calculatePayrollRow defaults",
  );
  console.log("PASS (b) no-row fallback uses calculatePayrollRow defaults");

  // --- Seed July rows for (a) parity + (d) tenant isolation ---
  const sampleEmp = employees[0];
  let seededDavorsId = null;
  let seededCaantaId = null;

  try {
    const { data: template } = await admin
      .from("payroll_processing")
      .select("*")
      .eq("tenant_id", DAVORS)
      .eq("employee_id", sampleEmp.employee_id)
      .order("payroll_month", { ascending: false })
      .limit(1)
      .maybeSingle();

    const seedPayload = {
      ...(template
        ? Object.fromEntries(
            Object.entries(template).filter(
              ([k]) => k !== "id" && k !== "created_at" && k !== "updated_at",
            ),
          )
        : {
            status: "Open",
            employee_id: sampleEmp.employee_id,
            basic_salary: 0,
            housing_allowance: 0,
            transport_allowance: 0,
            other_allowances: 0,
            daily_rate: 0,
            days_to_pay: period.totalWorkingDays,
            absence_deduction: 0,
            overtime_amount: 0,
            loan_repayment: 0,
            bonuses: 0,
            arrears: 0,
            salary_advance: 0,
            welfare_deduction: 0,
            other_deductions: 0,
            gross_pay: 0,
            employee_ssnit: 0,
            employer_ssnit: 0,
            tier2: 0,
            paye_tax: 0,
            total_deductions: 0,
          }),
      tenant_id: DAVORS,
      payroll_month: period.payrollMonth,
      employee_id: sampleEmp.employee_id,
      net_pay: SEEDED_NET,
      status: "Open",
    };

    const { data: seededDavors, error: seedErr } = await admin
      .from("payroll_processing")
      .insert(seedPayload)
      .select("id, employee_id, net_pay, payroll_month, tenant_id")
      .single();
    assert(!seedErr, seedErr?.message ?? "Failed to seed Davors July row");
    seededDavorsId = seededDavors.id;
    console.log(
      `Seeded Davors July row id=${seededDavorsId} employee=${sampleEmp.staff_id} net_pay=${SEEDED_NET}`,
    );

    const { data: caantaEmployees } = await admin
      .from("employees")
      .select(EMPLOYEE_SELECT)
      .eq("tenant_id", CAANTA)
      .limit(5);

    if ((caantaEmployees?.length ?? 0) > 0) {
      const caantaEmp = caantaEmployees[0];
      // Staging schema may lag production — only set columns known to exist
      // on a recent Davors template (omit net_only_adjustment etc.).
      const caantaSeedBase = template
        ? Object.fromEntries(
            Object.entries(template).filter(
              ([k]) =>
                ![
                  "id",
                  "created_at",
                  "updated_at",
                  "tenant_id",
                  "employee_id",
                  "payroll_month",
                  "net_pay",
                  "department",
                  "project_contract",
                ].includes(k),
            ),
          )
        : {
            status: "Open",
            basic_salary: 0,
            housing_allowance: 0,
            transport_allowance: 0,
            other_allowances: 0,
            daily_rate: 0,
            days_to_pay: period.totalWorkingDays,
            absence_deduction: 0,
            overtime_amount: 0,
            loan_repayment: 0,
            bonuses: 0,
            arrears: 0,
            salary_advance: 0,
            welfare_deduction: 0,
            other_deductions: 0,
            gross_pay: 0,
            employee_ssnit: 0,
            employer_ssnit: 0,
            tier2: 0,
            paye_tax: 0,
            total_deductions: 0,
          };

      const { data: seededCaanta, error: caantaSeedErr } = await admin
        .from("payroll_processing")
        .insert({
          ...caantaSeedBase,
          tenant_id: CAANTA,
          payroll_month: period.payrollMonth,
          employee_id: caantaEmp.employee_id,
          status: "Open",
          net_pay: SEEDED_CAANTA_NET,
        })
        .select("id, employee_id, net_pay")
        .single();
      assert(
        !caantaSeedErr,
        caantaSeedErr?.message ?? "Failed to seed Caanta July row",
      );
      seededCaantaId = seededCaanta.id;
      console.log(
        `Seeded Caanta July row id=${seededCaantaId} employee=${caantaEmp.staff_id} net_pay=${SEEDED_CAANTA_NET}`,
      );
    }

    // --- (a) with-row uses stored net_pay ---
    const t0 = Date.now();
    const ctx = await loadDirectoryNetPayContext(
      admin,
      DAVORS,
      employees,
      referenceDate,
    );
    const elapsedMs = Date.now() - t0;
    console.log(
      `Post-seed Directory load ${elapsedMs}ms ` +
        `(fromRow=${ctx.stats.fromProcessingRow}, fresh=${ctx.stats.fromFreshCalculation})`,
    );
    assert(elapsedMs < 15000, `Directory net-pay load too slow: ${elapsedMs}ms`);
    assert(
      ctx.stats.fromProcessingRow >= 1,
      "Expected at least one employee from payroll_processing row",
    );

    const directoryNet = ctx.netPayByEmployeeId[sampleEmp.employee_id];
    console.log(
      `(a) ${sampleEmp.staff_id} directory=${directoryNet} stored=${SEEDED_NET}`,
    );
    assert(
      almostEqual(directoryNet, SEEDED_NET),
      `Directory net ${directoryNet} != seeded payroll_processing.net_pay ${SEEDED_NET}`,
    );
    console.log("PASS (a) with-row uses stored payroll_processing.net_pay");

    // --- (c) batch coverage / timing ---
    const { data: julyRows } = await admin
      .from("payroll_processing")
      .select("*")
      .eq("tenant_id", DAVORS)
      .eq("payroll_month", period.payrollMonth);
    const built = buildDirectoryNetPayByEmployee(
      employees,
      period,
      julyRows ?? [],
      attendance ?? [],
      overtime ?? [],
      loans ?? [],
      taxConfigs,
      policyConfig,
    );
    assert(
      built.stats.fromProcessingRow + built.stats.fromFreshCalculation ===
        employees.length,
      "Builder should cover every employee once",
    );
    console.log(
      `PASS (c) batch builder covers ${employees.length} employees in ${elapsedMs}ms (no per-employee DB round-trips)`,
    );

    // --- (d) tenant isolation ---
    const { data: caantaJuly } = await admin
      .from("payroll_processing")
      .select("employee_id, net_pay, tenant_id")
      .eq("tenant_id", CAANTA)
      .eq("payroll_month", period.payrollMonth);

    for (const row of caantaJuly ?? []) {
      assert(
        ctx.netPayByEmployeeId[row.employee_id] == null ||
          !almostEqual(ctx.netPayByEmployeeId[row.employee_id], SEEDED_CAANTA_NET),
        `Davors Directory leaked Caanta net_pay for ${row.employee_id}`,
      );
      // Davors map should only contain Davors employee_ids
      assert(
        !employees.some((e) => e.employee_id === row.employee_id) ||
          ctx.netPayByEmployeeId[row.employee_id] !== SEEDED_CAANTA_NET,
        `Davors Directory used Caanta net for shared-looking id ${row.employee_id}`,
      );
    }

    if ((caantaEmployees?.length ?? 0) > 0) {
      const caantaCtx = await loadDirectoryNetPayContext(
        admin,
        CAANTA,
        caantaEmployees,
        referenceDate,
      );
      for (const emp of caantaEmployees) {
        assert(
          ctx.netPayByEmployeeId[emp.employee_id] == null,
          `Davors Directory includes Caanta employee ${emp.employee_id}`,
        );
      }
      for (const emp of employees) {
        assert(
          caantaCtx.netPayByEmployeeId[emp.employee_id] == null,
          `Caanta Directory leaked Davors employee ${emp.employee_id}`,
        );
      }
      const caantaSample = caantaEmployees[0];
      assert(
        almostEqual(
          caantaCtx.netPayByEmployeeId[caantaSample.employee_id],
          SEEDED_CAANTA_NET,
        ),
        "Caanta Directory should see its own seeded net_pay",
      );
      console.log(
        `PASS (d) tenant isolation — Davors July rows=${(julyRows ?? []).length}, Caanta July rows=${(caantaJuly ?? []).length}`,
      );
    } else {
      console.log(
        `PASS (d) tenant isolation — no Caanta employees; Davors map scoped by tenant filter`,
      );
    }

    console.log("\nAll directory net-pay staging checks passed.");
  } finally {
    if (seededDavorsId) {
      await admin.from("payroll_processing").delete().eq("id", seededDavorsId);
      console.log(`Cleaned up Davors seed ${seededDavorsId}`);
    }
    if (seededCaantaId) {
      await admin.from("payroll_processing").delete().eq("id", seededCaantaId);
      console.log(`Cleaned up Caanta seed ${seededCaantaId}`);
    }
  }
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
