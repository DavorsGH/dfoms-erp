/**
 * Staging: unmapped expense_category → P&L Other fallback + Nextronics-style BS parity.
 *
 * Usage: npx tsx scripts/test-unmapped-expense-category-staging.ts
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
} from "../app/dashboard/finance/balance-sheet-utils";
import {
  buildProfitLossReport,
  isMappedProfitLossExpenseCategory,
  resolveProfitLossExpenseSectionCategory,
} from "../app/dashboard/finance/profit-loss-utils";
import {
  fetchPayrollLiveRecalcBundle,
  mergePayrollWagesWithLiveOpenMonths,
} from "../app/dashboard/hr-payroll/payroll-live-recalc-utils";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const TENANT = "00000001-0000-4000-8000-000000000001";
const YEAR = 2026;
const MONTH_INDEX = 11; // December
const TEST_DATE = `${YEAR}-12-20`;
const TEST_AMOUNT = 200;
const UNMAPPED_CATEGORY = "Electronics";

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

function rowAmount(report, key, mi) {
  return report.rows.find((r) => r.key === key)?.amounts[mi] ?? 0;
}

const emptyInv = {
  config: null,
  rawMaterials: [],
  finishedProducts: [],
  finishedProductAverageCosts: [],
  cashPurchases: [],
  productCashPurchases: [],
};

function runInMemoryProof() {
  console.log("=== In-memory: Nextronics-style unmapped category ===");
  assert(
    !isMappedProfitLossExpenseCategory(UNMAPPED_CATEGORY),
    "Electronics must be unmapped for this test",
  );
  assert(
    resolveProfitLossExpenseSectionCategory(UNMAPPED_CATEGORY) === "Other",
    "Electronics must resolve to Other",
  );

  const expense = [
    {
      date: TEST_DATE,
      expense_category: UNMAPPED_CATEGORY,
      sub_category: "Phone Case",
      amount: TEST_AMOUNT,
      payment_status: "Paid",
      description: "Test",
      receipt_no: null,
      notes: null,
    },
  ];

  const pl = buildProfitLossReport([], expense, [], YEAR);
  const netProfit = pl.rows.find((r) => r.key === "net-profit")?.amounts[MONTH_INDEX] ?? 0;
  assert(
    almostEqual(netProfit, -TEST_AMOUNT),
    `P&L net profit should be -${TEST_AMOUNT}, got ${netProfit}`,
  );

  const otherLine = pl.rows.find((r) =>
    r.label.includes("Electronics") && r.label.includes("Phone Case"),
  );
  assert(otherLine, "Expense should appear under Other with category prefix label");

  const bs = buildBalanceSheetReport(
    [],
    expense,
    [],
    [],
    [],
    expense,
    [],
    [],
    YEAR,
    emptyInv,
  );
  const check = getBalanceCheckForPeriod(bs, MONTH_INDEX);
  console.log({
    cash: rowAmount(bs, "cash", MONTH_INDEX),
    retainedEarnings: rowAmount(bs, "retained-earnings", MONTH_INDEX),
    diff: check.difference,
    balanced: check.isBalanced,
    otherPnlLine: otherLine?.label,
  });
  assert(check.isBalanced, `BS should balance; diff=${check.difference}`);
  assert(
    almostEqual(rowAmount(bs, "retained-earnings", MONTH_INDEX), -TEST_AMOUNT),
    "Retained earnings should reflect expense",
  );
  console.log("PASS in-memory unmapped category → Other + balanced BS");
}

async function scanUnmappedCategories(admin, label: string) {
  const { data: lookupCats } = await admin
    .from("expense_categories")
    .select("name")
    .order("name");
  const lookupUnmapped = (lookupCats ?? [])
    .map((c) => c.name)
    .filter((name) => !isMappedProfitLossExpenseCategory(name));

  const { data: expenseRows } = await admin
    .from("expense_register")
    .select("tenant_id, expense_category, amount, date");

  const usedCategories = new Map<
    string,
    { tenants: Set<string>; rowCount: number; totalAmount: number }
  >();
  for (const row of expenseRows ?? []) {
    const cat = (row.expense_category ?? "").trim();
    if (!cat || isMappedProfitLossExpenseCategory(cat)) continue;
    const bucket = usedCategories.get(cat) ?? {
      tenants: new Set<string>(),
      rowCount: 0,
      totalAmount: 0,
    };
    bucket.tenants.add(row.tenant_id);
    bucket.rowCount += 1;
    bucket.totalAmount += Number(row.amount) || 0;
    usedCategories.set(cat, bucket);
  }

  console.log(`\n=== ${label}: lookup categories without P&L mapping ===`);
  console.log(lookupUnmapped);

  console.log(`\n=== ${label}: unmapped categories used in expense_register ===`);
  for (const [cat, stats] of [...usedCategories.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    console.log(
      JSON.stringify({
        category: cat,
        tenantCount: stats.tenants.size,
        rowCount: stats.rowCount,
        totalAmount: Math.round(stats.totalAmount * 100) / 100,
      }),
    );
  }

  return { lookupUnmapped, usedCategories };
}

async function fetchPayrollHistory(admin, tenantId: string) {
  const preferred = await admin
    .from("payroll_history")
    .select("payroll_month, net_pay, net_only_adjustment")
    .eq("tenant_id", tenantId);
  if (!preferred.error) return preferred.data ?? [];
  const fallback = await admin
    .from("payroll_history")
    .select("payroll_month, net_pay")
    .eq("tenant_id", tenantId);
  if (fallback.error) throw new Error(fallback.error.message);
  return (fallback.data ?? []).map((row) => ({
    payroll_month: row.payroll_month,
    net_pay: row.net_pay,
    net_only_adjustment: 0,
  }));
}

async function buildTenantBs(admin, tenantId: string, extraExpenses = []) {
  const [
    { data: income },
    { data: expenses },
    { data: fixedAssets },
    { data: payables },
    { data: capital },
    { data: manual },
    { data: payrollProcessing },
    { data: monthEndClose },
    { data: invConfig },
    { data: rawPurchases },
    { data: productPurchases },
    { data: taxLedger },
    livePayrollBundle,
  ] = await Promise.all([
    admin.from("income_register").select("*").eq("tenant_id", tenantId),
    admin.from("expense_register").select("*").eq("tenant_id", tenantId),
    admin.from("fixed_assets").select("*").eq("tenant_id", tenantId),
    admin.from("accounts_payable").select("*").eq("tenant_id", tenantId),
    admin.from("capital_contributions").select("*").eq("tenant_id", tenantId),
    admin.from("manual_financial_entries").select("*").eq("tenant_id", tenantId),
    admin.from("payroll_processing").select("*").eq("tenant_id", tenantId),
    admin.from("month_end_close").select("*").eq("tenant_id", tenantId),
    admin
      .from("inventory_balance_config")
      .select("*")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    admin.from("raw_material_purchases").select("*").eq("tenant_id", tenantId),
    admin.from("product_purchases").select("*").eq("tenant_id", tenantId),
    admin
      .from("tax_ledger_entries")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("status", "open"),
    fetchPayrollLiveRecalcBundle(admin, { tenantId }),
  ]);

  const payrollHistory = await fetchPayrollHistory(admin, tenantId);
  const payrollMerged = mergePayrollWagesWithLiveOpenMonths(
    payrollHistory,
    payrollProcessing ?? [],
    livePayrollBundle.employees,
    livePayrollBundle.liveContext,
  );

  const allExpenses = [...(expenses ?? []), ...extraExpenses];
  const cashFlowExpenses = allExpenses.map((e) => ({
    date: e.date,
    expense_category: e.expense_category ?? "",
    sub_category: e.sub_category,
    amount: e.amount,
    payment_status: e.payment_status,
    description: e.description ?? null,
    receipt_no: e.receipt_no ?? null,
    notes: e.notes ?? null,
  }));

  const inventoryConfig = invConfig
    ? {
        go_live_date: invConfig.go_live_date,
        opening_inventory_value: Number(invConfig.opening_inventory_value) || 0,
        created_at: invConfig.created_at,
      }
    : null;

  return buildBalanceSheetReport(
    income ?? [],
    allExpenses,
    fixedAssets ?? [],
    payables ?? [],
    capital ?? [],
    cashFlowExpenses,
    payrollMerged,
    monthEndClose ?? [],
    YEAR,
    {
      config: inventoryConfig,
      rawMaterials: [],
      finishedProducts: [],
      finishedProductAverageCosts: [],
      cashPurchases: rawPurchases ?? [],
      productCashPurchases: productPurchases ?? [],
    },
    manual ?? [],
    taxLedger ?? [],
  );
}

async function runLiveStagingTest(admin) {
  const receipt = `TEST-UNMAPPED-${Date.now()}`;
  const payload = {
    tenant_id: TENANT,
    date: TEST_DATE,
    expense_category: UNMAPPED_CATEGORY,
    sub_category: "Phone Case",
    amount: TEST_AMOUNT,
    payment_status: "Paid",
    description: "[TEST] unmapped category fallback",
    receipt_no: receipt,
    notes: "Auto test — delete after run",
  };

  console.log("\n=== Live staging: insert unmapped Paid expense ===");
  const before = getBalanceCheckForPeriod(
    await buildTenantBs(admin, TENANT),
    MONTH_INDEX,
  );

  let expenseId: string | null = null;
  try {
    const { data, error } = await admin
      .from("expense_register")
      .insert(payload)
      .select("id")
      .single();
    assert(!error, error?.message ?? "insert failed");
    expenseId = data.id;

    const afterReport = await buildTenantBs(admin, TENANT);
    const after = getBalanceCheckForPeriod(afterReport, MONTH_INDEX);
    console.log({
      beforeDiff: before.difference,
      afterDiff: after.difference,
      deltaDiff: Math.round((after.difference - before.difference) * 100) / 100,
      afterBalanced: after.isBalanced,
    });
    assert(
      almostEqual(after.difference, before.difference),
      "Unmapped Paid expense should not widen BS diff",
    );
    console.log("PASS live staging unmapped category BS parity");
  } finally {
    if (expenseId) {
      await admin.from("expense_register").delete().eq("id", expenseId);
      console.log("Cleanup OK");
    }
  }
}

async function main() {
  runInMemoryProof();

  loadEnvForce(resolve(process.cwd(), ".env.staging.local"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert(url?.includes(STAGING_REF), "Refusing non-staging");
  assert(key, "Missing service role key");

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  await scanUnmappedCategories(admin, "Staging");
  await runLiveStagingTest(admin);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
