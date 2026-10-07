/**
 * Read-only Step 44 item 1: Oct–Dec 2026 BS gaps + suspicious Davors rows (no writes).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { fetchBalanceSheetPageData } from "../../app/dashboard/finance/balance-sheet-page-data";
import {
  buildStandardBalanceSheetReport,
  getBalanceSheetMonthCheck,
} from "../../lib/finance/balance-sheet-standard-report";

const DAVORS = "00000001-0000-4000-8000-000000000001";
const FY = 2026;
const FACILITIES = "de215200-e92b-48e3-a7ba-977d7289868c";
const TECH = "d251c562-d522-43ec-8d9c-d1d00d4105b0";

function loadEnv() {
  for (const line of readFileSync(resolve(".env.staging.local"), "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
}

async function main() {
  loadEnv();
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const { data: bus } = await admin
    .from("business_units")
    .select("id, name")
    .eq("tenant_id", DAVORS);

  console.log("=== Oct–Dec 2026 balance check (exact difference) ===");
  const scopes = [
    { label: "All businesses", fetch: { viewAllBusinessUnits: true as const } },
    ...(bus ?? []).map((bu) => ({
      label: bu.name,
      fetch: { viewAllBusinessUnits: false as const, activeBusinessUnitId: bu.id },
    })),
  ];
  for (const scope of scopes) {
    const data = await fetchBalanceSheetPageData(admin, DAVORS, scope.fetch);
    const report = buildStandardBalanceSheetReport(data, DAVORS, FY);
    const parts: string[] = [];
    for (let mi = 9; mi <= 11; mi++) {
      const c = getBalanceSheetMonthCheck(report, mi);
      if (Math.abs(c.difference) >= 0.005) {
        parts.push(`month${mi + 1}=${c.difference}`);
      }
    }
    console.log(scope.label + ":", parts.length ? parts.join(", ") : "balanced Oct–Dec");
  }

  const { data: exp } = await admin
    .from("expense_register")
    .select("amount, date, expense_category, description, business_unit_id, receipt_no")
    .eq("tenant_id", DAVORS)
    .eq("business_unit_id", FACILITIES)
    .eq("expense_category", "Direct Operational")
    .gte("date", "2026-10-01")
    .lte("date", "2026-10-31");
  const directOp = Math.round(
    (exp ?? []).reduce((a, r) => a + (Number(r.amount) || 0), 0) * 100,
  ) / 100;
  console.log("\nFacilities Oct Direct Operational sum:", directOp, "(target 1818.50)");

  const { data: fp } = await admin
    .from("finished_products")
    .select("id")
    .eq("product_code", "SKU-1003")
    .eq("tenant_id", DAVORS)
    .maybeSingle();
  if (fp?.id) {
    const { data: bal } = await admin
      .from("finished_product_balances")
      .select("business_unit_id, current_stock")
      .eq("product_id", fp.id);
    console.log("SKU-1003 balances:", bal);
    const fac = (bal ?? []).find((b) => b.business_unit_id === FACILITIES);
    console.log("Facilities SKU-1003 stock:", fac?.current_stock ?? "—", "(target 271)");
  }

  console.log("\n=== Suspicious Davors rows (Oct 2026+) ===");
  const tables = [
    {
      name: "finished_product_stock_adjustments",
      q: admin
        .from("finished_product_stock_adjustments")
        .select("id, business_unit_id, adjustment_type, quantity_delta, cost_per_unit, reason, created_at")
        .eq("tenant_id", DAVORS)
        .gte("created_at", "2026-10-01T00:00:00Z"),
    },
    {
      name: "raw_material_stock_adjustments",
      q: admin
        .from("raw_material_stock_adjustments")
        .select("id, business_unit_id, adjustment_type, quantity_delta, cost_per_unit, reason, created_at")
        .eq("tenant_id", DAVORS)
        .gte("created_at", "2026-10-01T00:00:00Z"),
    },
    {
      name: "inventory_stock_adjustment_register_links",
      q: admin
        .from("inventory_stock_adjustment_register_links")
        .select("*")
        .eq("tenant_id", DAVORS)
        .gte("created_at", "2026-10-01T00:00:00Z"),
    },
    {
      name: "internal_consumption",
      q: admin
        .from("internal_consumption")
        .select("id, business_unit_id, quantity, consumption_date, reason")
        .eq("tenant_id", DAVORS)
        .gte("consumption_date", "2026-10-01"),
    },
    {
      name: "income_register (stock adj)",
      q: admin
        .from("income_register")
        .select("id, amount, business_unit_id, date, description, invoice_no")
        .eq("tenant_id", DAVORS)
        .gte("date", "2026-10-01")
        .ilike("description", "%stock adjustment%"),
    },
    {
      name: "Technologies BU FP balances (any stock)",
      q: admin
        .from("finished_product_balances")
        .select("product_id, current_stock, average_cost_per_unit")
        .eq("tenant_id", DAVORS)
        .eq("business_unit_id", TECH)
        .gt("current_stock", 0),
    },
  ];
  for (const t of tables) {
    const { data, error } = await t.q;
    console.log(`\n${t.name}:`, error?.message ?? `${data?.length ?? 0} rows`, data);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
