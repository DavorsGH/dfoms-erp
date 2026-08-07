/**
 * Staging: product-sale COGS expense delete guard smoke test.
 * Run: node scripts/test-cogs-expense-delete-guard-staging.mjs
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const ENV_FILE = resolve(process.cwd(), ".env.staging.local");
const CAANTA_TENANT_ID = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";

function loadEnvForce(filePath) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    process.env[trimmed.slice(0, separator).trim()] = trimmed
      .slice(separator + 1)
      .trim();
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function isIncomeRegisterCogsExpenseFkError(error) {
  if (!error) return false;
  const message = (error.message ?? "").toLowerCase();
  return (
    message.includes("income_register_cogs_expense_id_fkey") ||
    message.includes("income_register_cogs_reversal_expense_id_fkey")
  );
}

async function lookupLinkedProductSaleCogsForExpense(supabase, expenseId) {
  const { data, error } = await supabase
    .from("income_register")
    .select("invoice_no, cogs_expense_id, cogs_reversal_expense_id")
    .or(
      `cogs_expense_id.eq.${expenseId},cogs_reversal_expense_id.eq.${expenseId}`,
    )
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);
  if (!data) return null;

  const invoiceNo = (data.invoice_no ?? "").trim();
  if (!invoiceNo) return null;

  if (data.cogs_expense_id === expenseId) {
    return { invoiceNo, linkType: "cogs" };
  }

  if (data.cogs_reversal_expense_id === expenseId) {
    return { invoiceNo, linkType: "cogs_reversal" };
  }

  return null;
}

loadEnvForce(ENV_FILE);

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
assert(supabaseUrl && serviceRoleKey, "Missing staging Supabase URL/key");
assert(
  supabaseUrl.includes("wieflwbfdmjtsdnwbfii"),
  `Refusing non-staging URL: ${supabaseUrl}`,
);

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const today = new Date().toISOString().slice(0, 10);
const tag = `COGSGUARD${Date.now().toString(36).toUpperCase()}`;

const { data: product, error: productError } = await supabase
  .from("finished_products")
  .select("id, product_code, current_stock")
  .eq("tenant_id", CAANTA_TENANT_ID)
  .gt("current_stock", 1)
  .order("product_name", { ascending: true })
  .limit(1)
  .maybeSingle();

if (productError || !product) {
  throw new Error(productError?.message ?? "No finished product with stock > 1");
}

const { data: customer, error: customerError } = await supabase
  .from("customers")
  .select("client_id")
  .eq("tenant_id", CAANTA_TENANT_ID)
  .order("client_name", { ascending: true })
  .limit(1)
  .maybeSingle();

if (customerError || !customer) {
  throw new Error(customerError?.message ?? "No customer for Caanta");
}

console.log("Creating product sale for COGS delete guard test…");

const { data: saleId, error: saleError } = await supabase.rpc(
  "create_product_sale",
  {
    p_date: today,
    p_invoice_no: null,
    p_client_id: customer.client_id,
    p_customer_name: null,
    p_product_id: product.id,
    p_quantity: 0.25,
    p_unit_price: 10,
    p_amount_received: 0,
    p_payment_status: "Pending",
    p_due_date: today,
    p_description: null,
    p_notes: `${tag} cogs delete guard staging test`,
    p_invoice_entity_type: "PSI",
    p_sales_rep_id: null,
  },
);

if (saleError || !saleId) {
  throw new Error(saleError?.message ?? "create_product_sale failed");
}

const { data: sale, error: saleFetchError } = await supabase
  .from("income_register")
  .select("id, invoice_no, cogs_expense_id, sale_status")
  .eq("id", saleId)
  .single();

if (saleFetchError || !sale) {
  throw new Error(saleFetchError?.message ?? "Failed to load sale");
}

assert(sale.cogs_expense_id, "expected cogs_expense_id on new sale");
console.log("Sale:", sale.invoice_no, "COGS expense:", sale.cogs_expense_id);

const linked = await lookupLinkedProductSaleCogsForExpense(
  supabase,
  sale.cogs_expense_id,
);
assert(linked?.linkType === "cogs", "lookup should find original COGS link");
assert(
  linked.invoiceNo === sale.invoice_no,
  "lookup invoice_no should match sale",
);
console.log("PASS proactive lookup for original COGS");

const { error: deleteCogsError } = await supabase
  .from("expense_register")
  .delete()
  .eq("id", sale.cogs_expense_id);

assert(deleteCogsError, "delete should fail for linked COGS expense");
assert(
  isIncomeRegisterCogsExpenseFkError(deleteCogsError),
  `expected FK guard error, got: ${deleteCogsError.message}`,
);
console.log("PASS FK error detected for original COGS delete attempt");

const { error: voidError } = await supabase.rpc("void_product_sale", {
  p_income_id: sale.id,
});
if (voidError) {
  throw new Error(`void_product_sale failed: ${voidError.message}`);
}

const { data: voidedSale, error: voidedFetchError } = await supabase
  .from("income_register")
  .select("invoice_no, sale_status, cogs_expense_id, cogs_reversal_expense_id")
  .eq("id", sale.id)
  .single();

if (voidedFetchError || !voidedSale) {
  throw new Error(voidedFetchError?.message ?? "Failed to load voided sale");
}

assert(voidedSale.sale_status === "voided", "sale should be voided");
assert(
  voidedSale.cogs_reversal_expense_id,
  "void should create cogs_reversal_expense_id",
);
console.log(
  "Voided sale; reversal expense:",
  voidedSale.cogs_reversal_expense_id,
);

const reversalLinked = await lookupLinkedProductSaleCogsForExpense(
  supabase,
  voidedSale.cogs_reversal_expense_id,
);
assert(
  reversalLinked?.linkType === "cogs_reversal",
  "lookup should find reversal COGS link",
);
console.log("PASS proactive lookup for reversal COGS");

const { error: deleteReversalError } = await supabase
  .from("expense_register")
  .delete()
  .eq("id", voidedSale.cogs_reversal_expense_id);

assert(deleteReversalError, "delete should fail for linked reversal COGS");
assert(
  isIncomeRegisterCogsExpenseFkError(deleteReversalError),
  `expected reversal FK guard error, got: ${deleteReversalError.message}`,
);
console.log("PASS FK error detected for reversal COGS delete attempt");

console.log("\nAll COGS expense delete guard staging checks passed.");
