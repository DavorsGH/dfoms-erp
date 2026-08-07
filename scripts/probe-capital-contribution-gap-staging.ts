/**
 * Probe staging tenants for GHS 200 Electronics + Capital Contribution BS gap.
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
const YEAR = 2026;
const MONTH_INDEX = 7; // August

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

function rowAmount(report, key, mi) {
  return report.rows.find((r) => r.key === key)?.amounts[mi] ?? 0;
}

async function main() {
loadEnvForce(resolve(process.cwd(), ".env.staging.local"));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url?.includes(STAGING_REF)) throw new Error("staging only");
const admin = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: tenants } = await admin.from("tenants").select("id, name");

for (const tenant of tenants ?? []) {
  const { data: expenses } = await admin
    .from("expense_register")
    .select("*")
    .eq("tenant_id", tenant.id);
  const { data: capital } = await admin
    .from("capital_contributions")
    .select("*")
    .eq("tenant_id", tenant.id);

  const elec200 = (expenses ?? []).filter(
    (e) =>
      Number(e.amount) === 200 &&
      String(e.sub_category ?? "").toLowerCase().includes("electronic"),
  );
  const cap200 = (capital ?? []).filter((c) => Number(c.amount) === 200);

  if (elec200.length === 0 && cap200.length === 0) continue;

  console.log("\n===", tenant.name, tenant.id, "===");
  console.log("electronics200:", elec200);
  console.log("capital200:", cap200);

  const [
    { data: income },
    { data: fixedAssets },
    { data: payables },
    { data: manual },
    { data: payrollProcessing },
    { data: monthEndClose },
    { data: invConfig },
    { data: rawPurchases },
    { data: productPurchases },
    { data: taxLedger },
    livePayrollBundle,
  ] = await Promise.all([
    admin.from("income_register").select("*").eq("tenant_id", tenant.id),
    admin.from("fixed_assets").select("*").eq("tenant_id", tenant.id),
    admin.from("accounts_payable").select("*").eq("tenant_id", tenant.id),
    admin.from("manual_financial_entries").select("*").eq("tenant_id", tenant.id),
    admin.from("payroll_processing").select("*").eq("tenant_id", tenant.id),
    admin.from("month_end_close").select("*").eq("tenant_id", tenant.id),
    admin
      .from("inventory_balance_config")
      .select("*")
      .eq("tenant_id", tenant.id)
      .maybeSingle(),
    admin.from("raw_material_purchases").select("*").eq("tenant_id", tenant.id),
    admin.from("product_purchases").select("*").eq("tenant_id", tenant.id),
    admin
      .from("tax_ledger_entries")
      .select("*")
      .eq("tenant_id", tenant.id)
      .eq("status", "open"),
    fetchPayrollLiveRecalcBundle(admin, { tenantId: tenant.id }),
  ]);

  const { data: payrollHistory } = await admin
    .from("payroll_history")
    .select("payroll_month, net_pay, net_only_adjustment")
    .eq("tenant_id", tenant.id);

  const payrollMerged = mergePayrollWagesWithLiveOpenMonths(
    payrollHistory ?? [],
    payrollProcessing ?? [],
    livePayrollBundle.employees,
    livePayrollBundle.liveContext,
  );

  const cashFlowExpenses = (expenses ?? []).map((e) => ({
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

  const bs = buildBalanceSheetReport(
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

  const check = getBalanceCheckForPeriod(bs, MONTH_INDEX);
  console.log({
    month: "Aug 2026",
    cash: rowAmount(bs, "cash", MONTH_INDEX),
    shareCapital: rowAmount(bs, "share-capital", MONTH_INDEX),
    retainedEarnings: rowAmount(bs, "retained-earnings", MONTH_INDEX),
    totalAssets: check.totalAssets,
    totalLE: check.totalLiabilitiesAndEquity,
    diff: check.difference,
    balanced: check.isBalanced,
  });

  // Simulate removing capital contributions from cash input only
  const bsNoCapCash = buildBalanceSheetReport(
    income ?? [],
    expenses ?? [],
    fixedAssets ?? [],
    payables ?? [],
    [], // strip capital from cash+equity
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
  const checkNoCap = getBalanceCheckForPeriod(bsNoCapCash, MONTH_INDEX);
  console.log("if capital removed entirely:", {
    diff: checkNoCap.difference,
    cash: rowAmount(bsNoCapCash, "cash", MONTH_INDEX),
    shareCapital: rowAmount(bsNoCapCash, "share-capital", MONTH_INDEX),
  });
}
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
