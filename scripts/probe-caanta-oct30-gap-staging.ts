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
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    process.env[t.slice(0, i).trim()] = v;
  }
}

async function main() {
  loadEnv(resolve(".env.staging.local"));
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const CAANTA = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";

  const { data: income } = await admin
    .from("income_register")
    .select("id, invoice_no, amount, date, notes")
    .eq("tenant_id", CAANTA)
    .gte("date", "2026-10-01")
    .lte("date", "2026-10-31");

  const { data: expenses } = await admin
    .from("expense_register")
    .select("id, amount, date, description, receipt_no, notes, expense_category")
    .eq("tenant_id", CAANTA)
    .gte("date", "2026-10-01")
    .lte("date", "2026-10-31");

  const { data: leftSales } = await admin
    .from("income_register")
    .select("id, invoice_no")
    .eq("tenant_id", CAANTA)
    .like("invoice_no", "DF-POS-RET-VOID%");

  console.log(JSON.stringify({ leftSales, income, expenses }, null, 2));
}

main();
