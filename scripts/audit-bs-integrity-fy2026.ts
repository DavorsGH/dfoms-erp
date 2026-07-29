/**
 * Read-only BS integrity + BS/CF cash parity for Davors FY2026.
 *
 * Usage:
 *   npx tsx scripts/audit-bs-integrity-fy2026.ts --env-file .env.staging.local --label staging-before
 *   npx tsx scripts/audit-bs-integrity-fy2026.ts --env-file .env.local.backup --label production-before --allow-production
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
} from "../app/dashboard/finance/balance-sheet-utils";
import { buildCashFlowReport } from "../app/dashboard/finance/cash-flow-utils";
import { buildNetPayByPayrollMonth } from "../app/dashboard/finance/accrued-wages-utils";
import {
  fetchInventoryBalanceSheetInput,
  fetchCashFlowInventoryPurchaseInput,
} from "../app/dashboard/finance/balance-sheet-page-data";
import {
  FINISHED_PRODUCT_SELECT,
  normalizeFinishedProduct,
} from "../app/dashboard/inventory/finished-products-utils";
import {
  RAW_MATERIAL_SELECT,
  normalizeRawMaterial,
} from "../app/dashboard/inventory/raw-materials-utils";
import type { FinishedProductAverageCostRow } from "../app/dashboard/inventory/inventory-balance-sheet-utils";
import type { InventoryBalanceSheetInput } from "../app/dashboard/finance/balance-sheet-utils";
import type { CashFlowInventoryPurchaseInput } from "../app/dashboard/finance/cash-flow-utils";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  fetchPayrollLiveRecalcBundle,
  mergePayrollWagesWithLiveOpenMonths,
} from "../app/dashboard/hr-payroll/payroll-live-recalc-utils";
import type { PayrollProcessingRow } from "../app/dashboard/hr-payroll/payroll-processing-utils";
import type { PayrollHistoryWagesEntry } from "../app/dashboard/finance/accrued-wages-utils";

/** Pre-fix loader: no tenant filters (reproduces the leak under service role). */
async function fetchLegacyInventoryBalanceSheetInput(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<InventoryBalanceSheetInput> {
  const [
    { data: configRows },
    { data: rawMaterials },
    { data: finishedProducts },
    { data: averageCostRows },
    { data: cashPurchases },
    { data: productCashPurchases },
  ] = await Promise.all([
    supabase
      .from("inventory_balance_config")
      .select("go_live_date, opening_inventory_value, created_at")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    supabase
      .from("raw_materials")
      .select(RAW_MATERIAL_SELECT)
      .order("material_name", { ascending: true }),
    supabase
      .from("finished_products")
      .select(FINISHED_PRODUCT_SELECT)
      .order("product_name", { ascending: true }),
    supabase.rpc("get_finished_product_average_costs"),
    supabase
      .from("raw_material_purchases")
      .select("purchase_date, total_cost, payment_method, created_at"),
    supabase
      .from("product_purchases")
      .select("purchase_date, total_cost, payment_method, created_at"),
  ]);

  return {
    config: configRows
      ? {
          go_live_date: configRows.go_live_date,
          opening_inventory_value:
            Number(configRows.opening_inventory_value) || 0,
          created_at: configRows.created_at,
        }
      : null,
    rawMaterials: (rawMaterials ?? []).map((row) => normalizeRawMaterial(row)),
    finishedProducts: (finishedProducts ?? []).map((row) =>
      normalizeFinishedProduct(row),
    ),
    finishedProductAverageCosts: (
      (averageCostRows as FinishedProductAverageCostRow[] | null) ?? []
    ).map((row) => ({
      product_id: row.product_id,
      average_cost: Number(row.average_cost) || 0,
    })),
    cashPurchases: cashPurchases ?? [],
    productCashPurchases: productCashPurchases ?? [],
  };
}

async function fetchLegacyCashFlowInventoryPurchaseInput(
  supabase: SupabaseClient,
  tenantId: string,
): Promise<CashFlowInventoryPurchaseInput> {
  const [
    { data: configRows },
    { data: rawMaterialPurchases },
    { data: productPurchases },
  ] = await Promise.all([
    supabase
      .from("inventory_balance_config")
      .select("go_live_date, opening_inventory_value, created_at")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    supabase
      .from("raw_material_purchases")
      .select("purchase_date, total_cost, payment_method, created_at"),
    supabase
      .from("product_purchases")
      .select("purchase_date, total_cost, payment_method, created_at"),
  ]);

  return {
    inventoryConfig: configRows
      ? {
          go_live_date: configRows.go_live_date,
          opening_inventory_value:
            Number(configRows.opening_inventory_value) || 0,
          created_at: configRows.created_at,
        }
      : null,
    rawMaterialCashPurchases: rawMaterialPurchases ?? [],
    productCashPurchases: productPurchases ?? [],
  };
}

const STAGING = "wieflwbfdmjtsdnwbfii";
const PRODUCTION = "tvcurcnmasnocwdxzgvz";
const TENANT = "00000001-0000-4000-8000-000000000001";
const YEAR = 2026;
const MONTHS = [
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

function loadEnvForce(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    let v = trimmed.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    process.env[trimmed.slice(0, i).trim()] = v;
  }
}

function r2(n: number) {
  return Math.round(Number(n || 0) * 100) / 100;
}

function parseArgs(argv: string[]) {
  let envFile = ".env.staging.local";
  let label = "run";
  let allowProduction = false;
  let legacyInventory = false;
  let fixedCf = false;
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === "--env-file") envFile = argv[++i] ?? envFile;
    else if (argv[i] === "--label") label = argv[++i] ?? label;
    else if (argv[i] === "--allow-production") allowProduction = true;
    else if (argv[i] === "--legacy-inventory") legacyInventory = true;
    else if (argv[i] === "--fixed-cf") fixedCf = true;
  }
  if (label.includes("after")) fixedCf = true;
  if (label.includes("before")) legacyInventory = true;
  return { envFile, label, allowProduction, legacyInventory, fixedCf };
}

