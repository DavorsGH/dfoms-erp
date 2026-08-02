/**
 * Verify script 145 on staging: Caanta inventory/BS, COGS unchanged, Davors balanced.
 * Usage: npx tsx scripts/verify-145-on-hand-wac-staging.ts
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
} from "../app/dashboard/finance/balance-sheet-utils";
import { fetchInventoryBalanceSheetInput } from "../app/dashboard/finance/balance-sheet-page-data";
import { buildAverageFinishedProductCostMap } from "../app/dashboard/inventory/inventory-balance-sheet-utils";
import type { FinishedProductAverageCostRow } from "../app/dashboard/inventory/inventory-balance-sheet-utils";
import {
  fetchPayrollLiveRecalcBundle,
  mergePayrollWagesWithLiveOpenMonths,
} from "../app/dashboard/hr-payroll/payroll-live-recalc-utils";
import type { PayrollProcessingRow } from "../app/dashboard/hr-payroll/payroll-processing-utils";
import type { PayrollHistoryWagesEntry } from "../app/dashboard/finance/accrued-wages-utils";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const CAANTA = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";
const DAVORS = "00000001-0000-4000-8000-000000000001";
const YEAR = 2026;
const AUGUST = 7;

/** Expected historical COGS from pre-145 investigation (Caanta product sales). */
const EXPECTED_COGS_AMOUNTS = [180]; // net: 18 × 10

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

function r2(n: number) {
  return Math.round(n * 100) / 100;
}

async function fetchPayrollHistoryWages(
  admin: SupabaseClient,
  tenantId: string,
): Promise<PayrollHistoryWagesEntry[]> {
  const primary = await admin
    .from("payroll_history")
    .select("payroll_month, net_pay, net_only_adjustment")
    .eq("tenant_id", tenantId);
  if (!primary.error && primary.data) {
    return primary.data as PayrollHistoryWagesEntry[];
  }
  const fallback = await admin
    .from("payroll_history")
    .select("payroll_month, net_pay")
    .eq("tenant_id", tenantId);
  if (fallback.error) throw new Error(`payroll_history: ${fallback.error.message}`);
  return ((fallback.data as Array<{ payroll_month: string; net_pay: number }>) ?? []).map(
    (row) => ({
      payroll_month: row.payroll_month,
      net_pay: row.net_pay,
      net_only_adjustment: 0,
    }),
  );
}

async function buildTenantBs(admin: SupabaseClient, tenantId: string) {
  const [
    { data: income, error: incomeError },
    { data: expenses, error: expenseError },
    { data: fixedAssets, error: faError },
    { data: payables, error: apError },
    { data: capital, error: capitalError },
    { data: manual, error: manualError },
    { data: payrollProcessing },
    { data: monthEndClose },
    { data: taxLedger, error: taxError },
    livePayrollBundle,
    inv,
  ] = await Promise.all([
    admin
      .from("income_register")
      .select(
        "date, amount, amount_received, outstanding_balance, wht_amount, service_category, entry_type, sale_status, net_of_tax_amount, output_vat_amount",
      )
      .eq("tenant_id", tenantId),
    admin
      .from("expense_register")
      .select(
        "date, amount, payment_status, expense_category, sub_category, receipt_no, notes, net_of_tax_amount, wht_amount, input_vat_amount, description",
      )
      .eq("tenant_id", tenantId),
    admin.from("fixed_assets").select("*").eq("tenant_id", tenantId),
    admin.from("accounts_payable").select("*").eq("tenant_id", tenantId),
    admin.from("capital_contributions").select("*").eq("tenant_id", tenantId),
    admin.from("manual_financial_entries").select("*").eq("tenant_id", tenantId),
    admin.from("payroll_processing").select("*").eq("tenant_id", tenantId),
    admin.from("month_end_close").select("*").eq("tenant_id", tenantId),
    admin.from("tax_ledger_entries").select("*").eq("tenant_id", tenantId),
    fetchPayrollLiveRecalcBundle(admin, { tenantId }),
    fetchInventoryBalanceSheetInput(admin, tenantId),
  ]);

  for (const [name, err] of [
    ["income", incomeError],
    ["expenses", expenseError],
    ["fa", faError],
    ["ap", apError],
    ["capital", capitalError],
    ["manual", manualError],
    ["tax", taxError],
  ] as const) {
    if (err) throw new Error(`${name}: ${err.message}`);
  }
  if (livePayrollBundle.error) {
    throw new Error(`live payroll: ${livePayrollBundle.error}`);
  }

  const payrollHistory = await fetchPayrollHistoryWages(admin, tenantId);
  const wages = mergePayrollWagesWithLiveOpenMonths(
    payrollHistory,
    (payrollProcessing as PayrollProcessingRow[] | null) ?? [],
    livePayrollBundle.employees,
    livePayrollBundle.liveContext,
  );

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

  const bs = buildBalanceSheetReport(
    income ?? [],
    expenses ?? [],
    fixedAssets ?? [],
    payables ?? [],
    capital ?? [],
    cashFlowExpenses,
    wages,
    monthEndClose ?? [],
    YEAR,
    inv,
    manual ?? [],
    taxLedger ?? [],
  );

  return bs;
}

