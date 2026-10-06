import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const TENANT = "00000001-0000-4000-8000-000000000001";

function loadEnv(f: string) {
  for (const line of readFileSync(f, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
}

async function main() {
  loadEnv(resolve(".env.staging.local"));
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const { data: fp } = await admin
    .from("finished_products")
    .select("id,product_code")
    .eq("tenant_id", TENANT)
    .eq("product_code", "SKU-1003")
    .maybeSingle();
  if (!fp) {
    console.log("SKU-1003 not found");
    return;
  }
  console.log("product", fp);
  const { data: bal } = await admin
    .from("finished_product_balances")
    .select("*")
    .eq("product_id", fp.id);
  console.log("balances", bal);

  const { data: adj } = await admin
    .from("finished_product_stock_adjustments")
    .select("id,adjustment_type,quantity_delta,cost_per_unit,effective_date,created_at,business_unit_id,notes")
    .eq("tenant_id", TENANT)
    .eq("product_id", fp.id)
    .order("created_at");
  console.log("adjustments", adj);

  const { data: pur } = await admin
    .from("product_purchases")
    .select("id,purchase_date,quantity,cost_per_unit,business_unit_id,notes")
    .eq("tenant_id", TENANT)
    .eq("product_id", fp.id);
  console.log("purchases", pur);

  const { data: batches } = await admin
    .from("production_batches")
    .select("id,production_date,finished_product_id,business_unit_id,quantity_produced")
    .eq("tenant_id", TENANT)
    .eq("finished_product_id", fp.id);
  console.log("batches", batches);
}

main();
