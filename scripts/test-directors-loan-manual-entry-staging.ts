/**
 * Staging: Director's Loan Manual Entry → Cash ↑ + BS liability + balance.
 *
 * Applies scripts/144_manual_entries_directors_loan.sql if needed, then:
 *   1. Baseline BS for test month
 *   2. Upserts directors_loan + matching loan_proceeds on a Manual Entry
 *   3. Asserts Cash ↑ by amount, Director's Loan line = amount, BS balanced
 *   4. Restores prior Manual Entry state (or deletes if we inserted)
 *
 * Usage: npx tsx scripts/test-directors-loan-manual-entry-staging.ts
 * Staging only — refuses non-staging URL. Does not touch production.
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
} from "../app/dashboard/finance/balance-sheet-utils";
import {
  fetchPayrollLiveRecalcBundle,
  mergePayrollWagesWithLiveOpenMonths,
} from "../app/dashboard/hr-payroll/payroll-live-recalc-utils";
import type { PayrollProcessingRow } from "../app/dashboard/hr-payroll/payroll-processing-utils";
import type { InventoryBalanceConfig } from "../app/dashboard/inventory/inventory-balance-sheet-utils";
import type { PayrollHistoryWagesEntry } from "../app/dashboard/finance/accrued-wages-utils";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const TENANT = "00000001-0000-4000-8000-000000000001"; // Davors
const YEAR = 2026;
/** Use December — typically quieter; still FY 2026. */
const TEST_MONTH = 12; // 1-based
const MONTH_INDEX = TEST_MONTH - 1;
const PERIOD = `${YEAR}-${String(TEST_MONTH).padStart(2, "0")}-01`;
const TEST_AMOUNT = 12_345.67;

