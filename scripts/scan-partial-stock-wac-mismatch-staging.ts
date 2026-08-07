/**
 * Staging: scan all tenants for lifetime-WAC vs on-hand-WAC inventory mismatch.
 * Run: npx tsx scripts/scan-partial-stock-wac-mismatch-staging.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  buildAverageFinishedProductCostMap,
  calculateTotalInventoryValue,
} from "../app/dashboard/inventory/inventory-balance-sheet-utils";
import { fetchInventoryBalanceSheetInput } from "../app/dashboard/finance/balance-sheet-page-data";

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

loadEnvForce(resolve(".env.staging.local"));
const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
if (!url.includes("wieflwbfdmjtsdnwbfii")) {
  throw new Error(`Refusing non-staging URL: ${url}`);
}

const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
  auth: { persistSession: false },
});

async function lifetimeWac(
  tenantId: string,
  productId: string,
): Promise<number> {
  const [{ data: batches }, { data: purchases }] = await Promise.all([
    admin
      .from("production_batches")
      .select("total_batch_cost, quantity_produced")
      .eq("tenant_id", tenantId)
      .eq("finished_product_id", productId),
    admin
      .from("product_purchases")
      .select("total_cost, quantity")
      .eq("tenant_id", tenantId)
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

async function netCogs(productId: string): Promise<number> {
  const { data: sales } = await admin
    .from("income_register")
    .select("cogs_expense_id, cogs_reversal_expense_id")
    .eq("product_id", productId)
    .eq("entry_type", "product_sale");

  const ids = new Set(
    (sales ?? [])
      .flatMap((s) => [s.cogs_expense_id, s.cogs_reversal_expense_id])
      .filter(Boolean) as string[],
  );
  if (ids.size === 0) return 0;

  const { data: cogsRows } = await admin
    .from("expense_register")
    .select("id, amount")
    .in("id", [...ids]);

  return r2((cogsRows ?? []).reduce((s, r) => s + (Number(r.amount) || 0), 0));
}

async function costIn(productId: string): Promise<number> {
  const [{ data: batches }, { data: purchases }] = await Promise.all([
    admin
      .from("production_batches")
      .select("total_batch_cost")
      .eq("finished_product_id", productId),
    admin
      .from("product_purchases")
      .select("total_cost")
      .eq("product_id", productId),
  ]);
  let total = 0;
  for (const row of batches ?? []) total += Number(row.total_batch_cost) || 0;
  for (const row of purchases ?? []) total += Number(row.total_cost) || 0;
  return r2(total);
}

async function main() {
  const { data: tenants } = await admin
    .from("tenants")
    .select("id, name, slug")
    .order("name");

  const mismatches: Array<Record<string, unknown>> = [];

  for (const tenant of tenants ?? []) {
    const inv = await fetchInventoryBalanceSheetInput(admin, tenant.id);
    const bsInventory = calculateTotalInventoryValue(
      inv.rawMaterials,
      inv.finishedProducts,
      inv.finishedProductAverageCosts,
    );

    const avgMap = buildAverageFinishedProductCostMap(
      inv.finishedProductAverageCosts,
    );

    for (const product of inv.finishedProducts) {
      const stock = Number(product.current_stock) || 0;
      if (stock <= 0) continue;

      const onHandAvg = avgMap.get(product.id) ?? 0;
      const bsValue = r2(stock * onHandAvg);
      const lifetime = await lifetimeWac(tenant.id, product.id);
      const lifetimeValue = r2(stock * lifetime);
      const carrying = r2((await costIn(product.id)) - (await netCogs(product.id)));

      if (Math.abs(bsValue - carrying) > 0.01) {
        mismatches.push({
          tenant: tenant.name,
          tenant_id: tenant.id,
          product: (product as { product_name?: string }).product_name,
          stock,
          on_hand_avg_rpc: onHandAvg,
          lifetime_wac: lifetime,
          bs_inventory_value: bsValue,
          carrying_value: carrying,
          lifetime_stock_value: lifetimeValue,
          bs_minus_carrying: r2(bsValue - carrying),
          lifetime_minus_bs: r2(lifetimeValue - bsValue),
        });
      }
    }

    console.log(
      JSON.stringify({
        tenant: tenant.name,
        bs_total_inventory: bsInventory,
        partial_stock_products: inv.finishedProducts.filter(
          (p) => Number(p.current_stock) > 0,
        ).length,
      }),
    );
  }

  console.log("\n=== Partial-stock WAC alignment (should be empty after 145) ===");
  if (mismatches.length === 0) {
    console.log("PASS — all partial-stock products: BS value = carrying = stock × on-hand WAC");
  } else {
    console.table(mismatches);
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
