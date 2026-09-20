/**
 * Read-only: trace COGS-DF-POS-0010 linkage chain on staging.
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const DAVORS = "00000001-0000-4000-8000-000000000001";

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
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );

  const { data: cogsExp } = await admin
    .from("expense_register")
    .select("*")
    .eq("tenant_id", DAVORS)
    .eq("receipt_no", "COGS-DF-POS-0010")
    .maybeSingle();

  const incomeId = "f9b4ec48-3eb9-4d9d-be57-6fbf7a3f8d26";

  const [
    { data: income },
    { data: saleByIncome },
    { data: saleByCogs },
    { data: saleByReceipt },
  ] = await Promise.all([
    admin.from("income_register").select("*").eq("id", incomeId).maybeSingle(),
    admin.from("product_sales").select("*").eq("income_register_id", incomeId).maybeSingle(),
    cogsExp?.id
      ? admin.from("product_sales").select("*").eq("cogs_expense_id", cogsExp.id).maybeSingle()
      : { data: null },
    admin.from("product_sales").select("*").eq("tenant_id", DAVORS).ilike("receipt_no", "%0010%"),
  ]);

  console.log("COGS expense:", cogsExp);
  console.log("\nIncome register:", income);
  console.log("\nProduct sale by income_register_id:", saleByIncome);
  console.log("\nProduct sale by cogs_expense_id:", saleByCogs);
  console.log("\nProduct sales matching *0010*:", saleByReceipt);

  const productId =
    saleByIncome?.product_id ?? saleByCogs?.product_id ?? income?.product_id;
  if (productId) {
    const [{ data: product }, { data: inflows }, { data: batches }] = await Promise.all([
      admin.from("finished_products").select("*").eq("id", productId).maybeSingle(),
      admin
        .from("product_purchases")
        .select("*")
        .eq("tenant_id", DAVORS)
        .eq("product_id", productId),
      admin
        .from("production_batches")
        .select("*")
        .eq("tenant_id", DAVORS)
        .eq("finished_product_id", productId),
    ]);
    console.log("\nFinished product:", product);
    console.log("\nPurchases (product_purchases):", inflows);
    console.log("\nProduction batches:", batches);

    const { data: allProductSalesCogs } = await admin
      .from("income_register")
      .select("invoice_no, date, amount, cogs_expense_id, product_id")
      .eq("tenant_id", DAVORS)
      .eq("entry_type", "product_sale")
      .not("cogs_expense_id", "is", null);
    const withNonZeroCogs = [];
    for (const row of allProductSalesCogs ?? []) {
      if (!row.cogs_expense_id) continue;
      const { data: exp } = await admin
        .from("expense_register")
        .select("amount")
        .eq("id", row.cogs_expense_id)
        .maybeSingle();
      if ((Number(exp?.amount) || 0) > 0) {
        withNonZeroCogs.push({
          invoice_no: row.invoice_no,
          date: row.date,
          cogs: exp?.amount,
          product_id: row.product_id,
        });
      }
    }
    console.log("\nAll product sales with non-zero COGS:", withNonZeroCogs);
  }
}

main();