function loadEnvForce(filePath: string) {
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

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function almostEqual(a: number, b: number, eps = 0.02): boolean {
  return Math.abs(a - b) <= eps;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function rowAmount(
  report: { rows: Array<{ key: string; amounts: number[] }> },
  key: string,
  monthIndex: number,
): number {
  return report.rows.find((r) => r.key === key)?.amounts[monthIndex] ?? 0;
}

function rebuildUrl(rawUrl: string) {
  const parsed = new URL(rawUrl);
  parsed.password = encodeURIComponent(decodeURIComponent(parsed.password));
  return parsed.toString();
}

type PgTarget = { label: string; connectionString?: string; config?: pg.ClientConfig };

function buildPgTargets(projectRef: string): PgTarget[] {
  const targets: PgTarget[] = [];
  const rawUrl = process.env.DATABASE_URL;
  if (rawUrl) {
    targets.push({ label: "DATABASE_URL", connectionString: rawUrl });
    targets.push({
      label: "DATABASE_URL rebuilt",
      connectionString: rebuildUrl(rawUrl),
    });
    try {
      const parsed = new URL(rawUrl);
      const password = decodeURIComponent(parsed.password);
      targets.push({
        label: "DATABASE_URL params",
        config: {
          host: parsed.hostname,
          port: Number(parsed.port || 5432),
          user: decodeURIComponent(parsed.username),
          password,
          database: (parsed.pathname || "/postgres").replace(/^\//, "") || "postgres",
          ssl: { rejectUnauthorized: false },
        },
      });
      for (const region of ["eu-west-1", "eu-north-1"]) {
        targets.push({
          label: `pooler ${region}`,
          config: {
            host: `aws-0-${region}.pooler.supabase.com`,
            port: 5432,
            user: `postgres.${projectRef}`,
            password,
            database: "postgres",
            ssl: { rejectUnauthorized: false },
          },
        });
      }
    } catch {
      // ignore malformed URL
    }
  }
  return targets;
}

async function applyDirectorsLoanColumn(projectRef: string) {
  const sql = readFileSync(
    resolve(process.cwd(), "scripts/144_manual_entries_directors_loan.sql"),
    "utf8",
  );
  const envFiles = [".env.staging.local", ".env.local"];
  let lastErr: unknown = null;

  for (const envFile of envFiles) {
    try {
      loadEnvForce(resolve(process.cwd(), envFile));
    } catch {
      console.warn(`Skipping missing ${envFile}`);
      continue;
    }
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
    if (!url.includes(projectRef)) {
      console.warn(`Skipping ${envFile}: not staging project`);
      continue;
    }
    const targets = buildPgTargets(projectRef);
    for (const [index, target] of targets.entries()) {
      const client = new pg.Client(
        target.config ?? {
          connectionString: target.connectionString,
          ssl: { rejectUnauthorized: false },
        },
      );
      try {
        await client.connect();
        await client.query(sql);
        await client.end();
        console.log(
          `Applied 144 via ${envFile} candidate ${index} (${target.label})`,
        );
        return;
      } catch (err) {
        lastErr = err;
        const msg = err instanceof Error ? err.message : String(err);
        console.warn(
          `DDL ${envFile} candidate ${index} (${target.label}) failed: ${msg}`,
        );
        try {
          await client.end();
        } catch {
          /* ignore */
        }
      }
    }
  }

  throw new Error(
    `Failed to apply 144: ${
      lastErr instanceof Error ? lastErr.message : String(lastErr)
    }. Apply scripts/144_manual_entries_directors_loan.sql in the Supabase SQL Editor on staging, then re-run.`,
  );
}

/** Prefer app select; fall back when staging has not applied 116 yet. */
async function fetchPayrollHistoryWages(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  admin: any,
  tenantId: string,
): Promise<PayrollHistoryWagesEntry[]> {
  const preferred = await admin
    .from("payroll_history")
    .select("payroll_month, net_pay, net_only_adjustment")
    .eq("tenant_id", tenantId);
  if (!preferred.error) {
    return (preferred.data as PayrollHistoryWagesEntry[] | null) ?? [];
  }
  if (!String(preferred.error.message).includes("net_only_adjustment")) {
    throw new Error(`payroll_history: ${preferred.error.message}`);
  }
  const fallback = await admin
    .from("payroll_history")
    .select("payroll_month, net_pay")
    .eq("tenant_id", tenantId);
  if (fallback.error) {
    throw new Error(`payroll_history: ${fallback.error.message}`);
  }
  return (
    (fallback.data as Array<{ payroll_month: string; net_pay: number }> | null) ??
    []
  ).map((row) => ({
    payroll_month: row.payroll_month,
    net_pay: row.net_pay,
    net_only_adjustment: 0,
  }));
}

loadEnvForce(resolve(process.cwd(), ".env.staging.local"));

function runInMemoryProof() {
  console.log("=== In-memory: loan_proceeds cash + liability stock on BS ===");
  const emptyInv = {
    config: null,
    rawMaterials: [],
    finishedProducts: [],
    finishedProductAverageCosts: [],
    cashPurchases: [],
    productCashPurchases: [],
  };

  const baseline = buildBalanceSheetReport(
    [],
    [],
    [],
    [],
    [],
    [],
    [],
    [],
    YEAR,
    emptyInv,
    [],
    [],
  );
  const after = buildBalanceSheetReport(
    [],
    [],
    [],
    [],
    [],
    [],
    [],
    [],
    YEAR,
    emptyInv,
    [
      {
        period_month: PERIOD,
        loan_proceeds: TEST_AMOUNT,
        directors_loan: TEST_AMOUNT,
        bank_loans: 100,
        other_long_term_liabilities: 200,
      },
    ],
    [],
  );
  const balanced = buildBalanceSheetReport(
    [],
    [],
    [],
    [],
    [],
    [],
    [],
    [],
    YEAR,
    emptyInv,
    [
      {
        period_month: PERIOD,
        loan_proceeds: TEST_AMOUNT,
        directors_loan: TEST_AMOUNT,
      },
    ],
    [],
  );

  const cashBefore = rowAmount(baseline, "cash", MONTH_INDEX);
  const cashAfter = rowAmount(after, "cash", MONTH_INDEX);
  const directors = rowAmount(after, "directors-loan", MONTH_INDEX);
  const bankLoans = rowAmount(after, "bank-loans", MONTH_INDEX);
  const otherLtl = rowAmount(after, "other-long-term-liabilities", MONTH_INDEX);
  const check = getBalanceCheckForPeriod(balanced, MONTH_INDEX);

  console.log(
    JSON.stringify(
      {
        cashBefore,
        cashAfter,
        deltaCash: round2(cashAfter - cashBefore),
        directorsLoan: directors,
        bankLoans,
        otherLongTermLiabilities: otherLtl,
        balancedBsDiff: check.difference,
        balancedBsOk: check.isBalanced,
      },
      null,
      2,
    ),
  );

  assert(almostEqual(cashAfter - cashBefore, TEST_AMOUNT), "loan_proceeds must lift Cash");
  assert(almostEqual(directors, TEST_AMOUNT), "directors_loan must appear on BS");
  assert(almostEqual(bankLoans, 100), "bank_loans must appear on BS");
  assert(almostEqual(otherLtl, 200), "other_long_term_liabilities must appear on BS");
  assert(check.isBalanced, `loan_proceeds+directors_loan should balance; diff=${check.difference}`);
  console.log("PASS in-memory Directors Loan + bank_loans + other LTL wiring");
}

function runInMemoryCarryForwardProof() {
  console.log("\n=== In-memory: August entry carries Director's Loan Sep–Dec ===");
  const emptyInv = {
    config: null,
    rawMaterials: [],
    finishedProducts: [],
    finishedProductAverageCosts: [],
    cashPurchases: [],
    productCashPurchases: [],
  };
  const CARRY_AMOUNT = 1600;

  const report = buildBalanceSheetReport(
    [],
    [],
    [],
    [],
    [],
    [],
    [],
    [],
    YEAR,
    emptyInv,
    [
      {
        period_month: "2026-08-01",
        loan_proceeds: CARRY_AMOUNT,
        directors_loan: CARRY_AMOUNT,
      },
    ],
    [],
  );

  const augIndex = 7;
  const augDl = rowAmount(report, "directors-loan", augIndex);
  assert(almostEqual(augDl, CARRY_AMOUNT), `Aug directors_loan=${augDl}`);

  for (const monthIndex of [8, 9, 10, 11]) {
    const dl = rowAmount(report, "directors-loan", monthIndex);
    const check = getBalanceCheckForPeriod(report, monthIndex);
    assert(
      almostEqual(dl, CARRY_AMOUNT),
      `Month ${monthIndex + 1} directors_loan=${dl}, expected ${CARRY_AMOUNT}`,
    );
    assert(
      check.isBalanced,
      `Month ${monthIndex + 1} BS should balance; diff=${check.difference}`,
    );
  }

  // Explicit Sep zero clears liability for rest of FY
  const cleared = buildBalanceSheetReport(
    [],
    [],
    [],
    [],
    [],
    [],
    [],
    [],
    YEAR,
    emptyInv,
    [
      {
        period_month: "2026-08-01",
        loan_proceeds: CARRY_AMOUNT,
        directors_loan: CARRY_AMOUNT,
      },
      { period_month: "2026-09-01", directors_loan: 0 },
    ],
    [],
  );
  for (const monthIndex of [8, 9, 10, 11]) {
    assert(
      almostEqual(rowAmount(cleared, "directors-loan", monthIndex), 0),
      `Sep–Dec after repayment month ${monthIndex + 1} should be 0`,
    );
  }

  console.log("PASS in-memory carry-forward Aug→Sep–Dec + Sep zero override");
}

async function buildStagingSnapshot(admin, options: { year?: number; monthIndex?: number } = {}) {
  const year = options.year ?? YEAR;
  const monthIndex = options.monthIndex ?? MONTH_INDEX;
  const [
    { data: income, error: incomeError },
    { data: expenses, error: expenseError },
    { data: fixedAssets, error: faError },
    { data: payables, error: apError },
    { data: capital, error: capitalError },
    { data: manual, error: manualError },
    { data: payrollProcessing },
    { data: monthEndClose },
    { data: invConfig },
    { data: rawPurchases },
    { data: productPurchases },
    { data: taxLedger, error: taxError },
    livePayrollBundle,
  ] = await Promise.all([
    admin
      .from("income_register")
      .select(
        "date, amount, amount_received, outstanding_balance, wht_amount, service_category, entry_type, sale_status, net_of_tax_amount, output_vat_amount",
      )
      .eq("tenant_id", TENANT),
    admin
      .from("expense_register")
      .select(
        "date, amount, expense_category, sub_category, payment_status, description, receipt_no, notes, net_of_tax_amount, input_vat_amount",
      )
      .eq("tenant_id", TENANT),
    admin
      .from("fixed_assets")
      .select(
        "original_cost, quantity, useful_life_years, purchase_date, depreciation_method",
      )
      .eq("tenant_id", TENANT),
    admin
      .from("accounts_payable")
      .select(
        "invoice_date, invoice_number, amount, amount_paid, balance_due, expense_category, vendor_name",
      )
      .eq("tenant_id", TENANT),
    admin
      .from("capital_contributions")
      .select("id, date, amount, contributed_by, description, notes")
      .eq("tenant_id", TENANT),
    admin
      .from("manual_financial_entries")
      .select("*")
      .eq("tenant_id", TENANT),
    admin
      .from("payroll_processing")
      .select("payroll_month, net_pay, employee_id")
      .eq("tenant_id", TENANT),
    admin
      .from("month_end_close")
      .select("month, total_net_pay, lock_status")
      .eq("tenant_id", TENANT),
    admin
      .from("inventory_balance_config")
      .select("go_live_date, opening_inventory_value, created_at")
      .eq("tenant_id", TENANT)
      .maybeSingle(),
    admin
      .from("raw_material_purchases")
      .select("purchase_date, total_cost, payment_method, created_at")
      .eq("tenant_id", TENANT),
    admin
      .from("product_purchases")
      .select("purchase_date, total_cost, payment_method, created_at")
      .eq("tenant_id", TENANT),
    admin
      .from("tax_ledger_entries")
      .select("entry_date, direction, tax_component, tax_amount, status")
      .eq("tenant_id", TENANT)
      .eq("status", "open")
      .order("entry_date"),
    fetchPayrollLiveRecalcBundle(admin, { tenantId: TENANT }),
  ]);

  for (const [label, err] of [
    ["income", incomeError],
    ["expense", expenseError],
    ["fa", faError],
    ["ap", apError],
    ["capital", capitalError],
    ["manual", manualError],
    ["tax", taxError],
  ]) {
    if (err) throw new Error(`${label}: ${err.message}`);
  }

  const payrollHistory = await fetchPayrollHistoryWages(admin, TENANT);
  const payrollMerged = mergePayrollWagesWithLiveOpenMonths(
    payrollHistory,
    (payrollProcessing) ?? [],
    livePayrollBundle.employees,
    livePayrollBundle.liveContext,
  );

  const inventoryConfig = invConfig
    ? {
        go_live_date: invConfig.go_live_date,
        opening_inventory_value: Number(invConfig.opening_inventory_value) || 0,
        created_at: invConfig.created_at,
      }
    : null;

  const cashFlowExpenses = (expenses ?? []).map((entry) => ({
    date: entry.date,
    expense_category: entry.expense_category ?? "",
    sub_category: entry.sub_category,
    amount: entry.amount,
    payment_status: entry.payment_status,
    description: entry.description ?? null,
    receipt_no: entry.receipt_no ?? null,
    notes: entry.notes ?? null,
  }));

  const inventoryInput = {
    config: inventoryConfig,
    rawMaterials: [],
    finishedProducts: [],
    finishedProductAverageCosts: [],
    cashPurchases: rawPurchases ?? [],
    productCashPurchases: productPurchases ?? [],
  };

  const bs = buildBalanceSheetReport(
    income ?? [],
    expenses ?? [],
    fixedAssets ?? [],
    payables ?? [],
    capital ?? [],
    cashFlowExpenses,
    payrollMerged,
    monthEndClose ?? [],
    year,
    inventoryInput,
    manual ?? [],
    taxLedger ?? [],
  );

  const check = getBalanceCheckForPeriod(bs, monthIndex);
  return {
    cash: rowAmount(bs, "cash", monthIndex),
    directorsLoan: rowAmount(bs, "directors-loan", monthIndex),
    bankLoans: rowAmount(bs, "bank-loans", monthIndex),
    otherLtl: rowAmount(bs, "other-long-term-liabilities", monthIndex),
    bsDiff: check.difference,
    bsBalanced: check.isBalanced,
    hasDirectorsRow: Boolean(bs.rows.find((r) => r.key === "directors-loan")),
    hasBankLoansRow: Boolean(bs.rows.find((r) => r.key === "bank-loans")),
    hasOtherLtlRow: Boolean(
      bs.rows.find((r) => r.key === "other-long-term-liabilities"),
    ),
    report: bs,
  };
}

async function runLiveCarryForwardStagingTest(admin) {
  const EPHEMERAL_YEAR = 2099;
  const AUG_PERIOD = `${EPHEMERAL_YEAR}-08-01`;
  const CARRY_AMOUNT = 7777.01;
  const STAMP = `DL-CARRY-FWD-${Date.now()}`;

  console.log("\n=== Live staging: Aug 2099 entry → Sep–Dec carry-forward ===");

  const { data: existing, error: existingErr } = await admin
    .from("manual_financial_entries")
    .select("*")
    .eq("tenant_id", TENANT)
    .eq("period_month", AUG_PERIOD)
    .maybeSingle();
  assert(!existingErr, `lookup Aug 2099: ${existingErr?.message}`);

  const prior = existing
    ? {
        loan_proceeds: Number(existing.loan_proceeds) || 0,
        directors_loan: Number(existing.directors_loan) || 0,
        notes: existing.notes ?? null,
      }
    : null;

  try {
    if (prior) {
      const { error: updErr } = await admin
        .from("manual_financial_entries")
        .update({
          loan_proceeds: CARRY_AMOUNT,
          directors_loan: CARRY_AMOUNT,
          notes: STAMP,
        })
        .eq("tenant_id", TENANT)
        .eq("period_month", AUG_PERIOD);
      assert(!updErr, `update Aug 2099: ${updErr?.message}`);
    } else {
      const { error: insErr } = await admin.from("manual_financial_entries").insert({
        tenant_id: TENANT,
        period_month: AUG_PERIOD,
        loan_proceeds: CARRY_AMOUNT,
        directors_loan: CARRY_AMOUNT,
        notes: STAMP,
      });
      assert(!insErr, `insert Aug 2099: ${insErr?.message}`);
    }

    const aug = await buildStagingSnapshot(admin, {
      year: EPHEMERAL_YEAR,
      monthIndex: 7,
    });
    assert(
      almostEqual(aug.directorsLoan, CARRY_AMOUNT),
      `Aug directors_loan=${aug.directorsLoan}`,
    );

    for (const monthIndex of [8, 9, 10, 11]) {
      const snap = await buildStagingSnapshot(admin, {
        year: EPHEMERAL_YEAR,
        monthIndex,
      });
      assert(
        almostEqual(snap.directorsLoan, CARRY_AMOUNT),
        `Month ${monthIndex + 1} directors_loan=${snap.directorsLoan}, want ${CARRY_AMOUNT}`,
      );
    }

    console.log("PASS live staging: Director's Loan carried Aug→Sep–Dec 2099");
  } finally {
    if (prior) {
      await admin
        .from("manual_financial_entries")
        .update({
          loan_proceeds: prior.loan_proceeds,
          directors_loan: prior.directors_loan,
          notes: prior.notes,
        })
        .eq("tenant_id", TENANT)
        .eq("period_month", AUG_PERIOD);
    } else {
      await admin
        .from("manual_financial_entries")
        .delete()
        .eq("tenant_id", TENANT)
        .eq("period_month", AUG_PERIOD);
    }
    console.log("Live carry-forward test cleanup OK");
  }
}

async function runLiveLiabilityCashTest(admin, options) {
  const { liabilityField, liabilityRowKey, label } = options;

  const { data: existing, error: existingErr } = await admin
    .from("manual_financial_entries")
    .select("*")
    .eq("tenant_id", TENANT)
    .eq("period_month", PERIOD)
    .maybeSingle();
  assert(!existingErr, `lookup period: ${existingErr?.message}`);

  const prior = existing
    ? {
        loan_proceeds: Number(existing.loan_proceeds) || 0,
        [liabilityField]: Number(existing[liabilityField]) || 0,
      }
    : null;

  console.log(`\n=== Baseline BS ${PERIOD} (before) ===`);
  const before = await buildStagingSnapshot(admin);
  const beforeLiability =
    liabilityRowKey === "directors-loan"
      ? before.directorsLoan
      : liabilityRowKey === "bank-loans"
        ? before.bankLoans
        : before.otherLtl;

  console.log(
    JSON.stringify(
      {
        cash: before.cash,
        [liabilityField]: beforeLiability,
        bsDiff: before.bsDiff,
        bsBalanced: before.bsBalanced,
        liabilityRowsPresent: {
          directorsLoan: before.hasDirectorsRow,
          bankLoans: before.hasBankLoansRow,
          otherLongTermLiabilities: before.hasOtherLtlRow,
        },
      },
      null,
      2,
    ),
  );

  assert(before.hasBankLoansRow, "BS missing bank-loans row");
  assert(before.hasOtherLtlRow, "BS missing other-long-term-liabilities row");
  assert(before.hasDirectorsRow, "BS missing directors-loan row");

  let wrote = false;
  try {
    const targetProceeds = round2((prior?.loan_proceeds ?? 0) + TEST_AMOUNT);
    const targetLiability = round2((prior?.[liabilityField] ?? 0) + TEST_AMOUNT);

    if (prior) {
      const { error: updErr } = await admin
        .from("manual_financial_entries")
        .update({
          loan_proceeds: targetProceeds,
          [liabilityField]: targetLiability,
        })
        .eq("period_month", PERIOD)
        .eq("tenant_id", TENANT);
      assert(!updErr, `update manual entry: ${updErr?.message}`);
    } else {
      const { error: insErr } = await admin.from("manual_financial_entries").insert({
        tenant_id: TENANT,
        period_month: PERIOD,
        loan_proceeds: TEST_AMOUNT,
        [liabilityField]: TEST_AMOUNT,
      });
      assert(!insErr, `insert manual entry: ${insErr?.message}`);
    }
    wrote = true;

    console.log(`\n=== After ${label} + loan_proceeds += ${TEST_AMOUNT} ===`);
    const after = await buildStagingSnapshot(admin);
    const afterLiability =
      liabilityRowKey === "directors-loan"
        ? after.directorsLoan
        : liabilityRowKey === "bank-loans"
          ? after.bankLoans
          : after.otherLtl;

    console.log(
      JSON.stringify(
        {
          cash: after.cash,
          [liabilityField]: afterLiability,
          bsDiff: after.bsDiff,
          bsBalanced: after.bsBalanced,
          deltaCash: round2(after.cash - before.cash),
          deltaLiability: round2(afterLiability - beforeLiability),
        },
        null,
        2,
      ),
    );

    assert(
      almostEqual(after.cash - before.cash, TEST_AMOUNT),
      `Cash should ↑ by ${TEST_AMOUNT}, got Δ=${round2(after.cash - before.cash)}`,
    );
    assert(
      almostEqual(afterLiability - beforeLiability, TEST_AMOUNT),
      `${label} should ↑ by ${TEST_AMOUNT}, got Δ=${round2(afterLiability - beforeLiability)}`,
    );
    assert(
      almostEqual(after.bsDiff, before.bsDiff),
      `BS diff should be unchanged by matched Cash+liability (before=${before.bsDiff}, after=${after.bsDiff})`,
    );
    if (before.bsBalanced) {
      assert(after.bsBalanced, `BS should stay balanced; diff=${after.bsDiff}`);
    }

    console.log(`\nPASS live: Cash ↑, ${label} on BS, BS diff unchanged`);
    return { before, after, beforeLiability, afterLiability };
  } finally {
    if (wrote) {
      console.log("\n=== Cleanup: restore Manual Entry ===");
      if (prior) {
        const { error: restoreErr } = await admin
          .from("manual_financial_entries")
          .update({
            loan_proceeds: prior.loan_proceeds,
            [liabilityField]: prior[liabilityField],
          })
          .eq("period_month", PERIOD)
          .eq("tenant_id", TENANT);
        assert(!restoreErr, `restore: ${restoreErr?.message}`);
      } else {
        const { error: delErr } = await admin
          .from("manual_financial_entries")
          .delete()
          .eq("tenant_id", TENANT)
          .eq("period_month", PERIOD);
        assert(!delErr, `delete test row: ${delErr?.message}`);
      }

      const cleaned = await buildStagingSnapshot(admin);
      assert(
        almostEqual(cleaned.cash, before.cash),
        `Cash after cleanup ${cleaned.cash} != before ${before.cash}`,
      );
      console.log("Cleanup OK — staging Manual Entry restored");
    }
  }
}

async function main() {
  runInMemoryProof();
  runInMemoryCarryForwardProof();

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert(url, "Missing NEXT_PUBLIC_SUPABASE_URL");
  assert(url.includes(STAGING_REF), "Refusing non-staging");
  assert(key, "Missing service role key");

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log("\n=== Ensure directors_loan column on staging ===");
  let columnReady = false;
  {
    const { error: colErr } = await admin
      .from("manual_financial_entries")
      .select("directors_loan")
      .limit(0);
    if (!colErr) {
      console.log("directors_loan already present — skipping DDL");
      columnReady = true;
    } else {
      console.log(
        "column missing (" + (colErr.message || colErr.code) + ") — applying 144",
      );
      try {
        await applyDirectorsLoanColumn(STAGING_REF);
        const { error: verifyErr } = await admin
          .from("manual_financial_entries")
          .select("directors_loan")
          .limit(0);
        assert(!verifyErr, `Column still missing after DDL: ${verifyErr?.message}`);
        columnReady = true;
      } catch (ddlErr) {
        console.warn(
          "DDL blocked:",
          ddlErr instanceof Error ? ddlErr.message : String(ddlErr),
        );
        console.warn(
          "Apply scripts/144_manual_entries_directors_loan.sql in Supabase SQL Editor (staging wieflwbfdmjtsdnwbfii), then re-run this test.",
        );
      }
    }
  }

  if (!columnReady) {
    console.log(
      "\n=== Fallback live staging: bank_loans + loan_proceeds (directors_loan column pending) ===",
    );
    await runLiveLiabilityCashTest(admin, {
      liabilityField: "bank_loans",
      liabilityRowKey: "bank-loans",
      label: "Bank Loans",
    });
    throw new Error(
      "SCHEMA_PENDING: directors_loan column not on staging — in-memory Directors Loan proof passed; live bank_loans+loan_proceeds fallback passed. Apply script 144 then re-run for live Directors Loan.",
    );
  }

  await runLiveCarryForwardStagingTest(admin);

  await runLiveLiabilityCashTest(admin, {
    liabilityField: "directors_loan",
    liabilityRowKey: "directors-loan",
    label: "Director's Loan",
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
