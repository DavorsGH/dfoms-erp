/**
 * Staging: Capital Contribution → Cash ↑ + Share Capital ↑ + BS balanced.
 *
 * Mirrors scripts/test-directors-loan-manual-entry-staging.ts:
 *   1. In-memory proof (expense + capital contribution scenario)
 *   2. Live staging: insert test expense + capital contribution, assert BS
 *   3. Cleanup
 *
 * Usage: npx tsx scripts/test-capital-contribution-cash-staging.ts
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
  fetchPayrollLiveRecalcBundle,
  mergePayrollWagesWithLiveOpenMonths,
} from "../app/dashboard/hr-payroll/payroll-live-recalc-utils";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const TENANT = "00000001-0000-4000-8000-000000000001"; // Davors
const YEAR = 2026;
const TEST_MONTH = 12;
const MONTH_INDEX = TEST_MONTH - 1;
const TEST_DATE = `${YEAR}-${String(TEST_MONTH).padStart(2, "0")}-15`;
const TEST_AMOUNT = 200;

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

const emptyInv = {
  config: null,
  rawMaterials: [],
  finishedProducts: [],
  finishedProductAverageCosts: [],
  cashPurchases: [],
  productCashPurchases: [],
};

function runInMemoryProof() {
  console.log("=== In-memory: Paid expense + Capital Contribution ===");
  const expense = [
    {
      date: TEST_DATE,
      expense_category: "Administrative",
      sub_category: "Electronics",
      amount: TEST_AMOUNT,
      payment_status: "Paid",
      description: "Test electronics (personal funds offset)",
      receipt_no: null,
      notes: null,
    },
  ];
  const capital = [
    {
      id: "test-capital",
      date: TEST_DATE,
      contributed_by: "test",
      amount: TEST_AMOUNT,
      description: "Offset personal funds expense",
      notes: null,
    },
  ];

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
  );
  const expenseOnly = buildBalanceSheetReport(
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
  const both = buildBalanceSheetReport(
    [],
    expense,
    [],
    [],
    capital,
    expense,
    [],
    [],
    YEAR,
    emptyInv,
  );
  const capitalOnly = buildBalanceSheetReport(
    [],
    [],
    [],
    [],
    capital,
    [],
    [],
    [],
    YEAR,
    emptyInv,
  );

  const scenarios = [
    ["baseline", baseline],
    ["expense only", expenseOnly],
    ["capital only", capitalOnly],
    ["expense + capital", both],
  ] as const;

  for (const [label, report] of scenarios) {
    const check = getBalanceCheckForPeriod(report, MONTH_INDEX);
    console.log(
      JSON.stringify({
        scenario: label,
        cash: rowAmount(report, "cash", MONTH_INDEX),
        shareCapital: rowAmount(report, "share-capital", MONTH_INDEX),
        retainedEarnings: rowAmount(report, "retained-earnings", MONTH_INDEX),
        totalAssets: check.totalAssets,
        totalLE: check.totalLiabilitiesAndEquity,
        diff: check.difference,
        balanced: check.isBalanced,
      }),
    );
  }

  const cashBefore = rowAmount(baseline, "cash", MONTH_INDEX);
  const cashCapitalOnly =
    rowAmount(capitalOnly, "cash", MONTH_INDEX) - cashBefore;
  const cashBoth = rowAmount(both, "cash", MONTH_INDEX) - cashBefore;
  const shareBoth = rowAmount(both, "share-capital", MONTH_INDEX);
  const checkBoth = getBalanceCheckForPeriod(both, MONTH_INDEX);

  assert(
    almostEqual(cashCapitalOnly, TEST_AMOUNT),
    `Capital alone must lift Cash by ${TEST_AMOUNT}, got ${cashCapitalOnly}`,
  );
  assert(
    almostEqual(cashBoth, 0),
    `Expense+Capital net Cash should be 0, got delta ${cashBoth}`,
  );
  assert(
    almostEqual(shareBoth, TEST_AMOUNT),
    `Share capital should be ${TEST_AMOUNT}, got ${shareBoth}`,
  );
  assert(
    checkBoth.isBalanced,
    `Expense+Capital should balance; diff=${checkBoth.difference}`,
  );
  console.log("PASS in-memory Capital Contribution cash + equity wiring");
}

async function fetchPayrollHistoryWages(admin, tenantId: string) {
  const preferred = await admin
    .from("payroll_history")
    .select("payroll_month, net_pay, net_only_adjustment")
    .eq("tenant_id", tenantId);
  if (!preferred.error) {
    return preferred.data ?? [];
  }
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

async function buildStagingSnapshot(admin, extraCapital = [], extraExpenses = []) {
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
    admin.from("manual_financial_entries").select("*").eq("tenant_id", TENANT),
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

  const payrollHistory = await fetchPayrollHistoryWages(admin, TENANT);
  const payrollMerged = mergePayrollWagesWithLiveOpenMonths(
    payrollHistory,
    payrollProcessing ?? [],
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

  const allExpenses = [...(expenses ?? []), ...extraExpenses];
  const cashFlowExpenses = allExpenses.map((entry) => ({
    date: entry.date,
    expense_category: entry.expense_category ?? "",
    sub_category: entry.sub_category,
    amount: entry.amount,
    payment_status: entry.payment_status,
    description: entry.description ?? null,
    receipt_no: entry.receipt_no ?? null,
    notes: entry.notes ?? null,
  }));

  const allCapital = [...(capital ?? []), ...extraCapital];

  const bs = buildBalanceSheetReport(
    income ?? [],
    allExpenses,
    fixedAssets ?? [],
    payables ?? [],
    allCapital,
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

  const check = getBalanceCheckForPeriod(bs, MONTH_INDEX);
  return {
    cash: rowAmount(bs, "cash", MONTH_INDEX),
    shareCapital: rowAmount(bs, "share-capital", MONTH_INDEX),
    retainedEarnings: rowAmount(bs, "retained-earnings", MONTH_INDEX),
    bsDiff: check.difference,
    bsBalanced: check.isBalanced,
    totalAssets: check.totalAssets,
    totalLE: check.totalLiabilitiesAndEquity,
  };
}

async function runLiveTest(admin) {
  const expensePayload = {
    tenant_id: TENANT,
    date: TEST_DATE,
    expense_category: "Administrative",
    sub_category: "Electronics",
    amount: TEST_AMOUNT,
    payment_status: "Paid",
    description: "[TEST] Capital contribution cash wiring",
    receipt_no: `TEST-CAP-CASH-${Date.now()}`,
    notes: "Auto test — delete after run",
  };

  console.log("\n=== Baseline staging BS (before test rows) ===");
  const before = await buildStagingSnapshot(admin);
  console.log(JSON.stringify(before, null, 2));

  let expenseId: string | null = null;
  let capitalId: string | null = null;

  const { data: employee, error: employeeErr } = await admin
    .from("employees")
    .select("employee_id")
    .eq("tenant_id", TENANT)
    .limit(1)
    .maybeSingle();
  assert(!employeeErr, `lookup employee: ${employeeErr?.message}`);
  assert(employee?.employee_id, "Need at least one employee for capital_contributions FK");

  try {
    const { data: expRow, error: expErr } = await admin
      .from("expense_register")
      .insert(expensePayload)
      .select("id")
      .single();
    assert(!expErr, `insert expense: ${expErr?.message}`);
    expenseId = expRow.id;

    const { data: capRow, error: capErr } = await admin
      .from("capital_contributions")
      .insert({
        tenant_id: TENANT,
        date: TEST_DATE,
        amount: TEST_AMOUNT,
        contributed_by: employee.employee_id,
        description: "[TEST] Capital contribution cash wiring",
        notes: "Auto test — delete after run",
      })
      .select("id")
      .single();
    assert(!capErr, `insert capital: ${capErr?.message}`);
    capitalId = capRow.id;

    console.log("\n=== After test expense + capital contribution ===");
    const after = await buildStagingSnapshot(admin);
    console.log(
      JSON.stringify(
        {
          ...after,
          deltaCash: round2(after.cash - before.cash),
          deltaShareCapital: round2(after.shareCapital - before.shareCapital),
          deltaRetained: round2(after.retainedEarnings - before.retainedEarnings),
          deltaBsDiff: round2(after.bsDiff - before.bsDiff),
        },
        null,
        2,
      ),
    );

    assert(
      almostEqual(after.cash - before.cash, 0),
      `Net Cash delta should be 0 (expense -200 + capital +200); got ${round2(after.cash - before.cash)}`,
    );
    assert(
      almostEqual(after.shareCapital - before.shareCapital, TEST_AMOUNT),
      `Share Capital should ↑ ${TEST_AMOUNT}`,
    );
    assert(
      almostEqual(after.retainedEarnings - before.retainedEarnings, -TEST_AMOUNT),
      `Retained Earnings should ↓ ${TEST_AMOUNT} from expense`,
    );
    assert(
      almostEqual(after.bsDiff, before.bsDiff),
      `BS diff should be unchanged (before=${before.bsDiff}, after=${after.bsDiff})`,
    );
    if (before.bsBalanced) {
      assert(after.bsBalanced, `BS should stay balanced; diff=${after.bsDiff}`);
    }

    console.log("\nPASS live staging: Capital Contribution lifts Cash + Share Capital, BS balanced");
  } finally {
    console.log("\n=== Cleanup ===");
    if (capitalId) {
      await admin.from("capital_contributions").delete().eq("id", capitalId);
    }
    if (expenseId) {
      await admin.from("expense_register").delete().eq("id", expenseId);
    }
    const cleaned = await buildStagingSnapshot(admin);
    assert(
      almostEqual(cleaned.cash, before.cash),
      `Cash after cleanup ${cleaned.cash} != before ${before.cash}`,
    );
    console.log("Cleanup OK");
  }
}

async function scanStagingFor200Gap(admin) {
  console.log("\n=== Scan staging: tenants with ~200 BS gap + Electronics 200 + capital 200 ===");
  const { data: tenants } = await admin.from("tenants").select("id, name");
  for (const tenant of tenants ?? []) {
    const { data: expenses } = await admin
      .from("expense_register")
      .select("date, amount, sub_category, payment_status")
      .eq("tenant_id", tenant.id)
      .eq("amount", 200);
    const { data: caps } = await admin
      .from("capital_contributions")
      .select("date, amount")
      .eq("tenant_id", tenant.id)
      .eq("amount", 200);
    const electronics200 = (expenses ?? []).filter(
      (e) => String(e.sub_category ?? "").toLowerCase().includes("electronic"),
    );
    if (electronics200.length === 0 && (caps ?? []).length === 0) continue;
    console.log(
      JSON.stringify({
        tenant: tenant.name,
        tenantId: tenant.id,
        electronics200: electronics200.length,
        capital200: (caps ?? []).length,
      }),
    );
  }
}

async function main() {
  runInMemoryProof();

  loadEnvForce(resolve(process.cwd(), ".env.staging.local"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert(url, "Missing NEXT_PUBLIC_SUPABASE_URL");
  assert(url.includes(STAGING_REF), "Refusing non-staging");
  assert(key, "Missing service role key");

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  await scanStagingFor200Gap(admin);
  await runLiveTest(admin);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
