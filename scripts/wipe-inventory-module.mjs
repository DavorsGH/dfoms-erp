import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadEnvFile(filePath) {
  const contents = readFileSync(filePath, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

function shortId(id) {
  return id ? String(id).slice(0, 8) : "—";
}

async function main() {
  loadEnvFile(resolve(process.cwd(), ".env.local"));
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  const deletedFinance = [];

  console.log("=== PART 2: Reverse inventory-linked Finance postings ===\n");

  const { data: sales, error: salesError } = await supabase
    .from("income_register")
    .select(
      "id, invoice_no, sale_status, cogs_expense_id, cogs_reversal_expense_id",
    )
    .eq("entry_type", "product_sale");

  if (salesError) throw new Error(salesError.message);

  const activeSales = (sales ?? []).filter((row) => row.sale_status !== "voided");
  for (const sale of activeSales) {
    const { error } = await supabase.rpc("void_product_sale", {
      p_income_id: sale.id,
    });
    if (error) {
      throw new Error(`Failed to void ${sale.invoice_no}: ${error.message}`);
    }
    console.log(`Voided active sale ${sale.invoice_no} before finance cleanup`);
  }

  const cogsExpenseIds = new Set();
  for (const sale of sales ?? []) {
    if (sale.cogs_expense_id) cogsExpenseIds.add(sale.cogs_expense_id);
    if (sale.cogs_reversal_expense_id) {
      cogsExpenseIds.add(sale.cogs_reversal_expense_id);
    }
  }

  const { data: internalRows, error: icError } = await supabase
    .from("internal_consumption")
    .select("id, expense_register_id");

  if (icError) throw new Error(icError.message);

  const icExpenseIds = (internalRows ?? [])
    .map((row) => row.expense_register_id)
    .filter(Boolean);

  const { data: purchases, error: purchaseError } = await supabase
    .from("raw_material_purchases")
    .select("id, accounts_payable_id");

  if (purchaseError) throw new Error(purchaseError.message);

  const payableIds = (purchases ?? [])
    .map((row) => row.accounts_payable_id)
    .filter(Boolean);

  if (cogsExpenseIds.size > 0) {
    const { data: cogsRows, error } = await supabase
      .from("expense_register")
      .select("id, receipt_no, description, amount")
      .in("id", [...cogsExpenseIds]);

    if (error) throw new Error(error.message);
    for (const row of cogsRows ?? []) {
      deletedFinance.push({
        table: "expense_register",
        id: row.id,
        label: `${row.receipt_no} — ${row.description} — ${row.amount}`,
      });
    }
  }

  if (icExpenseIds.length > 0) {
    const { data: icExpenseRows, error } = await supabase
      .from("expense_register")
      .select("id, receipt_no, description, amount")
      .in("id", icExpenseIds);

    if (error) throw new Error(error.message);
    for (const row of icExpenseRows ?? []) {
      deletedFinance.push({
        table: "expense_register",
        id: row.id,
        label: `${row.receipt_no} — ${row.description} — ${row.amount}`,
      });
    }
  }

  const { data: extraInventoryExpenses, error: extraExpenseError } = await supabase
    .from("expense_register")
    .select("id, receipt_no, description, amount, sub_category")
    .or(
      "receipt_no.ilike.COGS-%,receipt_no.ilike.VOID-COGS-%,receipt_no.ilike.IC-%,sub_category.eq.Cleaning Supplies - Internal Use,sub_category.eq.Product Sales",
    );

  if (extraExpenseError) throw new Error(extraExpenseError.message);

  for (const row of extraInventoryExpenses ?? []) {
    if (!deletedFinance.some((item) => item.id === row.id)) {
      deletedFinance.push({
        table: "expense_register",
        id: row.id,
        label: `${row.receipt_no} — ${row.description} — ${row.amount}`,
      });
    }
  }

  if (payableIds.length > 0) {
    const { data: payableRows, error } = await supabase
      .from("accounts_payable")
      .select("id, invoice_number, description, amount")
      .in("id", payableIds);

    if (error) throw new Error(error.message);
    for (const row of payableRows ?? []) {
      deletedFinance.push({
        table: "accounts_payable",
        id: row.id,
        label: `${row.invoice_number} — ${row.description} — ${row.amount}`,
      });
    }
  }

  const { data: config, error: configError } = await supabase
    .from("inventory_balance_config")
    .select("*")
    .eq("id", 1)
    .maybeSingle();

  if (configError) throw new Error(configError.message);
  if (config) {
    deletedFinance.push({
      table: "inventory_balance_config",
      id: String(config.id),
      label: `go_live=${config.go_live_date}, opening_value=${config.opening_inventory_value}`,
    });
  }

  console.log("Finance rows slated for deletion:");
  for (const row of deletedFinance) {
    console.log(`  [${row.table}] ${shortId(row.id)} — ${row.label}`);
  }

  await supabase
    .from("income_register")
    .update({ cogs_expense_id: null, cogs_reversal_expense_id: null })
    .eq("entry_type", "product_sale");

  await supabase
    .from("internal_consumption")
    .update({ expense_register_id: null })
    .not("expense_register_id", "is", null);

  const expenseIdsToDelete = [
    ...new Set(deletedFinance.filter((r) => r.table === "expense_register").map((r) => r.id)),
  ];

  if (expenseIdsToDelete.length > 0) {
    const { error } = await supabase
      .from("expense_register")
      .delete()
      .in("id", expenseIdsToDelete);
    if (error) throw new Error(`Delete expenses failed: ${error.message}`);
  }

  if (payableIds.length > 0) {
    await supabase
      .from("raw_material_purchases")
      .update({ accounts_payable_id: null })
      .in("accounts_payable_id", payableIds);

    const { error } = await supabase
      .from("accounts_payable")
      .delete()
      .in("id", payableIds);
    if (error) throw new Error(`Delete payables failed: ${error.message}`);
  }

  if (config) {
    const { error } = await supabase.from("inventory_balance_config").delete().eq("id", 1);
    if (error) throw new Error(`Delete inventory config failed: ${error.message}`);
  }

  console.log(`\nDeleted ${deletedFinance.length} finance-side records/config rows.\n`);

  console.log("=== PART 3: Full Sales & Inventory wipe (FK-safe order) ===\n");

  const wipeSteps = [];

  async function wipeTable(table, label) {
    const { count, error: countError } = await supabase
      .from(table)
      .select("*", { count: "exact", head: true });
    if (countError) throw new Error(`${table} count failed: ${countError.message}`);

    const { error } = await supabase.from(table).delete().not("id", "is", null);
    if (error) throw new Error(`${table} delete failed: ${error.message}`);

    wipeSteps.push({ table, deleted: count ?? 0 });
    console.log(`Deleted ${count ?? 0} row(s) from ${table} (${label})`);
  }

  await wipeTable("stock_movements", "ledger");
  await wipeTable("internal_consumption", "internal use");
  await wipeTable("production_batch_materials", "batch lines");
  await wipeTable("production_batches", "batches");

  const productSaleCount = sales?.length ?? 0;
  const { error: deleteSalesError } = await supabase
    .from("income_register")
    .delete()
    .eq("entry_type", "product_sale");
  if (deleteSalesError) {
    throw new Error(`income_register product_sale delete failed: ${deleteSalesError.message}`);
  }
  wipeSteps.push({ table: "income_register (product_sale)", deleted: productSaleCount });
  console.log(`Deleted ${productSaleCount} row(s) from income_register (product_sale)`);

  await wipeTable("raw_material_purchases", "purchases");
  await wipeTable("finished_products", "finished products");
  await wipeTable("raw_materials", "raw materials");

  console.log("\n=== PART 4: Verify clean state ===\n");

  const tables = [
    "raw_materials",
    "raw_material_purchases",
    "finished_products",
    "production_batches",
    "production_batch_materials",
    "internal_consumption",
    "stock_movements",
  ];

  for (const table of tables) {
    const { count, error } = await supabase
      .from(table)
      .select("*", { count: "exact", head: true });
    if (error) throw new Error(error.message);
    console.log(`${table}: ${count ?? 0}`);
    if ((count ?? 0) !== 0) {
      throw new Error(`${table} is not empty after wipe`);
    }
  }

  const { count: remainingSales, error: remainingSalesError } = await supabase
    .from("income_register")
    .select("*", { count: "exact", head: true })
    .eq("entry_type", "product_sale");

  if (remainingSalesError) throw new Error(remainingSalesError.message);
  console.log(`income_register (product_sale): ${remainingSales ?? 0}`);
  if ((remainingSales ?? 0) !== 0) {
    throw new Error("Product sales remain after wipe");
  }

  const { data: remainingConfig } = await supabase
    .from("inventory_balance_config")
    .select("id")
    .maybeSingle();
  console.log(`inventory_balance_config: ${remainingConfig ? 1 : 0}`);
  if (remainingConfig) {
    throw new Error("inventory_balance_config still exists");
  }

  console.log("\nPASS: Sales & Inventory module is empty.");
  console.log("PASS: Inventory opening balance config removed.");
}

main().catch((error) => {
  console.error(`\nWIPE FAILED: ${error.message}`);
  process.exit(1);
});
