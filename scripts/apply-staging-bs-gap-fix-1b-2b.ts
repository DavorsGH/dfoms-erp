/**
 * Apply David-approved staging BS gap fixes 1B + 2B (Davors FY2026).
 * Staging only — refuses non-staging project ref.
 *
 * Usage: npx tsx scripts/apply-staging-bs-gap-fix-1b-2b.ts
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const STAGING = "wieflwbfdmjtsdnwbfii";
const TENANT = "00000001-0000-4000-8000-000000000001";

const JUNE_INVOICE_ID = "381db9c1-e52e-443d-9b42-c6e352427262";
const JUNE_TAX_IDS = [
  "6697a6cd-0956-427c-bce3-51611494a11c",
  "16b35ccb-ba4f-40f6-8ce1-332cd3404b9a",
];

const SODA_PRODUCT_ID = "bb33b3bf-a876-4e15-b34d-afd8da223bbc";
const POS_INVOICES = ["DF-POS-0001", "DF-POS-0002", "DF-POS-0003"];
const COGS_RECEIPTS = [
  "COGS-DF-POS-0001",
  "COGS-DF-POS-0002",
  "COGS-DF-POS-0003",
  "VOID-COGS-DF-POS-0003",
];

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

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  loadEnv(resolve(".env.staging.local"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  assert(url.includes(STAGING), `Refusing: expected staging (${STAGING}), got ${url}`);

  const admin = createClient(
    url,
    process.env.SUPABASE_SERVICE_ROLE_KEY ?? "",
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  console.log("=== Option 1B: delete INV-2026-06-001 + tax legs ===");

  const { error: tax1Err, count: tax1Count } = await admin
    .from("tax_ledger_entries")
    .delete({ count: "exact" })
    .in("id", JUNE_TAX_IDS)
    .eq("tenant_id", TENANT);
  assert(!tax1Err, `delete June tax: ${tax1Err?.message}`);
  console.log(`Deleted ${tax1Count ?? 0} tax_ledger_entries (expected 2)`);

  const { error: inv1Err, count: inv1Count } = await admin
    .from("income_register")
    .delete({ count: "exact" })
    .eq("id", JUNE_INVOICE_ID)
    .eq("tenant_id", TENANT)
    .eq("invoice_no", "INV-2026-06-001");
  assert(!inv1Err, `delete June invoice: ${inv1Err?.message}`);
  console.log(`Deleted ${inv1Count ?? 0} income_register row (expected 1)`);

  console.log("\n=== Option 2B: delete Soda Water test chain ===");

  const { data: posSales, error: posErr } = await admin
    .from("income_register")
    .select("id, invoice_no, cogs_expense_id, cogs_reversal_expense_id")
    .eq("tenant_id", TENANT)
    .in("invoice_no", POS_INVOICES);
  assert(!posErr, posErr?.message ?? "pos sales lookup failed");

  const posIncomeIds = (posSales ?? []).map((r) => r.id);
  console.log("POS sales found:", posSales);

  if (posIncomeIds.length > 0) {
    const { error: posTaxErr, count: posTaxCount } = await admin
      .from("tax_ledger_entries")
      .delete({ count: "exact" })
      .eq("tenant_id", TENANT)
      .in("source_id", posIncomeIds);
    assert(!posTaxErr, `delete POS tax legs: ${posTaxErr?.message}`);
    console.log(`Deleted ${posTaxCount ?? 0} tax_ledger_entries for POS sales`);
  }

  const { error: nullCogsErr } = await admin
    .from("income_register")
    .update({ cogs_expense_id: null, cogs_reversal_expense_id: null })
    .eq("tenant_id", TENANT)
    .in("invoice_no", POS_INVOICES);
  assert(!nullCogsErr, `null cogs refs: ${nullCogsErr?.message}`);

  const { error: cogsDelErr, count: cogsCount } = await admin
    .from("expense_register")
    .delete({ count: "exact" })
    .eq("tenant_id", TENANT)
    .in("receipt_no", COGS_RECEIPTS);
  assert(!cogsDelErr, `delete COGS expenses: ${cogsDelErr?.message}`);
  console.log(`Deleted ${cogsCount ?? 0} COGS expense rows (expected 4)`);

  const { error: posIncErr, count: posIncCount } = await admin
    .from("income_register")
    .delete({ count: "exact" })
    .eq("tenant_id", TENANT)
    .in("invoice_no", POS_INVOICES);
  assert(!posIncErr, `delete POS income: ${posIncErr?.message}`);
  console.log(`Deleted ${posIncCount ?? 0} POS income rows (expected 3)`);

  const { error: smErr, count: smCount } = await admin
    .from("stock_movements")
    .delete({ count: "exact" })
    .eq("product_id", SODA_PRODUCT_ID);
  assert(!smErr, `delete stock_movements: ${smErr?.message}`);
  console.log(`Deleted ${smCount ?? 0} stock_movements (expected 8)`);

  const { error: ppErr, count: ppCount } = await admin
    .from("product_purchases")
    .delete({ count: "exact" })
    .eq("tenant_id", TENANT)
    .eq("product_id", SODA_PRODUCT_ID);
  assert(!ppErr, `delete product_purchases: ${ppErr?.message}`);
  console.log(`Deleted ${ppCount ?? 0} product_purchases (expected 4)`);

  const { error: fpErr, count: fpCount } = await admin
    .from("finished_products")
    .delete({ count: "exact" })
    .eq("id", SODA_PRODUCT_ID)
    .eq("tenant_id", TENANT);
  assert(!fpErr, `delete finished_product: ${fpErr?.message}`);
  console.log(`Deleted ${fpCount ?? 0} finished_products (expected 1)`);

  const { data: sodaLeft } = await admin
    .from("finished_products")
    .select("id")
    .eq("id", SODA_PRODUCT_ID);
  assert(!sodaLeft?.length, "Soda Water product still exists");

  const { data: juneLeft } = await admin
    .from("income_register")
    .select("id")
    .eq("id", JUNE_INVOICE_ID);
  assert(!juneLeft?.length, "June invoice still exists");

  console.log("\n✓ Staging fixes 1B + 2B applied successfully.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
