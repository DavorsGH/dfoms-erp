// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadEnv(f) {
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
    .select("id, product_code, current_stock")
    .eq("product_code", "CAN-FP-0004")
    .maybeSingle();
  const { data: fpb } = fp?.id
    ? await admin
        .from("finished_product_balances")
        .select("business_unit_id, current_stock")
        .eq("product_id", fp.id)
    : { data: [] };
  console.log(JSON.stringify({ fp, fpb }, null, 2));
}

main();
