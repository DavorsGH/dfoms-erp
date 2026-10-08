/**
 * Read-only: locate RET-VOID test artifact on staging.
 * npx tsx scripts/probe-ret-void-test-artifact-staging.ts
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const INVOICE = "DF-POS-RET-VOID-MUZRDBNK";

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
    { auth: { persistSession: false } },
  );

  const { data: sales } = await admin
    .from("income_register")
    .select("id, tenant_id, invoice_no, business_unit_id, product_id, sale_status, amount, cogs_expense_id, cogs_reversal_expense_id, voided_at")
    .ilike("invoice_no", `%MUZRDBNK%`);

  console.log(JSON.stringify({ sales }, null, 2));

  for (const sale of sales ?? []) {
    const { data: tenant } = await admin
      .from("tenants")
      .select("name")
      .eq("id", sale.tenant_id)
      .maybeSingle();
    const { data: bu } = sale.business_unit_id
      ? await admin.from("business_units").select("name").eq("id", sale.business_unit_id).maybeSingle()
      : { data: null };
    const { data: cnLines } = await admin
      .from("credit_note_line_items")
      .select("credit_note_id, quantity, credit_notes(credit_note_number)")
      .eq("source_income_register_id", sale.id);
    const { data: returnIncome } = await admin
      .from("income_register")
      .select("id, invoice_no, amount, is_sale_return, credit_note_id")
      .eq("tenant_id", sale.tenant_id)
      .contains("notes", ["RET-VOID-MUZRDBNK"]);
    console.log({ tenant: tenant?.name, bu: bu?.name, cnLines, returnIncome });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
