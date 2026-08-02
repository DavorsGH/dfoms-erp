/**
 * Staging: Balance Sheet cash === Cash Flow closing cash for Davors,
 * across months that include a voided sale and a fixed-asset purchase.
 *
 * Usage: npx tsx scripts/test-bs-cf-cash-parity-staging.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
} from "../app/dashboard/finance/balance-sheet-utils";
import { buildCashFlowReport } from "../app/dashboard/finance/cash-flow-utils";
import {
  fetchPayrollLiveRecalcBundle,
  mergePayrollWagesWithLiveOpenMonths,
} from "../app/dashboard/hr-payroll/payroll-live-recalc-utils";
import type { PayrollProcessingRow } from "../app/dashboard/hr-payroll/payroll-processing-utils";
import type { InventoryBalanceConfig } from "../app/dashboard/inventory/inventory-balance-sheet-utils";
import type { PayrollHistoryWagesEntry } from "../app/dashboard/finance/accrued-wages-utils";

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
  console.warn(
    "WARN: payroll_history.net_only_adjustment missing — apply scripts/116_payroll_net_only_adjustment.sql; using net_pay only",
  );
  const fallback = await admin
    .from("payroll_history")
    .select("payroll_month, net_pay")
    .eq("tenant_id", tenantId);
  if (fallback.error) throw new Error(`payroll_history: ${fallback.error.message}`);
  return ((fallback.data as Array<{ payroll_month: string; net_pay: number }> | null) ?? []).map(
    (row) => ({
      payroll_month: row.payroll_month,
      net_pay: row.net_pay,
      net_only_adjustment: 0,
    }),
  );
}

const MONTH_LABELS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

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

  const TENANT = "00000001-0000-4000-8000-000000000001"; // Davors
  const YEAR = 2026;

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
    { data: cogsRows, error: cogsError },
    { data: taxLedger, error: taxError },
    livePayrollBundle,
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
        "date, expense_category, sub_category, amount, payment_status, description, receipt_no, notes, net_of_tax_amount, input_vat_amount",
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
      .from("payroll_processing")
      .select("*")
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
      .from("expense_register")
      .select("receipt_no, payment_status, amount, date")
      .eq("tenant_id", TENANT)
      .or("receipt_no.ilike.COGS-%,receipt_no.ilike.VOID-COGS-%")
      .order("date", { ascending: false })
      .limit(20),
    admin
      .from("tax_ledger_entries")
      .select("entry_date, direction, tax_component, tax_amount, status")
      .eq("tenant_id", TENANT)
      .eq("status", "open")
      .order("entry_date"),
    fetchPayrollLiveRecalcBundle(admin, { tenantId: TENANT }),
  ]);

  const payrollHistory = await fetchPayrollHistoryWages(admin, TENANT);

  for (const [label, err] of [
    ["income", incomeError],
    ["expense", expenseError],
    ["fa", faError],
    ["ap", apError],
    ["capital", capitalError],
    ["manual", manualError],
    ["cogs", cogsError],
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
    notes: entry.notes ?? null,
  }));

  if (livePayrollBundle.error) {
    throw new Error(`live payroll bundle: ${livePayrollBundle.error}`);
  }

  const payrollMerged = mergePayrollWagesWithLiveOpenMonths(
    payrollHistory,
    (payrollProcessing as PayrollProcessingRow[] | null) ?? [],
    livePayrollBundle.employees,
    livePayrollBundle.liveContext,
  );

  // Staging currently has no live voided product sales. Inject a large voided
  // sale into July so we still prove void rows are excluded identically on BS+CF.
  const VOID_PROBE_AMOUNT = 99_999;
  const VOID_MONTH = 7; // July (also an FA-purchase month on Davors)
  const voidProbeIncome = {
    date: `${YEAR}-${String(VOID_MONTH).padStart(2, "0")}-15`,
    amount: VOID_PROBE_AMOUNT,
    amount_received: VOID_PROBE_AMOUNT,
    outstanding_balance: 0,
    service_category: "Product Sales",
    entry_type: "product_sale" as const,
    sale_status: "voided" as const,
  };
  const incomeWithVoid = [...(income ?? []), voidProbeIncome];

  const bsBaseline = buildBalanceSheetReport(
    income ?? [],
    expenses ?? [],
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

  const bsReport = buildBalanceSheetReport(
    incomeWithVoid,
    expenses ?? [],
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

  const cfIncomeBase = (income ?? []).map((e) => ({
    date: e.date,
    amount_received: e.amount_received,
    entry_type: e.entry_type,
    sale_status: e.sale_status,
  }));
  const cfIncomeWithVoid = [
    ...cfIncomeBase,
    {
      date: voidProbeIncome.date,
      amount_received: voidProbeIncome.amount_received,
      entry_type: voidProbeIncome.entry_type,
      sale_status: voidProbeIncome.sale_status,
    },
  ];

  const cfReport = buildCashFlowReport(
    cfIncomeWithVoid,
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
    undefined,
    payables ?? [],
  );

  const bsCash = bsReport.rows.find((r) => r.key === "cash")?.amounts;
  const cfClosing = cfReport.rows.find(
    (r) => r.key === "closing-cash-balance",
  )?.amounts;
  assert(bsCash && cfClosing, "Missing cash rows");

  const voidMonths = new Set<number>([VOID_MONTH]);
  for (const entry of income ?? []) {
    if (
      entry.sale_status === "voided" &&
      String(entry.date).startsWith(String(YEAR))
    ) {
      voidMonths.add(Number(String(entry.date).slice(5, 7)));
    }
  }

  const bsCashBaseline =
    bsBaseline.rows.find((r) => r.key === "cash")?.amounts ?? [];
  const voidExcluded =
    Math.abs((bsCash[VOID_MONTH - 1] ?? 0) - (bsCashBaseline[VOID_MONTH - 1] ?? 0)) <=
    0.01;

  const faMonths = new Set<number>();
  for (const asset of fixedAssets ?? []) {
    if (String(asset.purchase_date).startsWith(String(YEAR))) {
      faMonths.add(Number(String(asset.purchase_date).slice(5, 7)));
    }
  }

  const mismatches: Array<{
    month: string;
    bs: number;
    cf: number;
    delta: number;
  }> = [];
  const comparison: Array<{
    month: string;
    bs: number;
    cf: number;
    match: boolean;
    tags: string[];
  }> = [];

  for (let i = 0; i < 12; i += 1) {
    const bs = bsCash[i] ?? 0;
    const cf = cfClosing[i] ?? 0;
    const delta = Math.round((bs - cf) * 100) / 100;
    const tags: string[] = [];
    if (voidMonths.has(i + 1)) tags.push("voided-sale");
    if (faMonths.has(i + 1)) tags.push("fa-purchase");
    comparison.push({
      month: MONTH_LABELS[i],
      bs,
      cf,
      match: Math.abs(delta) <= 0.01,
      tags,
    });
    if (Math.abs(delta) > 0.01) {
      mismatches.push({ month: MONTH_LABELS[i], bs, cf, delta });
    }
  }

  const balanceChecks: Array<{
    month: string;
    isBalanced: boolean;
    difference: number;
    totalAssets: number;
    totalLiabilitiesAndEquity: number;
  }> = [];
  const unbalanced: typeof balanceChecks = [];
  for (let i = 0; i < 12; i += 1) {
    const check = getBalanceCheckForPeriod(bsReport, i);
    const row = {
      month: MONTH_LABELS[i],
      isBalanced: check.isBalanced,
      difference: check.difference,
      totalAssets: check.totalAssets,
      totalLiabilitiesAndEquity: check.totalLiabilitiesAndEquity,
    };
    balanceChecks.push(row);
    if (!check.isBalanced) unbalanced.push(row);
  }

  const cogsStatusCounts: Record<string, number> = {};
  for (const row of cogsRows ?? []) {
    const kind = String(row.receipt_no).startsWith("VOID-COGS")
      ? "VOID-COGS"
      : "COGS";
    const key = `${kind}|${row.payment_status}`;
    cogsStatusCounts[key] = (cogsStatusCounts[key] ?? 0) + 1;
  }

  const paidCogs = (cogsRows ?? []).filter(
    (r) => String(r.payment_status).toLowerCase() === "paid",
  );

  console.log(
    JSON.stringify(
      {
        tenant_id: TENANT,
        year: YEAR,
        void_sale_months: [...voidMonths]
          .sort((a, b) => a - b)
          .map((m) => MONTH_LABELS[m - 1]),
        void_probe: {
          month: MONTH_LABELS[VOID_MONTH - 1],
          amount: VOID_PROBE_AMOUNT,
          excluded_from_cash: voidExcluded,
        },
        fa_purchase_months: [...faMonths]
          .sort((a, b) => a - b)
          .map((m) => MONTH_LABELS[m - 1]),
        cogs_rows_found: (cogsRows ?? []).length,
        cogs_status_counts: cogsStatusCounts,
        paid_cogs_rows: paidCogs.length,
        comparison,
        mismatches,
        balance_checks: balanceChecks,
        unbalanced_months: unbalanced,
        full_year: { bs: bsCash[12], cf: cfClosing[12] },
      },
      null,
      2,
    ),
  );

  assert(voidExcluded, "Voided sale probe amount leaked into BS cash");
  assert(
    faMonths.size > 0,
    "No fixed-asset purchases found in FY — need at least one FA purchase month",
  );
  assert(
    mismatches.length === 0,
    `BS cash !== CF closing: ${JSON.stringify(mismatches)}`,
  );
  assert(
    paidCogs.length === 0,
    `COGS/VOID-COGS still Paid: ${JSON.stringify(paidCogs)}`,
  );
  assert(
    unbalanced.length === 0,
    `BS not balanced: ${JSON.stringify(unbalanced)}`,
  );

  console.log(
    "PASS: BS cash === CF closing for all months; BS balanced 0..11; void probe excluded; FA months present; no Paid COGS rows",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
