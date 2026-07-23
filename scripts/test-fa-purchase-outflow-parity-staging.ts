/**
 * Staging: confirm CF FA purchase outflows match BS for a tenant with assets.
 * Usage: npx tsx scripts/test-fa-purchase-outflow-parity-staging.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { calculateFixedAssetPurchaseOutflowsByMonth } from "../app/dashboard/finance/balance-sheet-utils";
import { buildCashFlowReport } from "../app/dashboard/finance/cash-flow-utils";

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

loadEnvForce(resolve(process.cwd(), ".env.staging.local"));

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  assert(url?.includes("wieflwbfdmjtsdnwbfii"), "Refusing non-staging");
  assert(key, "Missing service role key");

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const DAVORS = "00000001-0000-4000-8000-000000000001";

  const { data: assets, error: assetsError } = await admin
    .from("fixed_assets")
    .select(
      "tenant_id, asset_id, original_cost, quantity, useful_life_years, purchase_date, depreciation_method",
    )
    .order("purchase_date", { ascending: true });

  if (assetsError) throw new Error(assetsError.message);

  const byTenant = new Map<string, NonNullable<typeof assets>>();
  for (const row of assets ?? []) {
    const list = byTenant.get(row.tenant_id) ?? [];
    list.push(row);
    byTenant.set(row.tenant_id, list);
  }

  let tenantId: string | null = null;
  let tenantAssets: NonNullable<typeof assets> = [];
  for (const [id, list] of byTenant) {
    if (list.length > 0) {
      tenantId = id;
      tenantAssets = list;
      if (id === DAVORS) break;
    }
  }

  assert(tenantId && tenantAssets.length > 0, "No fixed_assets rows on staging");

  const years = [
    ...new Set(
      tenantAssets
        .map((a) => Number(String(a.purchase_date).slice(0, 4)))
        .filter((y) => Number.isFinite(y)),
    ),
  ];
  assert(years.length > 0, "No purchase years found");
  const financialYear = years.sort((a, b) => b - a)[0];

  const mapped = tenantAssets.map((a) => ({
    original_cost: Number(a.original_cost) || 0,
    quantity: Number(a.quantity) || 0,
    useful_life_years: Number(a.useful_life_years) || 1,
    purchase_date: a.purchase_date,
    depreciation_method: a.depreciation_method ?? "straight_line",
  }));

  const bsOutflows = calculateFixedAssetPurchaseOutflowsByMonth(
    mapped,
    financialYear,
  );

  const cfReport = buildCashFlowReport(
    [],
    [],
    [],
    financialYear,
    undefined,
    mapped,
  );
  const cfRow = cfReport.rows.find((r) => r.key === "purchase-fixed-assets");
  assert(cfRow, "CF missing purchase-fixed-assets row");

  const mismatches: Array<{ index: number; bs: number; cf: number }> = [];
  for (let i = 0; i < 13; i += 1) {
    const bs = bsOutflows[i] ?? 0;
    const cf = cfRow.amounts[i] ?? 0;
    if (Math.abs(bs - cf) > 0.001) {
      mismatches.push({ index: i, bs, cf });
    }
  }

  const { data: manualRows } = await admin
    .from("manual_financial_entries")
    .select("period_month, purchase_of_fixed_assets")
    .eq("tenant_id", tenantId)
    .order("period_month");

  console.log(
    JSON.stringify(
      {
        tenant_id: tenantId,
        asset_count: mapped.length,
        sample_assets: mapped.slice(0, 3).map((a) => ({
          purchase_date: a.purchase_date,
          cost: a.original_cost * a.quantity,
        })),
        financial_year: financialYear,
        bs_monthly: bsOutflows.slice(0, 12),
        cf_monthly: cfRow.amounts.slice(0, 12),
        bs_full_year: bsOutflows[12],
        cf_full_year: cfRow.amounts[12],
        manual_purchase_of_fixed_assets_rows: manualRows ?? [],
        mismatches,
      },
      null,
      2,
    ),
  );

  assert(
    mismatches.length === 0,
    `BS/CF FA outflow mismatch: ${JSON.stringify(mismatches)}`,
  );
  console.log(
    "PASS: CF purchase-fixed-assets matches BS calculateFixedAssetPurchaseOutflowsByMonth",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
