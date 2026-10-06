import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const TENANT = "00000001-0000-4000-8000-000000000001";

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

async function main() {
  loadEnv(resolve(".env.staging.local"));
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  for (const table of ["finished_product_balances", "raw_material_balances"] as const) {
    const { data, count } = await admin
      .from(table)
      .select("product_id,material_id,current_stock,average_cost_per_unit", {
        count: "exact",
      })
      .eq("tenant_id", TENANT)
      .is("business_unit_id", null)
      .gt("current_stock", 0);
    console.log(table, "null BU rows with stock:", count);
    for (const row of data ?? []) {
      console.log(" ", row);
    }
  }

  for (const code of ["CAN-FP-0004", "SKU-1003", "VOID-DATE-TEST"]) {
    const { data: fp } = await admin
      .from("finished_products")
      .select("id,product_code,tenant_id")
      .eq("product_code", code)
      .maybeSingle();
    if (!fp) continue;
    const { data: rows } = await admin
      .from("finished_product_balances")
      .select("tenant_id,business_unit_id,current_stock,average_cost_per_unit")
      .eq("product_id", fp.id);
    console.log("\n", code, rows);
    for (const r of rows ?? []) {
      const { data: wac, error } = await admin.rpc(
        "finished_product_weighted_avg_cost_scoped",
        { p_product_id: fp.id, p_business_unit_id: r.business_unit_id },
      );
      console.log(
        "  stored",
        r.average_cost_per_unit,
        "formula",
        error ? error.message : wac,
      );
    }
  }
}

main();
