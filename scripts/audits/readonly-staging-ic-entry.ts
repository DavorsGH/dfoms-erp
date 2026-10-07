import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const IC_ENTRY = "473d040d-089a-4899-90d3-5c6461a702ba";

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

  const { data: ic, error } = await admin
    .from("internal_consumption")
    .select("id, quantity, consumption_date, expense_register_id, product_id")
    .eq("id", IC_ENTRY)
    .maybeSingle();

  if (error || !ic) {
    console.log("IC:", error?.message ?? "not found");
    return;
  }
  console.log("internal_consumption:", ic);

  if (ic.expense_register_id) {
    const { data: exp } = await admin
      .from("expense_register")
      .select("amount, description, business_unit_id, receipt_no")
      .eq("id", ic.expense_register_id)
      .maybeSingle();
    console.log("expense_register:", exp);
  }
}

main();