async function main() {
  loadEnvForce(resolve(process.cwd(), ".env.staging.local"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const ref = new URL(url).hostname.split(".")[0];
  if (ref !== STAGING_REF) {
    throw new Error(`REFUSING: expected staging ${STAGING_REF}, got ${ref}`);
  }

  const admin = createClient(url, key, { auth: { persistSession: false } });

  const { data: products, error: fpErr } = await admin
    .from("finished_products")
    .select("id, product_code, product_name, current_stock")
    .eq("tenant_id", CAANTA);
  if (fpErr) throw fpErr;

  const { data: avgRows, error: avgErr } = await admin.rpc(
    "get_finished_product_average_costs",
    { p_tenant_id: CAANTA },
  );
  if (avgErr) throw avgErr;
  const avgMap = buildAverageFinishedProductCostMap(
    (avgRows ?? []) as FinishedProductAverageCostRow[],
  );

  let finishedInv = 0;
  const productLines = (products ?? []).map((p) => {
    const stock = Number(p.current_stock) || 0;
    const avg = avgMap.get(p.id) ?? 0;
    const value = stock * avg;
    finishedInv += value;
    return {
      name: p.product_name,
      stock,
      avg,
      value: r2(value),
    };
  });
  finishedInv = r2(finishedInv);

  const { data: purchases, error: ppErr } = await admin
    .from("product_purchases")
    .select("product_id, total_cost, quantity")
    .eq("tenant_id", CAANTA);
  if (ppErr) throw ppErr;

  const { data: sales, error: salesErr } = await admin
    .from("income_register")
    .select("id, product_id, sale_quantity, cogs_expense_id, cogs_reversal_expense_id")
    .eq("tenant_id", CAANTA)
    .eq("entry_type", "product_sale");
  if (salesErr) throw salesErr;

  const cogsIds = new Set(
    (sales ?? [])
      .flatMap((s) => [s.cogs_expense_id, s.cogs_reversal_expense_id])
      .filter(Boolean) as string[],
  );

  const { data: cogsRows, error: cogsErr } = await admin
    .from("expense_register")
    .select("id, amount, price, quantity, receipt_no, description, date")
    .eq("tenant_id", CAANTA)
    .eq("expense_category", "Cost of Goods Sold")
    .eq("sub_category", "Product Sales")
    .order("date", { ascending: true });
  if (cogsErr) throw cogsErr;

  const linkedCogs = (cogsRows ?? []).filter((r) => cogsIds.has(r.id));
  const cogsFingerprint = createHash("sha256")
    .update(
      JSON.stringify(
        linkedCogs
          .map((r) => ({
            id: r.id,
            amount: Number(r.amount),
            price: Number(r.price),
            quantity: Number(r.quantity),
            receipt_no: r.receipt_no,
            date: r.date,
          }))
          .sort((a, b) => a.id.localeCompare(b.id)),
      ),
    )
    .digest("hex");

  const cogsTotal = r2(linkedCogs.reduce((s, r) => s + (Number(r.amount) || 0), 0));
  const purchasesTotal = r2(
    (purchases ?? []).reduce((s, r) => s + (Number(r.total_cost) || 0), 0),
  );
  const carrying = r2(purchasesTotal - cogsTotal);

  console.log("=== Caanta finished inventory (RPC WAC) ===");
  console.table(productLines);
  console.log(
    JSON.stringify(
      {
        finishedInv,
        purchasesTotal,
        cogsTotal,
        carrying,
        invMinusCarrying: r2(finishedInv - carrying),
        cogsRowCount: linkedCogs.length,
        cogsFingerprint,
        cogsAmounts: linkedCogs.map((r) => Number(r.amount)),
        expectedCogsAmounts: EXPECTED_COGS_AMOUNTS,
        cogsUnchangedVsInvestigation:
          linkedCogs.length === 1 && Number(linkedCogs[0]?.amount) === 180,
      },
      null,
      2,
    ),
  );

  for (const [label, tenantId] of [
    ["Caanta Market", CAANTA],
    ["Davors", DAVORS],
  ] as const) {
    const bs = await buildTenantBs(admin, tenantId);
    const check = getBalanceCheckForPeriod(bs, AUGUST);
    const invRow = bs.rows.find((r) => r.key === "inventory");
    console.log(
      `\n=== ${label} Aug ${YEAR} BS ===`,
      JSON.stringify(
        {
          inventory: r2(invRow?.amounts[AUGUST] ?? 0),
          totalAssets: check.totalAssets,
          totalLE: check.totalLiabilitiesAndEquity,
          difference: check.difference,
          isBalanced: check.isBalanced,
        },
        null,
        2,
      ),
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
