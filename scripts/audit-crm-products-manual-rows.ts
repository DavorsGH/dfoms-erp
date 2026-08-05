/**
 * List crm_products rows that are not Davors ERP Suite tier catalog (manual / other).
 *
 * Usage: npx tsx scripts/audit-crm-products-manual-rows.ts --env-file .env.local
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { ERP_SUITE_CATEGORY } from "../app/dashboard/crm/products/products-utils";
import { DAVORS_TENANT_ID } from "../utils/tenant-signup";

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

function resolveEnvFile(argv: string[]) {
  const idx = argv.indexOf("--env-file");
  if (idx >= 0 && argv[idx + 1]) return argv[idx + 1];
  return ".env.local";
}

async function main() {
  loadEnvForce(resolve(process.cwd(), resolveEnvFile(process.argv.slice(2))));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url || !serviceKey) {
    throw new Error("Missing Supabase URL/keys.");
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  const { data: allRows, error } = await admin
    .from("crm_products")
    .select(
      "id, tenant_id, name, category, product_type, tier_slug, billing_cycle, created_at",
    )
    .order("created_at", { ascending: true });

  if (error) {
    throw new Error(error.message);
  }

  const rows = allRows ?? [];
  const erpSuiteTierRows = rows.filter(
    (row) =>
      row.tenant_id === DAVORS_TENANT_ID &&
      (row.category ?? "").trim() === ERP_SUITE_CATEGORY &&
      row.tier_slug,
  );
  const manualOrOther = rows.filter(
    (row) =>
      !(
        row.tenant_id === DAVORS_TENANT_ID &&
        (row.category ?? "").trim() === ERP_SUITE_CATEGORY &&
        row.tier_slug
      ),
  );

  console.log(JSON.stringify({
    totalRows: rows.length,
    davorsErpSuiteTierRows: erpSuiteTierRows.length,
    manualOrOtherCount: manualOrOther.length,
    manualOrOther: manualOrOther.map((row) => ({
      name: row.name,
      category: row.category,
      created_at: row.created_at,
      tenant_id: row.tenant_id,
      product_type: row.product_type,
      tier_slug: row.tier_slug,
    })),
    erpSuiteTierSample: erpSuiteTierRows.map((row) => ({
      name: row.name,
      category: row.category,
      tier_slug: row.tier_slug,
      created_at: row.created_at,
    })),
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
