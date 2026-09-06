/**
 * Staging soak + atomicity + parity tests for atomic payroll lock/reopen RPCs.
 *
 *   npx tsx scripts/test-atomic-payroll-lock-reopen-staging.ts
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import {
  calculatePayrollLockFinanceTotals,
  deletePayrollLockFinanceEntries,
  PAYROLL_EXPENSE_PAYMENT_STATUS_ACCRUED,
  PAYROLL_EXPENSE_PAYMENT_STATUS_PAID,
  postPayrollLockFinanceEntries,
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
const TEST_MONTH = "2025-06-01";
const TEST_YEAR = 2025;
const TEST_MONTH_NUM = 6;
const PERIOD_KEY = "2025-06";
const SAL_RECEIPT = `PAYROLL-SAL-${PERIOD_KEY}`;
const ESSNIT_RECEIPT = `PAYROLL-ESSNIT-${PERIOD_KEY}`;
const DEDSAV_INVOICE = `PAYROLL-DEDSAV-${PERIOD_KEY}`;

const TAX_SOURCE_ID = "a11ce000-0000-5000-8000-000020250601";

const GROSS = 2850;
const NET_PAY = 2400;
const EMPLOYER_SSNIT = 200;
const TIER2 = 50;
const PAYE = 120;
const LOAN_REPAY = 100;

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

function r2(n) {
  return Math.round(Number(n || 0) * 100) / 100;
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
    daily_rate: null,
    days_to_pay: 22,
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
    employer_ssnit: EMPLOYER_SSNIT,
    tier2: TIER2,
    paye_tax: PAYE,
    total_deductions: 450,
    net_pay: NET_PAY,
  };
}

function buildFinanceSourceRow() {
  const row = buildProcessingRow();
  return {
    employee_id: row.employee_id,
    gross_pay: row.gross_pay,
    net_only_adjustment: row.net_only_adjustment,
    absence_deduction: row.absence_deduction,
    loan_repayment: row.loan_repayment,
    salary_advance: row.salary_advance,
    welfare_deduction: row.welfare_deduction,
    other_deductions: row.other_deductions,
    employee_ssnit: row.employee_ssnit,
    employer_ssnit: row.employer_ssnit,
    tier2: row.tier2,
    paye_tax: row.paye_tax,
  };
}

async function ensureMigration(pgClient) {
  const { rows } = await pgClient.query(
    `SELECT count(*)::int AS cnt FROM pg_proc WHERE proname = 'lock_payroll_period'`,
  );
  if ((rows[0]?.cnt ?? 0) > 0) return;
  const sql = readFileSync(
    resolve("scripts/279_atomic_payroll_lock_reopen.sql"),
    "utf8",
  );
  await pgClient.query(sql);
  console.log("Applied 279 migration for test run");
}

async function snapshotState(admin, employeeIds = [TEST_EMPLOYEE]) {
  const [mec, hist, proc, sal, essnit, ded, tax] = await Promise.all([
    admin
      .from("month_end_close")
      .select("*")
      .eq("tenant_id", DAVORS)
      .eq("month", TEST_MONTH),
    admin
      .from("payroll_history")
      .select("id, employee_id, locked, net_pay")
      .eq("tenant_id", DAVORS)
      .eq("payroll_month", TEST_MONTH)
      .in("employee_id", employeeIds),
    admin
      .from("payroll_processing")
      .select("id, employee_id, net_pay")
      .eq("tenant_id", DAVORS)
      .eq("payroll_month", TEST_MONTH)
      .in("employee_id", employeeIds),
    admin
      .from("expense_register")
      .select("receipt_no, amount, payment_status")
      .eq("tenant_id", DAVORS)
      .eq("receipt_no", SAL_RECEIPT)
      .maybeSingle(),
    admin
      .from("expense_register")
      .select("receipt_no, amount, payment_status")
      .eq("tenant_id", DAVORS)
      .eq("receipt_no", ESSNIT_RECEIPT)
      .maybeSingle(),
    admin
      .from("income_register")
      .select("invoice_no, amount")
      .eq("tenant_id", DAVORS)
      .eq("invoice_no", DEDSAV_INVOICE)
      .maybeSingle(),
    admin
      .from("tax_ledger_entries")
      .select("tax_component, tax_amount, status")
      .eq("tenant_id", DAVORS)
      .eq("source_type", "payroll_period")
      .eq("source_id", TAX_SOURCE_ID),
  ]);

  return {
    mec: mec.data ?? [],
    historyCount: hist.data?.length ?? 0,
    processingCount: proc.data?.length ?? 0,
    sal: sal.data,
    essnit: essnit.data,
    ded: ded.data,
    tax: tax.data ?? [],
  };
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
        loanRepaymentRows: [{ employee_id: TEST_EMPLOYEE, loan_repayment: LOAN_REPAY }],
      });
    } catch {
      // ignore if already clean
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
      DROP TRIGGER IF EXISTS trg_test_fail_payroll_sal ON expense_register;
      DROP FUNCTION IF EXISTS trg_test_fail_payroll_sal();
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
    p_notes: "atomic test partial",
    p_rows: [buildProcessingRow()],
  });
  if (error) throw new Error(`partial lock: ${error.message}`);
  return data;
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
  if (error) throw new Error(`reopen: ${error.message}`);
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

    // --- Soak: Partial -> Reopen -> Partial -> Promote ---
    await setupOpenProcessing(admin);
    const partial1 = await lockPartial(admin);
    let snap = await snapshotState(admin);
    results.push({
      name: "Soak 1: partial lock posts finance + history",
      ok:
        partial1?.closeRecord?.lock_status === PAYROLL_STATUS_PARTIALLY_LOCKED &&
        snap.historyCount === 1 &&
        snap.processingCount === 0 &&
        snap.sal?.payment_status === PAYROLL_EXPENSE_PAYMENT_STATUS_ACCRUED &&
        r2(snap.sal?.amount) === GROSS,
      detail: snap,
    });

    const reopened = await reopen(admin);
    snap = await snapshotState(admin);
    results.push({
      name: "Soak 2: reopen restores processing + clears finance",
      ok:
        reopened?.closeRecord?.lock_status === PAYROLL_STATUS_OPEN &&
        snap.historyCount === 0 &&
        snap.processingCount === 1 &&
        !snap.sal &&
        !snap.essnit,
      detail: snap,
    });

    await lockPartial(admin);
    snap = await snapshotState(admin);
    results.push({
      name: "Soak 3: second partial lock succeeds",
      ok:
        snap.historyCount === 1 &&
        snap.sal?.payment_status === PAYROLL_EXPENSE_PAYMENT_STATUS_ACCRUED,
      detail: snap,
    });

    const promoted = await promoteFull(admin);
    snap = await snapshotState(admin);
    results.push({
      name: "Soak 4: promote marks SAL Paid",
      ok:
        promoted?.promotedFromPartial === true &&
        promoted?.closeRecord?.lock_status === PAYROLL_STATUS_LOCKED &&
        snap.sal?.payment_status === PAYROLL_EXPENSE_PAYMENT_STATUS_PAID &&
        r2(snap.sal?.amount) === GROSS,
      detail: snap,
    });

    // --- Atomicity: deliberate failure after MEC would have committed (old bug) ---
    await cleanup(admin, pgClient);
    await setupOpenProcessing(admin);
    const beforeFail = await snapshotState(admin);

    await pgClient.query(`
      CREATE OR REPLACE FUNCTION trg_test_fail_payroll_sal()
      RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.receipt_no LIKE 'PAYROLL-SAL-${PERIOD_KEY}' THEN
          RAISE EXCEPTION 'TEST_FAIL_PAYROLL_SAL';
        END IF;
        RETURN NEW;
      END;
      $$;
      CREATE TRIGGER trg_test_fail_payroll_sal
      BEFORE INSERT ON expense_register
      FOR EACH ROW EXECUTE FUNCTION trg_test_fail_payroll_sal();
    `);

    const { error: failErr } = await admin.rpc("lock_payroll_period", {
      p_tenant_id: DAVORS,
      p_business_unit_id: null,
      p_employee_ids: [TEST_EMPLOYEE],
      p_payroll_month: TEST_MONTH,
      p_period_year: TEST_YEAR,
      p_period_month: TEST_MONTH_NUM,
      p_lock_status: PAYROLL_STATUS_PARTIALLY_LOCKED,
      p_notes: "fail test",
      p_rows: [buildProcessingRow()],
    });

    const afterFail = await snapshotState(admin);
    await pgClient.query(`
      DROP TRIGGER IF EXISTS trg_test_fail_payroll_sal ON expense_register;
      DROP FUNCTION IF EXISTS trg_test_fail_payroll_sal();
    `);

    results.push({
      name: "Atomicity: mid-flight SAL insert failure rolls back everything",
      ok:
        !!failErr &&
        String(failErr.message).includes("TEST_FAIL_PAYROLL_SAL") &&
        afterFail.historyCount === beforeFail.historyCount &&
        afterFail.processingCount === beforeFail.processingCount &&
        afterFail.mec.every((r) => r.lock_status === PAYROLL_STATUS_OPEN) &&
        !afterFail.sal,
      detail: {
        error: failErr?.message,
        before: beforeFail,
        after: afterFail,
      },
    });

    // --- Parity: RPC partial lock vs legacy JS finance on identical rows ---
    await cleanup(admin, pgClient);
    const rows = [buildFinanceSourceRow()];
    const totals = calculatePayrollLockFinanceTotals(rows);
    const period = resolvePayrollLockFinancePeriod(
      TEST_MONTH,
      TEST_YEAR,
      TEST_MONTH_NUM,
    );

    await setupOpenProcessing(admin);
    await lockPartial(admin);
    const rpcSnap = await snapshotState(admin);

    await cleanup(admin, pgClient);
    await postPayrollLockFinanceEntries(admin, period!, rows, DAVORS, {
      markStaffSalariesPaid: false,
    });
    const { data: jsSal } = await admin
      .from("expense_register")
      .select("amount, payment_status")
      .eq("tenant_id", DAVORS)
      .eq("receipt_no", SAL_RECEIPT)
      .maybeSingle();
    const { data: jsEssnit } = await admin
      .from("expense_register")
      .select("amount, payment_status")
      .eq("tenant_id", DAVORS)
      .eq("receipt_no", ESSNIT_RECEIPT)
      .maybeSingle();
    const { data: jsDed } = await admin
      .from("income_register")
      .select("amount")
      .eq("tenant_id", DAVORS)
      .eq("invoice_no", DEDSAV_INVOICE)
      .maybeSingle();
    const { data: jsTax } = await admin
      .from("tax_ledger_entries")
      .select("tax_component, tax_amount")
      .eq("tenant_id", DAVORS)
      .eq("source_type", "payroll_period")
      .eq("source_id", TAX_SOURCE_ID);

    results.push({
      name: "Parity: RPC SAL amount/status matches legacy JS",
      ok:
        r2(rpcSnap.sal?.amount) === r2(jsSal?.amount) &&
        rpcSnap.sal?.payment_status === jsSal?.payment_status &&
        r2(rpcSnap.sal?.amount) === totals.totalStaffSalariesExpense,
      detail: { rpc: rpcSnap.sal, js: jsSal, expected: totals.totalStaffSalariesExpense },
    });

    results.push({
      name: "Parity: RPC ESSNIT amount matches legacy JS",
      ok:
        r2(rpcSnap.essnit?.amount) === r2(jsEssnit?.amount) &&
        r2(rpcSnap.essnit?.amount) === totals.totalEmployerSsnitContribution,
      detail: {
        rpc: rpcSnap.essnit,
        js: jsEssnit,
        expected: totals.totalEmployerSsnitContribution,
      },
    });

    results.push({
      name: "Parity: deduction savings + tax legs match legacy JS",
      ok:
        r2(rpcSnap.ded?.amount) === r2(jsDed?.amount) &&
        rpcSnap.tax.length === (jsTax ?? []).length &&
        rpcSnap.tax.every((leg) => {
          const match = (jsTax ?? []).find((j) => j.tax_component === leg.tax_component);
          return match && r2(match.tax_amount) === r2(leg.tax_amount);
        }),
      detail: {
        rpcDed: rpcSnap.ded,
        jsDed,
        rpcTax: rpcSnap.tax,
        jsTax,
        expectedDed: totals.totalDeductionSavings,
      },
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
      throw new Error("One or more staging tests failed");
    }

    console.log("\nAll atomic payroll lock/reopen staging tests passed.");
  } finally {
    await cleanup(admin, pgClient);
    await pgClient.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
