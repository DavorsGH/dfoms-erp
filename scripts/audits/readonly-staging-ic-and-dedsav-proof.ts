/**
 * Read-only: IC test entry amounts + DEDSAV snapshot helper for reopen/re-lock proof.
 */
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

  const { data: ic, error: icError } = await admin
    .from("internal_consumption")
    .select("id, quantity, unit_cost, total_cost, product_id, business_unit_id")
    .eq("id", IC_ENTRY)
    .maybeSingle();

  if (icError) {
    console.log("IC entry error:", icError.message);
  } else if (!ic) {
    console.log("IC entry not found:", IC_ENTRY);
  } else {
    console.log("IC entry", IC_ENTRY, ic);
  }

  const { data: exp, error: expError } = await admin
    .from("expense_register")
    .select("receipt_no, amount, description, business_unit_id")
    .ilike("description", `%${IC_ENTRY.slice(0, 8)}%`)
    .limit(5);

  if (!expError && exp?.length) {
    console.log("Linked expenses (by description fragment):", exp);
  }

  const { data: dedsav, error: dError } = await admin
    .from("income_register")
    .select("invoice_no, amount, description, business_unit_id, date")
    .ilike("invoice_no", "%DEDSAV%")
    .order("date", { ascending: false })
    .limit(8);

  if (dError) {
    console.log("DEDSAV sample error:", dError.message);
  } else {
    console.log("\nRecent DEDSAV income rows (staging):");
    for (const row of dedsav ?? []) {
      console.log(
        `  ${row.invoice_no} ${String(row.date).slice(0, 10)} amount=${row.amount} bu=${row.business_unit_id ?? "null"}`,
      );
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
