/**
 * Staging: Tax Tracking step 4 — July 2026 Davors before/after P&L + BS,
 * balance check, and BS/CF cash parity.
 *
 * Usage: npx tsx scripts/verify-tax-tracking-step4-staging.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
  isStatutoryRemittancePayable,
  type BalanceSheetTaxLedgerEntry,
} from "../app/dashboard/finance/balance-sheet-utils";
import { buildCashFlowReport } from "../app/dashboard/finance/cash-flow-utils";
import {
  buildProfitLossReport,
  type ProfitLossExpenseEntry,
  type ProfitLossIncomeEntry,
} from "../app/dashboard/finance/profit-loss-utils";
import type { InventoryBalanceConfig } from "../app/dashboard/inventory/inventory-balance-sheet-utils";

function loadEnvForce(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    process.env[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim();
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function rowAmount(
  report: { rows: Array<{ key: string; amounts: number[] }> },
  key: string,
  monthIndex: number,
): number {
  return report.rows.find((r) => r.key === key)?.amounts[monthIndex] ?? 0;
}

loadEnvForce(resolve(process.cwd(), ".env.staging.local"));

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert(url, "Missing NEXT_PUBLIC_SUPABASE_URL");
  assert(url.includes("wieflwbfdmjtsdnwbfii"), "Refusing non-staging");
  assert(key, "Missing service role key");

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const TENANT = "00000001-0000-4000-8000-000000000001";
  const YEAR = 2026;
  const JULY = 6; // 0-based

  const [
    { data: income, error: incomeError },
    { data: expenses, error: expenseError },
    { data: fixedAssets, error: faError },
    { data: payables, error: apError },
    { data: capital, error: capitalError },
    { data: manual, error: manualError },
    { data: payrollHistory },
    { data: payrollProcessing },
    { data: monthEndClose },
    { data: invConfig },
    { data: rawPurchases },
    { data: productPurchases },
    { data: taxLedger, error: taxError },
  ] = await Promise.all([
    admin
      .from("income_register")
      .select(
        "date, amount, amount_received, outstanding_balance, wht_amount, service_category, entry_type, sale_status, net_of_tax_amount, output_vat_amount",
      )
      .eq("tenant_id", TENANT)
      .order("date"),
    admin
      .from("expense_register")
      .select(
        "date, expense_category, sub_category, amount, payment_status, description, receipt_no, net_of_tax_amount, input_vat_amount",
      )
      .eq("tenant_id", TENANT)
      .order("date"),
    admin
      .from("fixed_assets")
      .select(
        "original_cost, quantity, useful_life_years, purchase_date, depreciation_method",
      )
      .eq("tenant_id", TENANT)
      .order("asset_id"),
    admin
      .from("accounts_payable")
      .select(
        "invoice_date, balance_due, amount, amount_paid, vendor_name, invoice_number, expense_category",
      )
      .eq("tenant_id", TENANT),
    admin
      .from("capital_contributions")
      .select("id, date, contributed_by, amount, description, notes")
      .eq("tenant_id", TENANT),
    admin
      .from("manual_financial_entries")
      .select("*")
      .eq("tenant_id", TENANT)
      .order("period_month"),
    admin
      .from("payroll_history")
      .select("payroll_month, net_pay")
      .eq("tenant_id", TENANT),
    admin
      .from("payroll_processing")
      .select("payroll_month, net_pay")
      .eq("tenant_id", TENANT),
    admin
      .from("month_end_close")
      .select("month, total_net_pay")
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
  ]);

  for (const [label, err] of [
    ["income", incomeError],
    ["expense", expenseError],
    ["fa", faError],
    ["ap", apError],
    ["capital", capitalError],
    ["manual", manualError],
    ["tax", taxError],
  ] as const) {
    if (err) throw new Error(`${label}: ${err.message}`);
  }

  const inventoryConfig: InventoryBalanceConfig | null = invConfig
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
  }));

  const payrollMerged = [
    ...(payrollHistory ?? []),
    ...(payrollProcessing ?? []),
  ];

  const inventoryInput = {
    config: inventoryConfig,
    rawMaterials: [],
    finishedProducts: [],
    finishedProductAverageCosts: [],
    cashPurchases: rawPurchases ?? [],
    productCashPurchases: productPurchases ?? [],
  };

  const incomeTaxExclusive = (income ?? []) as ProfitLossIncomeEntry[];
  const expenseTaxExclusive = (expenses ?? []) as ProfitLossExpenseEntry[];

  // Before: strip thin tax columns so helpers fall back to gross `amount`.
  const incomeGross = incomeTaxExclusive.map((entry) => ({
    ...entry,
    net_of_tax_amount: null,
    output_vat_amount: null,
  }));
  const expenseGross = expenseTaxExclusive.map((entry) => ({
    ...entry,
    net_of_tax_amount: null,
    input_vat_amount: null,
  }));

  const plBefore = buildProfitLossReport(
    incomeGross,
    expenseGross,
    fixedAssets ?? [],
    YEAR,
  );
  const plAfter = buildProfitLossReport(
    incomeTaxExclusive,
    expenseTaxExclusive,
    fixedAssets ?? [],
    YEAR,
  );

  const taxEntries = (taxLedger ?? []) as BalanceSheetTaxLedgerEntry[];

  // Before: gross P&L amounts, no tax ledger lines, no statutory AP exclusion.
  const bsBefore = buildBalanceSheetReport(
    income ?? [],
    expenseGross,
    fixedAssets ?? [],
    (payables ?? []).map((p) => ({
      invoice_date: p.invoice_date,
      balance_due: p.balance_due,
      amount: p.amount,
      amount_paid: p.amount_paid,
    })),
    capital ?? [],
    cashFlowExpenses,
    payrollMerged,
    monthEndClose ?? [],
    YEAR,
    inventoryInput,
    manual ?? [],
    [],
  );

  const bsAfter = buildBalanceSheetReport(
    income ?? [],
    expenseTaxExclusive,
    fixedAssets ?? [],
    payables ?? [],
    capital ?? [],
    cashFlowExpenses,
    payrollMerged,
    monthEndClose ?? [],
    YEAR,
    inventoryInput,
    manual ?? [],
    taxEntries,
  );

  const checkBefore = getBalanceCheckForPeriod(bsBefore, JULY);
  const checkAfter = getBalanceCheckForPeriod(bsAfter, JULY);

  const excludedAp = (payables ?? []).filter((p) =>
    isStatutoryRemittancePayable(p),
  );
  const excludedApBalance = excludedAp.reduce((sum, p) => {
    const due =
      p.balance_due != null
        ? Math.max(Number(p.balance_due) || 0, 0)
        : Math.max((Number(p.amount) || 0) - (Number(p.amount_paid) || 0), 0);
    return sum + due;
  }, 0);

  const cfReport = buildCashFlowReport(
    (income ?? []).map((e) => ({
      date: e.date,
      amount_received: e.amount_received,
      entry_type: e.entry_type,
      sale_status: e.sale_status,
    })),
    cashFlowExpenses,
    manual ?? [],
    YEAR,
    {
      rawMaterialCashPurchases: rawPurchases ?? [],
      productCashPurchases: productPurchases ?? [],
      inventoryConfig,
    },
    fixedAssets ?? [],
    capital ?? [],
  );

  const bsCash = bsAfter.rows.find((r) => r.key === "cash")?.amounts ?? [];
  const cfClosing =
    cfReport.rows.find((r) => r.key === "closing-cash-balance")?.amounts ?? [];
  const cashParityMismatches: Array<{
    month: number;
    bs: number;
    cf: number;
    delta: number;
  }> = [];
  for (let i = 0; i < 12; i += 1) {
    const delta = Math.round(((bsCash[i] ?? 0) - (cfClosing[i] ?? 0)) * 100) / 100;
    if (Math.abs(delta) > 0.01) {
      cashParityMismatches.push({
        month: i + 1,
        bs: bsCash[i] ?? 0,
        cf: cfClosing[i] ?? 0,
        delta,
      });
    }
  }

  const result = {
    tenant_id: TENANT,
    year: YEAR,
    month: "July",
    pl: {
      july: {
        before: {
          revenue: rowAmount(plBefore, "total-revenue", JULY),
          expenses: rowAmount(plBefore, "total-expenses", JULY),
          net_profit: rowAmount(plBefore, "net-profit", JULY),
        },
        after: {
          revenue: rowAmount(plAfter, "total-revenue", JULY),
          expenses: rowAmount(plAfter, "total-expenses", JULY),
          net_profit: rowAmount(plAfter, "net-profit", JULY),
        },
      },
      ytd: {
        before: {
          revenue: rowAmount(plBefore, "total-revenue", 12),
          expenses: rowAmount(plBefore, "total-expenses", 12),
          net_profit: rowAmount(plBefore, "net-profit", 12),
        },
        after: {
          revenue: rowAmount(plAfter, "total-revenue", 12),
          expenses: rowAmount(plAfter, "total-expenses", 12),
          net_profit: rowAmount(plAfter, "net-profit", 12),
        },
      },
    },
    bs_new_lines_july: {
      wht_receivable: rowAmount(bsAfter, "wht-receivable", JULY),
      net_vat_receivable: rowAmount(bsAfter, "net-vat-receivable", JULY),
      wht_payable: rowAmount(bsAfter, "wht-payable", JULY),
      net_vat_payable: rowAmount(bsAfter, "net-vat-payable", JULY),
      paye_payable: rowAmount(bsAfter, "paye-payable", JULY),
      ssnit_payable: rowAmount(bsAfter, "ssnit-payable", JULY),
      accounts_payable: rowAmount(bsAfter, "accounts-payable", JULY),
      accounts_receivable: rowAmount(bsAfter, "accounts-receivable", JULY),
    },
    statutory_ap_exclusion: {
      rule: "vendor SSNIT/GRA OR category Statutory - SSNIT/PAYE OR invoice PAYROLL-SSNIT|PAYROLL-PAYE|PAYROLL-GRA*",
      excluded_row_count: excludedAp.length,
      excluded_balance_due_total: Math.round(excludedApBalance * 100) / 100,
      sample: excludedAp.slice(0, 5).map((p) => ({
        vendor_name: p.vendor_name,
        invoice_number: p.invoice_number,
        expense_category: p.expense_category,
        balance_due: p.balance_due,
      })),
    },
    open_tax_ledger_count: taxEntries.length,
    balance_check_july: {
      before: checkBefore,
      after: checkAfter,
    },
    bs_cf_cash_parity: {
      pass: cashParityMismatches.length === 0,
      mismatches: cashParityMismatches,
      july: { bs: bsCash[JULY], cf: cfClosing[JULY] },
    },
  };

  console.log(JSON.stringify(result, null, 2));

  assert(checkAfter.isBalanced, `BS out of balance after: ${checkAfter.difference}`);
  assert(
    cashParityMismatches.length === 0,
    `BS/CF cash parity failed: ${JSON.stringify(cashParityMismatches)}`,
  );

  console.log("PASS: July BS balances; BS/CF cash parity OK");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
