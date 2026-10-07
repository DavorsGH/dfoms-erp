import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const FACILITIES = "de215200-e92b-48e3-a7ba-977d7289868c";

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
  const root = resolve(import.meta.dirname, "../..");
  loadEnv(resolve(root, ".env.staging.local"));
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const { data: products } = await admin
    .from("finished_products")
    .select("id, sku, product_name")
    .ilike("sku", "%1003%")
    .limit(3);

  console.log("Products:", products);

  const productId = products?.[0]?.id;
  if (!productId) return;

  const { data: icRows } = await admin
    .from("internal_consumption")
    .select("id, quantity, consumption_date, expense_register_id")
    .eq("product_id", productId)
    .order("created_at", { ascending: false })
    .limit(5);

  console.log("Recent IC rows:", icRows);

  for (const row of icRows ?? []) {
    if (!row.expense_register_id) continue;
    const { data: exp } = await admin
      .from("expense_register")
      .select("amount, business_unit_id, description")
      .eq("id", row.expense_register_id)
      .maybeSingle();
    console.log(`IC ${row.id} qty=${row.quantity} expense=`, exp);
  }
}

main();
