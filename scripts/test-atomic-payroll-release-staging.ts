/**
 * Staging tests for atomic payroll release + reopen daily_rate/days_to_pay fix.
 *
 *   npx tsx scripts/test-atomic-payroll-release-staging.ts
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import {
  deletePayrollLockFinanceEntries,
  PAYROLL_EXPENSE_PAYMENT_STATUS_PAID,
  resolvePayrollLockFinancePeriod,
} from "../app/dashboard/hr-payroll/payroll-lock-finance-utils";
import {
  PAYROLL_STATUS_LOCKED,
  PAYROLL_STATUS_OPEN,
  PAYROLL_STATUS_PARTIALLY_LOCKED,
} from "../app/dashboard/hr-payroll/payroll-period-utils";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const DAVORS = "00000001-0000-4000-8000-000000000001";
const TEST_EMPLOYEE = "DF-EMP-0006";
const TEST_MONTH = "2025-05-01";
const TEST_YEAR = 2025;
const TEST_MONTH_NUM = 5;
const TEST_DAILY_RATE = 125.5;
const TEST_DAYS_TO_PAY = 22;
const LOAN_REPAY = 100;
const NET_PAY = 2400;
const GROSS = 2850;

function loadEnvForce(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    process.env[t.slice(0, i).trim()] = v;
  }
}

function buildProcessingRow() {
  return {
    id: "test-row-id",
    payroll_month: TEST_MONTH,
    status: "Open",
    employee_id: TEST_EMPLOYEE,
    basic_salary: 2500,
    housing_allowance: 200,
    transport_allowance: 150,
    other_allowances: 0,
    department: "Test",
    project_contract: null,
    daily_rate: TEST_DAILY_RATE,
    days_to_pay: TEST_DAYS_TO_PAY,
    absence_deduction: 0,
    overtime_amount: 0,
    loan_repayment: LOAN_REPAY,
    bonuses: 0,
    arrears: 0,
    net_only_adjustment: 0,
    salary_advance: 0,
    welfare_deduction: 50,
    other_deductions: 0,
    gross_pay: GROSS,
    employee_ssnit: 80,
    employer_ssnit: 200,
    tier2: 50,
    paye_tax: 120,
    total_deductions: 450,
    net_pay: NET_PAY,
  };
}

async function ensureMigration(pgClient) {
  const { rows } = await pgClient.query(
    `SELECT count(*)::int AS cnt FROM pg_proc WHERE proname = 'release_payroll_period'`,
  );
  if ((rows[0]?.cnt ?? 0) > 0) return;
  await pgClient.query(
    readFileSync(resolve("scripts/285_atomic_payroll_release.sql"), "utf8"),
  );
  console.log("Applied 285 migration for test run");
}

async function cleanup(admin, pgClient) {
  const period = resolvePayrollLockFinancePeriod(
    TEST_MONTH,
    TEST_YEAR,
    TEST_MONTH_NUM,
  );
  if (period) {
    try {
      await deletePayrollLockFinanceEntries(admin, period, DAVORS, {
        loanRepaymentRows: [
          { employee_id: TEST_EMPLOYEE, loan_repayment: LOAN_REPAY },
        ],
      });
    } catch {
      // ignore
    }
  }

  await admin
    .from("payroll_processing")
    .delete()
    .eq("tenant_id", DAVORS)
    .eq("payroll_month", TEST_MONTH)
    .eq("employee_id", TEST_EMPLOYEE);

  await admin.rpc("admin_delete_payroll_history_for_employees", {
    p_month: TEST_MONTH,
    p_tenant_id: DAVORS,
    p_employee_ids: [TEST_EMPLOYEE],
  });

  await admin
    .from("month_end_close")
    .delete()
    .eq("tenant_id", DAVORS)
    .eq("month", TEST_MONTH);

  if (pgClient) {
    await pgClient.query(`
      DROP TRIGGER IF EXISTS trg_test_fail_payroll_proc ON payroll_processing;
      DROP FUNCTION IF EXISTS trg_test_fail_payroll_proc();
    `);
  }
}

async function setupOpenProcessing(admin) {
  const row = buildProcessingRow();
  const { id: _id, ...payload } = row;
  await admin.from("payroll_processing").insert({
    tenant_id: DAVORS,
    ...payload,
  });

  await admin.from("month_end_close").upsert(
    {
      tenant_id: DAVORS,
      month: TEST_MONTH,
      business_unit_id: null,
      employees_recorded: 1,
      total_net_pay: NET_PAY,
      lock_status: PAYROLL_STATUS_OPEN,
      notes: null,
    },
    { onConflict: "tenant_id,business_unit_id,month" },
  );
}

async function lockPartial(admin) {
  const { data, error } = await admin.rpc("lock_payroll_period", {
    p_tenant_id: DAVORS,
    p_business_unit_id: null,
    p_employee_ids: [TEST_EMPLOYEE],
    p_payroll_month: TEST_MONTH,
    p_period_year: TEST_YEAR,
    p_period_month: TEST_MONTH_NUM,
    p_lock_status: PAYROLL_STATUS_PARTIALLY_LOCKED,
    p_notes: "release test partial",
    p_rows: [buildProcessingRow()],
  });
  if (error) throw new Error(`partial lock: ${error.message}`);
  return data;
}

async function promoteFull(admin) {
  const { data, error } = await admin.rpc("lock_payroll_period", {
    p_tenant_id: DAVORS,
    p_business_unit_id: null,
    p_employee_ids: [TEST_EMPLOYEE],
    p_payroll_month: TEST_MONTH,
    p_period_year: TEST_YEAR,
    p_period_month: TEST_MONTH_NUM,
    p_lock_status: PAYROLL_STATUS_LOCKED,
    p_notes: null,
    p_rows: [],
  });
  if (error) throw new Error(`promote: ${error.message}`);
  return data;
}

async function ensureHistoryProcessingColumns(pgClient) {
  await pgClient.query(readFileSync(
    resolve("scripts/payroll-history-lock-columns.sql"),
    "utf8",
  ));
}

async function stampHistoryProcessingFields(pgClient) {
  await ensureHistoryProcessingColumns(pgClient);
  await pgClient.query(
    `
    UPDATE payroll_history
    SET daily_rate = $1, days_to_pay = $2
    WHERE tenant_id = $3
      AND payroll_month = $4
      AND employee_id = $5
    `,
    [TEST_DAILY_RATE, TEST_DAYS_TO_PAY, DAVORS, TEST_MONTH, TEST_EMPLOYEE],
  );
}

async function fetchProcessingFields(pgClient) {
  const { rows } = await pgClient.query(
    `
    SELECT daily_rate, days_to_pay, status
    FROM payroll_processing
    WHERE tenant_id = $1
      AND payroll_month = $2
      AND employee_id = $3
    LIMIT 1
    `,
    [DAVORS, TEST_MONTH, TEST_EMPLOYEE],
  );
  return rows[0] ?? null;
}

async function fetchHistoryLocked(pgClient) {
  const { rows } = await pgClient.query(
    `
    SELECT locked, daily_rate, days_to_pay
    FROM payroll_history
    WHERE tenant_id = $1
      AND payroll_month = $2
      AND employee_id = $3
    LIMIT 1
    `,
    [DAVORS, TEST_MONTH, TEST_EMPLOYEE],
  );
  return rows[0] ?? null;
}

async function reopen(admin) {
  const { data, error } = await admin.rpc("reopen_payroll_period", {
    p_tenant_id: DAVORS,
    p_business_unit_id: null,
    p_employee_ids: [TEST_EMPLOYEE],
    p_payroll_month: TEST_MONTH,
    p_period_year: TEST_YEAR,
    p_period_month: TEST_MONTH_NUM,
  });
  return { data, error };
}

async function release(admin) {
  const { data, error } = await admin.rpc("release_payroll_period", {
    p_tenant_id: DAVORS,
    p_business_unit_id: null,
    p_employee_ids: [TEST_EMPLOYEE],
    p_payroll_month: TEST_MONTH,
    p_period_year: TEST_YEAR,
    p_period_month: TEST_MONTH_NUM,
  });
  return { data, error };
}

async function main() {
  loadEnvForce(resolve(".env.staging.local"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const dbUrl = process.env.DATABASE_URL ?? "";
  if (!url.includes(STAGING_REF) || !dbUrl.includes(STAGING_REF)) {
    throw new Error("Refusing non-staging env");
  }

  const admin = createClient(url, key, { auth: { persistSession: false } });
  const pgClient = new pg.Client({
    connectionString: dbUrl,
    ssl: { rejectUnauthorized: false },
  });
  await pgClient.connect();

  const results = [];

  try {
    await ensureMigration(pgClient);
    await cleanup(admin, pgClient);

    // --- Reopen restores daily_rate / days_to_pay ---
    await setupOpenProcessing(admin);
    await lockPartial(admin);
    await stampHistoryProcessingFields(pgClient);

    const { data: reopened, error: reopenErr } = await reopen(admin);
    const procAfterReopen = await fetchProcessingFields(pgClient);
    results.push({
      name: "Reopen restores daily_rate and days_to_pay to payroll_processing",
      ok:
        !reopenErr &&
        reopened?.closeRecord?.lock_status === PAYROLL_STATUS_OPEN &&
        Number(procAfterReopen?.daily_rate) === TEST_DAILY_RATE &&
        Number(procAfterReopen?.days_to_pay) === TEST_DAYS_TO_PAY &&
        procAfterReopen?.status === "Open",
      detail: { reopenErr: reopenErr?.message, procAfterReopen, reopened },
    });

    // --- Fully Locked: reopen rejects, release succeeds ---
    await cleanup(admin, pgClient);
    await setupOpenProcessing(admin);
    await lockPartial(admin);
    await stampHistoryProcessingFields(pgClient);
    await promoteFull(admin);

    const histBeforeRelease = await fetchHistoryLocked(pgClient);
    const reopenOnFull = await reopen(admin);
    const releaseOnFull = await release(admin);
    const procAfterFullRelease = await fetchProcessingFields(pgClient);
    const { count: histCountAfterRelease } = await admin
      .from("payroll_history")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", DAVORS)
      .eq("payroll_month", TEST_MONTH);

    results.push({
      name: "Fully Locked: reopen rejects locked history; release succeeds",
      ok:
        histBeforeRelease?.locked === true &&
        !!reopenOnFull.error &&
        (/Only partially locked periods can be reopened/i.test(
          reopenOnFull.error.message,
        ) ||
          /permanently locked payroll records/i.test(
            reopenOnFull.error.message,
          )) &&
        !releaseOnFull.error &&
        releaseOnFull.data?.closeRecord?.lock_status === PAYROLL_STATUS_OPEN &&
        histCountAfterRelease === 0,
      detail: {
        histBeforeRelease,
        reopenError: reopenOnFull.error?.message,
        release: releaseOnFull.data,
      },
    });

    results.push({
      name: "Release restores daily_rate and days_to_pay after Fully Locked release",
      ok:
        Number(procAfterFullRelease?.daily_rate) === TEST_DAILY_RATE &&
        Number(procAfterFullRelease?.days_to_pay) === TEST_DAYS_TO_PAY &&
        procAfterFullRelease?.status === "Open",
      detail: procAfterFullRelease,
    });

    // --- Atomicity: release mid-flight failure rolls back ---
    await cleanup(admin, pgClient);
    await setupOpenProcessing(admin);
    await lockPartial(admin);
    await stampHistoryProcessingFields(pgClient);
    await promoteFull(admin);

    const beforeFail = {
      mec: (
        await admin
          .from("month_end_close")
          .select("lock_status")
          .eq("tenant_id", DAVORS)
          .eq("month", TEST_MONTH)
      ).data,
      history: (
        await admin
          .from("payroll_history")
          .select("id")
          .eq("tenant_id", DAVORS)
          .eq("payroll_month", TEST_MONTH)
      ).data?.length,
      processing: (
        await admin
          .from("payroll_processing")
          .select("id")
          .eq("tenant_id", DAVORS)
          .eq("payroll_month", TEST_MONTH)
      ).data?.length,
      salPaid: (
        await admin
          .from("expense_register")
          .select("payment_status")
          .eq("tenant_id", DAVORS)
          .eq("receipt_no", "PAYROLL-SAL-2025-05")
          .maybeSingle()
      ).data?.payment_status,
    };

    await pgClient.query(`
      CREATE OR REPLACE FUNCTION trg_test_fail_payroll_proc()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        RAISE EXCEPTION 'TEST_FAIL_PAYROLL_PROC';
      END;
      $$;
      CREATE TRIGGER trg_test_fail_payroll_proc
      BEFORE INSERT ON payroll_processing
      FOR EACH ROW EXECUTE FUNCTION trg_test_fail_payroll_proc();
    `);

    const { error: failReleaseErr } = await release(admin);

    const afterFail = {
      mec: (
        await admin
          .from("month_end_close")
          .select("lock_status")
          .eq("tenant_id", DAVORS)
          .eq("month", TEST_MONTH)
      ).data,
      history: (
        await admin
          .from("payroll_history")
          .select("id")
          .eq("tenant_id", DAVORS)
          .eq("payroll_month", TEST_MONTH)
      ).data?.length,
      processing: (
        await admin
          .from("payroll_processing")
          .select("id")
          .eq("tenant_id", DAVORS)
          .eq("payroll_month", TEST_MONTH)
      ).data?.length,
      salPaid: (
        await admin
          .from("expense_register")
          .select("payment_status")
          .eq("tenant_id", DAVORS)
          .eq("receipt_no", "PAYROLL-SAL-2025-05")
          .maybeSingle()
      ).data?.payment_status,
    };

    await pgClient.query(`
      DROP TRIGGER IF EXISTS trg_test_fail_payroll_proc ON payroll_processing;
      DROP FUNCTION IF EXISTS trg_test_fail_payroll_proc();
    `);

    results.push({
      name: "Atomicity: release processing-insert failure rolls back everything",
      ok:
        !!failReleaseErr &&
        String(failReleaseErr.message).includes("TEST_FAIL_PAYROLL_PROC") &&
        afterFail.mec?.[0]?.lock_status === PAYROLL_STATUS_LOCKED &&
        afterFail.history === beforeFail.history &&
        afterFail.processing === beforeFail.processing &&
        afterFail.salPaid === PAYROLL_EXPENSE_PAYMENT_STATUS_PAID,
      detail: { failReleaseErr: failReleaseErr?.message, beforeFail, afterFail },
    });

    // --- Parity: release result shape ---
    await cleanup(admin, pgClient);
    await setupOpenProcessing(admin);
    await lockPartial(admin);
    await stampHistoryProcessingFields(pgClient);
    await promoteFull(admin);
    const releaseResult = await release(admin);

    results.push({
      name: "Parity: release returns closeRecord, financeResult, restoredRows",
      ok:
        !releaseResult.error &&
        releaseResult.data?.closeRecord?.month === TEST_MONTH &&
        typeof releaseResult.data?.financeResult === "object" &&
        releaseResult.data?.restoredRows === 1,
      detail: releaseResult.data,
    });

    console.log("\n=== TEST RESULTS ===");
    let allPass = true;
    for (const r of results) {
      console.log(`${r.ok ? "PASS" : "FAIL"}: ${r.name}`);
      if (!r.ok) {
        allPass = false;
        console.log(JSON.stringify(r.detail, null, 2));
      }
    }

    if (!allPass) {
      throw new Error("One or more release staging tests failed");
    }

    console.log("\nAll atomic payroll release staging tests passed.");
  } finally {
    await cleanup(admin, pgClient);
    await pgClient.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
