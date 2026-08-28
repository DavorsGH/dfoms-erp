/**
 * Read-only: diagnose Caanta opening + Mimshack live/history inventory gap.
 *
 *   npx tsx scripts/_probe-month-aware-inv-edge-cases-production.ts --env-file .env.local.backup --allow-production
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { fetchInventoryBalanceSheetInput } from "../app/dashboard/finance/balance-sheet-page-data";
import {
  calculateInventoryValueAsOf,
  calculateTotalInventoryValue,
  getActivatedInventoryPurchaseEffectiveDate,
  getFinishedProductInflowEffectiveDate,
} from "../app/dashboard/inventory/inventory-balance-sheet-utils";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const CAANTA = "12df4ee6-3fd1-459f-8d5c-792b5d5b3821";
const MIMSHACK = "mimshack"; // resolved by name

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

async function main() {
  loadEnv(resolve(process.cwd(), ".env.local.backup"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!url.includes(PRODUCTION_REF)) throw new Error("expected production");
  if (!process.argv.includes("--allow-production")) {
    throw new Error("pass --allow-production");
  }
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const { data: tenants } = await admin.from("tenants").select("id, name");
  const mimshack = (tenants ?? []).find((t) =>
    String(t.name).toLowerCase().includes("mimshack"),
  );
  if (!mimshack) throw new Error("Mimshack tenant not found");

  for (const [label, id] of [
    ["Caanta", CAANTA],
    ["Mimshack", String(mimshack.id)],
  ] as const) {
    const inv = await fetchInventoryBalanceSheetInput(admin, id);
    const hist = inv.valuationHistory!;
    const live = calculateTotalInventoryValue(
      inv.rawMaterials,
      inv.finishedProducts,
      inv.finishedProductAverageCosts,
    );
    const asOf = "2026-08-24";
    const histToday = calculateInventoryValueAsOf(hist, inv.config, asOf);

    const inflowDates = hist.finishedProductInflows.map((row) => ({
      source: row.source,
      event: row.event_date,
      created: row.created_at,
      effective: getFinishedProductInflowEffectiveDate(
        row,
        inv.config,
        row.source,
      ),
      cost: row.total_cost,
    }));
    const rmDates = hist.rawMaterialPurchases.map((row) => ({
      event: row.purchase_date,
      created: row.created_at,
      effective: getActivatedInventoryPurchaseEffectiveDate(
        {
          purchase_date: row.purchase_date,
          created_at: row.created_at,
        },
        inv.config,
      ),
      qty: row.quantity,
      unit: row.cost_per_unit,
      cost: r2(row.quantity * row.cost_per_unit),
    }));
    const cogs = hist.finishedProductCogs.map((row) => ({
      sale: row.sale_date,
      amount: row.cogs_amount,
    }));

    console.log(`\n=== ${label} ===`);
    console.log(
      JSON.stringify(
        {
          goLive: inv.config?.go_live_date,
          openingEquity: inv.config?.opening_inventory_value,
          live: r2(live),
          histToday: r2(histToday),
          gap: r2(live - histToday),
          jul31: calculateInventoryValueAsOf(hist, inv.config, "2026-07-31"),
          counts: {
            fpIn: hist.finishedProductInflows.length,
            cogs: hist.finishedProductCogs.length,
            rmP: hist.rawMaterialPurchases.length,
            rmC: hist.rawMaterialConsumptions.length,
          },
          inflowDates,
          rmDates,
          cogs,
          fpStock: inv.finishedProducts.map((p) => ({
            name: p.product_name,
            stock: p.current_stock,
          })),
          rmStock: inv.rawMaterials.map((m) => ({
            name: m.material_name,
            stock: m.current_stock,
            avg: m.average_cost_per_unit,
          })),
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
