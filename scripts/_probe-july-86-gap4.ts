// @ts-nocheck
/** Confirm inventory 38 composition + whether manual vat_payable is applied. */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadEnv(filePath) {
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

loadEnv(resolve(".env.local.backup"));
const TENANT = "00000001-0000-4000-8000-000000000001";
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

async function main() {
  const { data: fps } = await admin
    .from("finished_products")
    .select("*")
    .eq("tenant_id", TENANT);
  console.log("finished_products:", JSON.stringify(fps, null, 2));

  const { data: stock } = await admin
    .from("finished_product_stock")
    .select("*")
    .eq("tenant_id", TENANT);
  console.log("finished_product_stock:", stock);

  // Any soft-deleted or audit of forfeit income?
  const { data: allIncome } = await admin
    .from("income_register")
    .select("id, invoice_no, amount, date, description, notes, service_category")
    .eq("tenant_id", TENANT);
  console.log("income ids:", allIncome?.map((r) => r.invoice_no));

  // Search notes containing 88.09 anywhere in expenses
  const { data: exp } = await admin
    .from("expense_register")
    .select("receipt_no, amount, notes, description, date")
    .eq("tenant_id", TENANT)
    .or("notes.ilike.%88.09%,notes.ilike.%forfeit%,description.ilike.%forfeit%");
  console.log("expense forfeit/88.09:", exp);

  // July cash movement: why -40?
  // Sum July paid expenses vs capital vs income received
  const { data: julyExp } = await admin
    .from("expense_register")
    .select("amount, payment_status, date, receipt_no, expense_category, description")
    .eq("tenant_id", TENANT)
    .gte("date", "2026-07-01")
    .lte("date", "2026-07-31");

  let paid = 0;
  for (const e of julyExp ?? []) {
    if (String(e.payment_status).toLowerCase() === "paid") {
      paid += Number(e.amount) || 0;
      console.log("paid exp", e.date, e.amount, e.receipt_no, e.description);
    }
  }
  console.log("July paid expenses sum:", Math.round(paid * 100) / 100);

  const { data: julyCap } = await admin
    .from("capital_contributions")
    .select("amount, date, description")
    .eq("tenant_id", TENANT)
    .gte("date", "2026-07-01")
    .lte("date", "2026-07-31");
  const capSum = (julyCap ?? []).reduce((s, r) => s + (Number(r.amount) || 0), 0);
  console.log("July capital sum:", capSum, julyCap);
  console.log("July capital - paid exp (excl payroll pending):", Math.round((capSum - paid) * 100) / 100);
}

main().catch(console.error);
