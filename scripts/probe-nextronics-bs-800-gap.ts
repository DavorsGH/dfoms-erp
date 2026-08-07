/**
 * Read-only: Nextronics Aug 2026 BS 800 gap + NEXTR-POS-0001 COGS/inventory trace.
 * Run: npx tsx scripts/probe-nextronics-bs-800-gap.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  buildBalanceSheetReport,
  getBalanceCheckForPeriod,
} from "../app/dashboard/finance/balance-sheet-utils";
import { fetchInventoryBalanceSheetInput } from "../app/dashboard/finance/balance-sheet-page-data";
import { calculateTotalInventoryValue } from "../app/dashboard/inventory/inventory-balance-sheet-utils";
import { mergePayrollWagesSources } from "../app/dashboard/finance/accrued-wages-utils";

function loadEnv(filePath: string) {
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

function r2(n: number) {
  return Math.round(Number(n || 0) * 100) / 100;
}

loadEnv(resolve(".env.local.backup"));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (!url.includes("tvcurcnmasnocwdxzgvz")) {
  throw new Error(`Refusing non-production URL: ${url}`);
}

const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

const FY = 2026;
const AUGUST = 7;

async function main() {
  const { data: tenants, error: tenantError } = await admin
    .from("tenants")
    .select("id, name, slug")
    .or("name.ilike.%nextr%,slug.ilike.%nextr%");

  if (tenantError) throw new Error(tenantError.message);
  console.log("=== matching tenants ===");
  console.log(tenants);

  const tenant = tenants?.[0];
  if (!tenant) throw new Error("Nextronics tenant not found");

  const TENANT_ID = tenant.id;
  console.log("\nUsing tenant:", tenant.name, TENANT_ID);

  const { data: sale, error: saleError } = await admin
    .from("income_register")
    .select(
      "id, date, invoice_no, entry_type, sale_status, product_id, sale_quantity, unit_price, amount, cogs_expense_id, cogs_reversal_expense_id, product:finished_products!product_id(id, product_code, product_name, current_stock, unit_of_measure)",
    )
    .eq("tenant_id", TENANT_ID)
    .eq("invoice_no", "NEXTR-POS-0001")
    .maybeSingle();

  if (saleError) throw new Error(saleError.message);
  console.log("\n=== NEXTR-POS-0001 sale ===");
  console.log(sale);

  let cogsExpense: {
    id: string;
    amount: number;
    price: number;
    quantity: number;
    receipt_no: string;
  } | null = null;

  if (sale?.cogs_expense_id) {
    const { data, error } = await admin
      .from("expense_register")
      .select("id, date, amount, price, quantity, receipt_no, description, payment_status")
      .eq("id", sale.cogs_expense_id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    cogsExpense = data;
  }
  console.log("\n=== linked COGS expense ===");
  console.log(cogsExpense);

  const productId = sale?.product_id;
  if (productId) {
    const { data: batches, error: batchError } = await admin
      .from("production_batches")
      .select(
        "id, batch_number, quantity_produced, total_batch_cost, remaining_quantity, manufacturing_date, expiration_date, created_at",
      )
      .eq("finished_product_id", productId)
      .order("created_at", { ascending: true });
    if (batchError) throw new Error(batchError.message);

    const { data: purchases, error: purchaseError } = await admin
      .from("product_purchases")
      .select("id, purchase_date, quantity, total_cost, cost_per_unit")
      .eq("product_id", productId)
      .order("purchase_date", { ascending: true });
    if (purchaseError) throw new Error(purchaseError.message);

    const { data: movements, error: moveError } = await admin
      .from("stock_movements")
      .select("id, movement_type, quantity, movement_date, notes, reference_id")
      .eq("product_id", productId)
      .order("movement_date", { ascending: true });
    if (moveError) throw new Error(moveError.message);

    console.log("\n=== product batches ===");
    console.log(batches);
    console.log("\n=== product purchases ===");
    console.log(purchases);
    console.log("\n=== stock movements ===");
    console.log(movements);

    const product = Array.isArray(sale.product) ? sale.product[0] : sale.product;
    const stock = Number(product?.current_stock) || 0;
    const batchQtySum = (batches ?? []).reduce(
      (s, b) => s + (Number(b.remaining_quantity ?? b.quantity_produced) || 0),
      0,
    );
    const batchCostSum = (batches ?? []).reduce(
      (s, b) => s + (Number(b.total_batch_cost) || 0),
      0,
    );
    const batchProdQty = (batches ?? []).reduce(
      (s, b) => s + (Number(b.quantity_produced) || 0),
      0,
    );
    const purchaseCostSum = (purchases ?? []).reduce(
      (s, p) => s + (Number(p.total_cost) || 0),
      0,
    );
    const purchaseQtySum = (purchases ?? []).reduce(
      (s, p) => s + (Number(p.quantity) || 0),
      0,
    );

  const { data: purchaseDetail } = await admin
    .from("product_purchases")
    .select("purchase_date, total_cost, payment_method, created_at, tenant_id")
    .eq("product_id", productId!);

  console.log("\n=== product purchase detail (payment) ===");
  console.log(purchaseDetail);

  const { data: avgRows, error: avgError } = await admin.rpc(
    "get_finished_product_average_costs",
    { p_tenant_id: TENANT_ID },
  );
  if (avgError) throw new Error(avgError.message);
  console.log("\n=== all tenant finished product avg costs ===");
  console.log(avgRows);
    const bsAvg =
      (avgRows ?? []).find(
        (r: { product_id: string }) => r.product_id === productId,
      )?.average_cost ?? 0;

    const { data: wacCost, error: wacError } = await admin.rpc(
      "finished_product_weighted_avg_cost",
      { p_product_id: productId },
    );
    if (wacError) throw new Error(wacError.message);

    const cogsAmount = Number(cogsExpense?.amount) || 0;
    const saleQty = Number(sale?.sale_quantity) || 0;
    const bsInventoryValue = r2(stock * Number(bsAvg));
    const lifetimeWac = r2(
      (batchCostSum + purchaseCostSum) / (batchProdQty + purchaseQtySum || 1),
    );
    const carryingValue = r2(batchCostSum + purchaseCostSum - cogsAmount);
    const onHandWac = stock > 0 ? r2(carryingValue / stock) : 0;

    console.log("\n=== valuation comparison ===");
    console.log({
      product: product?.product_name,
      current_stock: stock,
      batch_remaining_qty_sum: batchQtySum,
      sale_quantity: saleQty,
      cogs_amount: cogsAmount,
      cogs_unit_from_expense: saleQty ? r2(cogsAmount / saleQty) : null,
      get_finished_product_average_costs: Number(bsAvg),
      finished_product_weighted_avg_cost_rpc: Number(wacCost),
      lifetime_lot_wac: lifetimeWac,
      bs_inventory_value: bsInventoryValue,
      carrying_value_production_plus_purchases_minus_cogs: carryingValue,
      on_hand_wac_implied: onHandWac,
      inventory_gap_if_lifetime_wac: r2(bsInventoryValue - carryingValue),
    });
  }

  const inv = await fetchInventoryBalanceSheetInput(admin, TENANT_ID);
  console.log("\n=== inventory_balance_config ===");
  console.log(inv.config);

  const liveInventory = calculateTotalInventoryValue(
    inv.rawMaterials,
    inv.finishedProducts,
    inv.finishedProductAverageCosts,
  );
  console.log("live total inventory (BS method):", liveInventory);

  const [
    { data: incomeEntries },
    { data: expenseEntries },
    { data: fixedAssets },
    { data: payableEntries },
    { data: capitalContributions },
    { data: manualEntries },
    { data: payrollHistory },
    { data: payrollProcessing },
    { data: monthEndCloseRecords },
    { data: taxLedgerEntries },
  ] = await Promise.all([
    admin.from("income_register").select("*").eq("tenant_id", TENANT_ID),
    admin.from("expense_register").select("*").eq("tenant_id", TENANT_ID),
    admin.from("fixed_assets").select("*").eq("tenant_id", TENANT_ID),
    admin.from("accounts_payable").select("*").eq("tenant_id", TENANT_ID),
    admin.from("capital_contributions").select("*").eq("tenant_id", TENANT_ID),
    admin.from("manual_financial_entries").select("*").eq("tenant_id", TENANT_ID),
    admin.from("payroll_history").select("*").eq("tenant_id", TENANT_ID),
    admin.from("payroll_processing").select("*").eq("tenant_id", TENANT_ID),
    admin.from("month_end_close").select("*").eq("tenant_id", TENANT_ID),
    admin.from("tax_ledger_entries").select("*").eq("tenant_id", TENANT_ID),
  ]);

  const payrollWages = mergePayrollWagesSources(
    payrollHistory ?? [],
    payrollProcessing ?? [],
  );

  const cashFlowExpenseEntries =
    (expenseEntries ?? []).map((entry) => ({
      date: entry.date,
      expense_category: entry.expense_category,
      sub_category: entry.sub_category,
      amount: entry.amount,
      payment_status: entry.payment_status,
      description: entry.description ?? null,
      receipt_no: entry.receipt_no ?? null,
    }));

  const report = buildBalanceSheetReport(
    incomeEntries ?? [],
    expenseEntries ?? [],
    fixedAssets ?? [],
    payableEntries ?? [],
    capitalContributions ?? [],
    cashFlowExpenseEntries,
    payrollWages,
    (monthEndCloseRecords ?? []).map((r) => ({
      month: r.month,
      total_net_pay: r.total_net_pay,
    })),
    FY,
    inv,
    manualEntries ?? [],
    taxLedgerEntries ?? [],
  );

  const check = getBalanceCheckForPeriod(report, AUGUST);
  console.log("\n=== August 2026 balance check ===");
  console.log(check);

  const inventoryRow = report.rows.find((r) => r.key === "inventory");
  const retainedRow = report.rows.find((r) => r.key === "retained_earnings");
  const cogsAug = (expenseEntries ?? [])
    .filter(
      (e) =>
        e.expense_category === "Cost of Goods Sold" &&
        String(e.date ?? "").slice(0, 7) === "2026-08",
    )
    .reduce((s, e) => s + (Number(e.amount) || 0), 0);

  console.log("\n=== key BS rows August ===");
  console.log({
    inventory: inventoryRow?.amounts[AUGUST],
    retained_earnings: retainedRow?.amounts[AUGUST],
    august_cogs_total: r2(cogsAug),
    imbalance: check.difference,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
