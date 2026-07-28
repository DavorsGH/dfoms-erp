/**
 * Staging: payroll_processing ON CONFLICT + mid-month hire days_to_pay.
 *
 *   npx tsx scripts/test-payroll-on-conflict-proration-staging.ts
 *   npx tsx scripts/test-payroll-on-conflict-proration-staging.ts --env-file .env.staging.local
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  resolveDefaultDaysToPay,
  resolveSelectedPeriod,
} from "../app/dashboard/hr-payroll/payroll-period-utils";
import { filterEmployeesForPayrollPeriod } from "../app/dashboard/hr-payroll/employee-utils";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const DAVORS = "00000001-0000-4000-8000-000000000001";
const TEST_MONTH = "2099-07-01"; // isolated future month
const TEST_MARKER = "AUTOTEST mid-month hire payroll conflict";

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

async function main() {
  const envFile = resolveEnvFile(process.argv.slice(2));
  loadEnvForce(resolve(envFile));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  assert(url.includes(STAGING_REF), `Refusing non-staging URL: ${url}`);
  assert(key, "Missing SUPABASE_SERVICE_ROLE_KEY");

  const admin = createClient(url, key, { auth: { persistSession: false } });
  const period = resolveSelectedPeriod(2099, 7);

  // --- Unit: July 2026 hire on 15th ---
  const july2026 = resolveSelectedPeriod(2026, 7);
  const daysJul15 = resolveDefaultDaysToPay(
    { date_hired: "2026-07-15", appointment_end_date: null },
    july2026,
  );
  console.log(
    `July 2026 totalWorkingDays=${july2026.totalWorkingDays}, hire 2026-07-15 days_to_pay=${daysJul15}`,
  );
  assert(daysJul15 === 15, `Expected 15 pro-rated days, got ${daysJul15}`);
  assert(
    daysJul15 < july2026.totalWorkingDays,
    "Pro-rated days should be less than full month",
  );

  // --- Constraint probe ---
  const { data: anyEmp } = await admin
    .from("employees")
    .select("employee_id")
    .eq("tenant_id", DAVORS)
    .limit(1)
    .maybeSingle();
  assert(anyEmp?.employee_id, "Need at least one Davors employee on staging");

  const probePayload = {
    tenant_id: DAVORS,
    payroll_month: "2099-01-01",
    employee_id: anyEmp.employee_id,
    days_to_pay: 1,
    status: "Open",
    basic_salary: 0,
    housing_allowance: 0,
    transport_allowance: 0,
    other_allowances: 0,
    overtime_amount: 0,
    bonuses: 0,
    arrears: 0,
    gross_pay: 0,
    employee_ssnit: 0,
    employer_ssnit: 0,
    tier2: 0,
    tier3: 0,
    paye_tax: 0,
    loan_repayment: 0,
    salary_advance: 0,
    welfare_deduction: 0,
    other_deductions: 0,
    absence_deduction: 0,
    total_deductions: 0,
    net_pay: 0,
    daily_rate: 0,
  };

  const candidates = [
    "payroll_month,employee_id",
    "tenant_id,payroll_month,employee_id",
  ];
  const results = {};
  for (const onConflict of candidates) {
    const { data, error } = await admin
      .from("payroll_processing")
      .upsert(probePayload, { onConflict, ignoreDuplicates: true })
      .select("id")
      .maybeSingle();
    results[onConflict] = error
      ? `ERROR ${error.code}: ${error.message}`
      : `OK id=${data?.id ?? "dup"}`;
    console.log(`onConflict ${onConflict} => ${results[onConflict]}`);
  }

  await admin
    .from("payroll_processing")
    .delete()
    .eq("tenant_id", DAVORS)
    .eq("payroll_month", "2099-01-01");

  const fixedKey = "tenant_id,payroll_month,employee_id";
  const fixedOk = String(results[fixedKey]).startsWith("OK");
  if (!fixedOk) {
    console.log(
      "WARN: staging still has legacy UNIQUE(payroll_month, employee_id) only.",
    );
    console.log(
      "Apply scripts/125_payroll_processing_tenant_unique.sql on staging (SQL Editor)",
    );
    console.log(
      "Production already has the tenant-scoped unique (confirmed separately).",
    );
  } else {
    console.log("PASS: tenant_id,payroll_month,employee_id onConflict works");
  }

  // --- Create mid-month hire + sync-style upsert for TEST_MONTH ---
  const staffId = `T${Date.now().toString().slice(-6)}`;
  const employeeId = `TEMP-${Date.now()}`;
  const hireDate = "2099-07-15";

  const { data: created, error: createErr } = await admin
    .from("employees")
    .insert({
      tenant_id: DAVORS,
      employee_id: employeeId,
      staff_id: staffId,
      full_name: TEST_MARKER,
      employment_status: "Active",
      employment_type: "Full-Time",
      date_hired: hireDate,
      appointment_end_date: null,
      basic_salary: 2700,
      housing_allowance: 0,
      transport_allowance: 0,
      other_allowances: 0,
    })
    .select("employee_id, staff_id, date_hired, employment_status")
    .single();
  assert(!createErr && created, createErr?.message ?? "create employee failed");
  console.log("Created test employee", created);

  try {
    const { data: employees } = await admin
      .from("employees")
      .select(
        "employee_id, staff_id, full_name, employment_type, employment_status, date_hired, appointment_end_date, basic_salary, housing_allowance, transport_allowance, other_allowances, department, contract_project",
      )
      .eq("tenant_id", DAVORS)
      .eq("employment_status", "Active");

    const forPeriod = filterEmployeesForPayrollPeriod(
      employees ?? [],
      period.year,
      period.month,
    );
    assert(
      forPeriod.some((e) => e.employee_id === employeeId),
      "Mid-month hire should be included in period filter",
    );
    assert(
      forPeriod.length >= 1,
      "Expected at least the test employee in period",
    );

    const days = resolveDefaultDaysToPay(created, period);
    console.log(
      `TEST_MONTH totalWorkingDays=${period.totalWorkingDays}, mid-hire days_to_pay=${days}`,
    );
    assert(days === 15, `Expected 15 days for hire ${hireDate}, got ${days}`);

    // Upsert all period employees (mirrors fixed app path)
    const rows = forPeriod.map((emp) => {
      const daysToPay = resolveDefaultDaysToPay(emp, period);
      return {
        tenant_id: DAVORS,
        payroll_month: TEST_MONTH,
        employee_id: emp.employee_id,
        status: "Open",
        days_to_pay: daysToPay,
        basic_salary: Number(emp.basic_salary) || 0,
        housing_allowance: 0,
        transport_allowance: 0,
        other_allowances: 0,
        overtime_amount: 0,
        bonuses: 0,
        arrears: 0,
        gross_pay: 0,
        employee_ssnit: 0,
        employer_ssnit: 0,
        tier2: 0,
        tier3: 0,
        paye_tax: 0,
        loan_repayment: 0,
        salary_advance: 0,
        welfare_deduction: 0,
        other_deductions: 0,
        absence_deduction: 0,
        total_deductions: 0,
        net_pay: 0,
        daily_rate: 0,
      };
    });

    // Prefer the production onConflict target; fall back to legacy if staging
    // has not yet received migration 125.
    let upsertErr = null;
    {
      const attempt = await admin.from("payroll_processing").upsert(rows, {
        onConflict: "tenant_id,payroll_month,employee_id",
        ignoreDuplicates: true,
      });
      if (
        attempt.error?.code === "42P10" ||
        /no unique or exclusion constraint matching the ON CONFLICT/i.test(
          attempt.error?.message ?? "",
        )
      ) {
        console.log(
          "Falling back to legacy onConflict for pre-migration staging...",
        );
        const legacy = await admin.from("payroll_processing").upsert(rows, {
          onConflict: "payroll_month,employee_id",
          ignoreDuplicates: true,
        });
        upsertErr = legacy.error;
      } else {
        upsertErr = attempt.error;
      }
    }
    assert(!upsertErr, `Bulk upsert failed: ${upsertErr?.message}`);

    const { data: procRows, error: procErr } = await admin
      .from("payroll_processing")
      .select("employee_id, days_to_pay")
      .eq("tenant_id", DAVORS)
      .eq("payroll_month", TEST_MONTH);
    assert(!procErr, procErr?.message);
    assert(
      (procRows?.length ?? 0) === forPeriod.length,
      `Expected ${forPeriod.length} processing rows, got ${procRows?.length}`,
    );

    const mid = procRows?.find((r) => r.employee_id === employeeId);
    assert(mid, "Mid-month hire missing from payroll_processing");
    assert(
      Number(mid.days_to_pay) === 15,
      `Stored days_to_pay=${mid.days_to_pay}, expected 15`,
    );

    console.log(
      `PASS: ${procRows.length} employees in payroll table; mid-hire days_to_pay=15`,
    );
  } finally {
    await admin
      .from("payroll_processing")
      .delete()
      .eq("tenant_id", DAVORS)
      .eq("payroll_month", TEST_MONTH);
    await admin
      .from("employees")
      .delete()
      .eq("tenant_id", DAVORS)
      .eq("employee_id", employeeId);
    console.log("Cleanup done");
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