async function main() {
  const { envFile, label, allowProduction, legacyInventory, fixedCf } =
    parseArgs(process.argv.slice(2));
  loadEnvForce(resolve(process.cwd(), envFile));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const ref = new URL(url).hostname.split(".")[0];
  if (ref === PRODUCTION && !allowProduction) {
    throw new Error("Production requires --allow-production");
  }
  if (ref !== STAGING && ref !== PRODUCTION) {
    throw new Error(`Unexpected project ref ${ref}`);
  }
  if (!key) throw new Error("missing service role");

  console.log(`=== ${label} | ref=${ref} | Davors FY${YEAR} ===`);
  console.log(
    `Inventory path: ${legacyInventory ? "legacy (unfiltered)" : "tenant-filtered"}`,
  );

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const loadInv = legacyInventory
    ? fetchLegacyInventoryBalanceSheetInput
    : fetchInventoryBalanceSheetInput;
  const loadCfInv = legacyInventory
    ? fetchLegacyCashFlowInventoryPurchaseInput
    : fetchCashFlowInventoryPurchaseInput;

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
    { data: payrollHistory, error: phError },
    livePayrollBundle,
    inv,
    cfInv,
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
        "date, amount, payment_status, expense_category, sub_category, receipt_no, notes, net_of_tax_amount, wht_amount, input_vat_amount, description",
      )
      .eq("tenant_id", TENANT),
    admin.from("fixed_assets").select("*").eq("tenant_id", TENANT),
    admin.from("accounts_payable").select("*").eq("tenant_id", TENANT),
    admin.from("capital_contributions").select("*").eq("tenant_id", TENANT),
    admin.from("manual_financial_entries").select("*").eq("tenant_id", TENANT),
    admin.from("payroll_processing").select("*").eq("tenant_id", TENANT),
    admin.from("month_end_close").select("*").eq("tenant_id", TENANT),
    admin.from("tax_ledger_entries").select("*").eq("tenant_id", TENANT),
    admin
      .from("payroll_history")
      .select("payroll_month, net_pay")
      .eq("tenant_id", TENANT),
    fetchPayrollLiveRecalcBundle(admin, { tenantId: TENANT }),
    loadInv(admin, TENANT),
    loadCfInv(admin, TENANT),
  ]);

  for (const [name, err] of [
    ["income", incomeError],
    ["expenses", expenseError],
    ["fa", faError],
    ["ap", apError],
    ["capital", capitalError],
    ["manual", manualError],
    ["tax", taxError],
    ["ph", phError],
  ] as const) {
    if (err) throw new Error(`${name}: ${err.message}`);
  }
  if (livePayrollBundle.error) {
    throw new Error(`live payroll: ${livePayrollBundle.error}`);
  }

  const wages = mergePayrollWagesWithLiveOpenMonths(
    (payrollHistory as PayrollHistoryWagesEntry[] | null) ?? [],
    (payrollProcessing as PayrollProcessingRow[] | null) ?? [],
    livePayrollBundle.employees,
    livePayrollBundle.liveContext,
  );

  // BS path always includes expense notes (matches live Balance Sheet page).
  const cashFlowExpensesForBs = (expenses ?? []).map((entry) => ({
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
    cashFlowExpensesForBs,
    wages,
    monthEndClose ?? [],
    YEAR,
    inv,
    manual ?? [],
    taxLedger ?? [],
  );

  const staffMap = buildNetPayByPayrollMonth(wages, monthEndClose ?? []);
  const useFixedCf = fixedCf;

  // Before: mirror live CF page (no notes on expense select path, no staff map).
  // After (--fixed-cf / label contains "after"): same inputs as Balance Sheet cash.
  const cashFlowExpensesForCf = useFixedCf
    ? cashFlowExpensesForBs
    : cashFlowExpensesForBs.map(({ notes: _notes, ...rest }) => rest);

  console.log(
    `CF path: ${useFixedCf ? "fixed (notes + staff net map)" : "legacy live CF"}`,
  );

  const incomeForCf = (income ?? []).map((e) => ({
    date: e.date,
    amount_received: e.amount_received,
    entry_type: e.entry_type,
    sale_status: e.sale_status,
  }));

  const cf = useFixedCf
    ? buildCashFlowReport(
        incomeForCf,
        cashFlowExpensesForCf,
        manual ?? [],
        YEAR,
        cfInv,
        fixedAssets ?? [],
        capital ?? [],
        staffMap,
      )
    : buildCashFlowReport(
        incomeForCf,
        cashFlowExpensesForCf,
        manual ?? [],
        YEAR,
        cfInv,
        fixedAssets ?? [],
        capital ?? [],
      );

  const cashRow = bs.rows.find((r) => r.key === "cash");
  const closingRow = cf.rows.find((r) => r.key === "closing-cash-balance");
  const invRow = bs.rows.find((r) => r.key === "inventory");

  console.log("\n--- Balance sheet equation (Assets − L−E) ---");
  const imbalances: Array<{ month: string; diff: number }> = [];
  for (let m = 1; m <= 12; m += 1) {
    const check = getBalanceCheckForPeriod(bs, m - 1);
    const diff = r2(check.difference);
    console.log(
      `${MONTHS[m - 1]}: assets=${r2(check.totalAssets).toFixed(2)} L+E=${r2(check.totalLiabilitiesAndEquity).toFixed(2)} diff=${diff.toFixed(2)} balanced=${check.isBalanced}`,
    );
    if (!check.isBalanced) {
      imbalances.push({ month: MONTHS[m - 1]!, diff });
    }
  }

  console.log("\n--- BS cash vs CF closing ---");
  const cashMismatches: Array<{ month: string; bs: number; cf: number; delta: number }> =
    [];
  for (let i = 0; i < 12; i += 1) {
    const bsCash = r2(cashRow?.amounts[i] ?? 0);
    const cfCash = r2(closingRow?.amounts[i] ?? 0);
    const delta = r2(bsCash - cfCash);
    console.log(
      `${MONTHS[i]}: BS=${bsCash.toFixed(2)} CF=${cfCash.toFixed(2)} delta=${delta.toFixed(2)}`,
    );
    if (Math.abs(delta) > 0.01) {
      cashMismatches.push({
        month: MONTHS[i]!,
        bs: bsCash,
        cf: cfCash,
        delta,
      });
    }
  }

  console.log("\n--- Inventory asset (Jun/Jul) ---");
  console.log({
    jun: r2(invRow?.amounts[5] ?? 0),
    jul: r2(invRow?.amounts[6] ?? 0),
    configOpening: inv.config?.opening_inventory_value ?? null,
    rawMaterials: inv.rawMaterials.length,
    finishedProducts: inv.finishedProducts.length,
  });

  console.log("\n=== SUMMARY ===");
  console.log(
    imbalances.length === 0
      ? "PASS full BS equation all 12 months"
      : `FAIL BS imbalances: ${JSON.stringify(imbalances)}`,
  );
  console.log(
    cashMismatches.length === 0
      ? "PASS BS cash === CF closing all 12 months"
      : `FAIL cash mismatches: ${JSON.stringify(cashMismatches)}`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
