/**
 * Staging: repro partial-stock lifetime-WAC vs on-hand-WAC (script 145).
 * Creates purchase + partial sale, verifies BS inventory = carrying value.
 * Run: npx tsx scripts/test-145-partial-stock-repro-staging.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  buildAverageFinishedProductCostMap,
  calculateTotalInventoryValue,
} from "../app/dashboard/inventory/inventory-balance-sheet-utils";
import { fetchInventoryBalanceSheetInput } from "../app/dashboard/finance/balance-sheet-page-data";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const CAANTA = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";

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
  return Math.round(Number(n || 0) * 100) / 100;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

loadEnvForce(resolve(".env.staging.local"));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
assert(url.includes(STAGING_REF), `Refusing non-staging URL: ${url}`);

const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

const tag = `WAC145${Date.now().toString(36).toUpperCase()}`;
const today = new Date().toISOString().slice(0, 10);

async function lifetimeWac(productId: string): Promise<number> {
  const [{ data: batches }, { data: purchases }] = await Promise.all([
    admin
      .from("production_batches")
      .select("total_batch_cost, quantity_produced")
      .eq("finished_product_id", productId),
    admin
      .from("product_purchases")
      .select("total_cost, quantity")
      .eq("product_id", productId),
  ]);
  let cost = 0;
  let qty = 0;
  for (const row of batches ?? []) {
    cost += Number(row.total_batch_cost) || 0;
    qty += Number(row.quantity_produced) || 0;
  }
  for (const row of purchases ?? []) {
    cost += Number(row.total_cost) || 0;
    qty += Number(row.quantity) || 0;
  }
  return qty > 0 ? r2(cost / qty) : 0;
}

async function main() {
  const { data: product, error: productError } = await admin
    .from("finished_products")
    .insert({
      tenant_id: CAANTA,
      product_code: `${tag}-FP`,
      product_name: `${tag} WAC test product`,
      unit_of_measure: "Pcs",
      current_stock: 0,
      standard_selling_price: 15,
      sourcing_type: "purchased",
    })
    .select("id, product_name, current_stock")
    .single();
  if (productError || !product) {
    throw new Error(productError?.message ?? "product insert failed");
  }

  const { data: supplier } = await admin
    .from("suppliers")
    .select("id")
    .eq("tenant_id", CAANTA)
    .limit(1)
    .maybeSingle();
  assert(supplier?.id, "Need Caanta supplier");

  const { data: customer } = await admin
    .from("customers")
    .select("client_id")
    .eq("tenant_id", CAANTA)
    .limit(1)
    .maybeSingle();
  assert(customer?.client_id, "Need Caanta customer");

  await admin.from("inventory_balance_config").upsert(
    {
      tenant_id: CAANTA,
      go_live_date: "2026-01-01",
      opening_inventory_value: 0,
    },
    { onConflict: "tenant_id" },
  );

  const firstPurchaseQty = 80;
  const firstUnitCost = 9.375;
  const firstTotal = r2(firstPurchaseQty * firstUnitCost);

  const { data: purchaseRow1, error: purchase1Error } = await admin
    .from("product_purchases")
    .insert({
      tenant_id: CAANTA,
      product_id: product.id,
      purchase_date: today,
      quantity: firstPurchaseQty,
      cost_per_unit: firstUnitCost,
      total_cost: firstTotal,
      supplier_id: supplier.id,
      payment_method: "Cash",
      notes: `${tag} first purchase`,
    })
    .select("id")
    .single();
  assert(!purchase1Error && purchaseRow1?.id, purchase1Error?.message ?? "purchase1 failed");

  const secondPurchaseQty = 20;
  const secondUnitCost = 12;
  const secondTotal = r2(secondPurchaseQty * secondUnitCost);

  const { data: purchaseRow2, error: purchase2Error } = await admin
    .from("product_purchases")
    .insert({
      tenant_id: CAANTA,
      product_id: product.id,
      purchase_date: today,
      quantity: secondPurchaseQty,
      cost_per_unit: secondUnitCost,
      total_cost: secondTotal,
      supplier_id: supplier.id,
      payment_method: "Cash",
      notes: `${tag} second purchase (higher cost blend)`,
    })
    .select("id")
    .single();
  assert(!purchase2Error && purchaseRow2?.id, purchase2Error?.message ?? "purchase2 failed");

  const purchaseQty = firstPurchaseQty + secondPurchaseQty;
  const purchaseTotal = r2(firstTotal + secondTotal);

  await admin
    .from("finished_products")
    .update({ current_stock: purchaseQty })
    .eq("id", product.id);

  const saleQty = 18;
  const { data: saleId, error: saleError } = await admin.rpc(
    "create_product_sale",
    {
      p_date: today,
      p_invoice_no: `${tag}-SALE`,
      p_client_id: customer.client_id,
      p_customer_name: null,
      p_product_id: product.id,
      p_quantity: saleQty,
      p_unit_price: 15,
      p_amount_received: saleQty * 15,
      p_payment_status: "Paid",
      p_due_date: today,
      p_description: `${tag} partial sale`,
      p_notes: tag,
      p_invoice_entity_type: "PSI",
      p_sales_rep_id: null,
    },
  );
  assert(!saleError && saleId, saleError?.message ?? "sale failed");

  const { data: updatedProduct } = await admin
    .from("finished_products")
    .select("current_stock")
    .eq("id", product.id)
    .single();

  const stock = Number(updatedProduct?.current_stock) || 0;
  assert(
    stock === purchaseQty - saleQty,
    `expected stock ${purchaseQty - saleQty}, got ${stock}`,
  );

  const { data: onHandRpc } = await admin.rpc("finished_product_weighted_avg_cost", {
    p_product_id: product.id,
  });
  const onHandAvg = Number(onHandRpc) || 0;

  const lifetime = await lifetimeWac(product.id);
  const { data: cogsExpense } = await admin
    .from("income_register")
    .select("cogs_expense_id")
    .eq("id", saleId)
    .single();
  let cogsAmount = 0;
  if (cogsExpense?.cogs_expense_id) {
    const { data: cogsRow } = await admin
      .from("expense_register")
      .select("amount")
      .eq("id", cogsExpense.cogs_expense_id)
      .single();
    cogsAmount = Number(cogsRow?.amount) || 0;
  }

  const expectedCarrying = r2(purchaseTotal - cogsAmount);
  const bsValue = r2(stock * onHandAvg);
  const lifetimeValue = r2(stock * lifetime);

  const inv = await fetchInventoryBalanceSheetInput(admin, CAANTA);
  const avgMap = buildAverageFinishedProductCostMap(
    inv.finishedProductAverageCosts,
  );
  const rpcAvg = avgMap.get(product.id) ?? 0;

  const report = {
    tag,
    product_id: product.id,
    stock,
    purchase_total_cost: purchaseTotal,
    sale_qty: saleQty,
    cogs_amount: cogsAmount,
    on_hand_wac_rpc: onHandAvg,
    get_finished_product_average_costs: rpcAvg,
    lifetime_lot_wac: lifetime,
    bs_inventory_value: bsValue,
    lifetime_would_value_at: lifetimeValue,
    carrying_value: expectedCarrying,
    lifetime_minus_bs: r2(lifetimeValue - bsValue),
    bs_minus_carrying: r2(bsValue - expectedCarrying),
    script145_expectation: {
      on_hand_wac: stock > 0 ? r2(expectedCarrying / stock) : 0,
      carrying: expectedCarrying,
    },
  };

  console.log(JSON.stringify(report, null, 2));

  assert(
    Math.abs(bsValue - expectedCarrying) <= 0.01,
    `BS inventory ${bsValue} should equal carrying ${expectedCarrying}`,
  );
  assert(
    Math.abs(rpcAvg - onHandAvg) <= 0.0001,
    "get_finished_product_average_costs must match finished_product_weighted_avg_cost",
  );

  if (Math.abs(lifetimeValue - bsValue) > 0.01) {
    console.log(
      `Note: lifetime lot WAC would value stock at ${lifetimeValue} vs on-hand ${bsValue}`,
    );
  }

  console.log("PASS script 145 partial-stock repro on staging");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
