/**
 * Staging: product-sale PSI auto-invoice + void + supplied-invoice (CSV path) smoke.
 * Run: node scripts/test-product-sale-psi-staging.mjs
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const ENV_FILE = resolve(process.cwd(), ".env.staging.local");
const CAANTA_TENANT_ID = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";
const EXPECTED_PREFIX = "CAN-PSI-";

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
const tag = `PSI${Date.now().toString(36).toUpperCase()}`;

const { data: beforeRows, error: beforeError } = await supabase
  .from("income_register")
  .select("id, invoice_no, entry_type, sale_status, date, amount")
  .eq("tenant_id", CAANTA_TENANT_ID)
  .eq("entry_type", "product_sale")
  .order("invoice_no", { ascending: true });

if (beforeError) throw new Error(beforeError.message);
const beforeSnapshot = (beforeRows ?? []).map((row) => ({
  id: row.id,
  invoice_no: row.invoice_no,
  sale_status: row.sale_status,
  date: row.date,
  amount: row.amount,
}));
console.log("Prior product sales (Caanta):", beforeSnapshot.length);

const { data: product, error: productError } = await supabase
  .from("finished_products")
  .select("id, product_code, product_name, current_stock, tenant_id")
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
  .select("client_id, client_name")
  .eq("tenant_id", CAANTA_TENANT_ID)
  .order("client_name", { ascending: true })
  .limit(1)
  .maybeSingle();

if (customerError || !customer) {
  throw new Error(customerError?.message ?? "No customer for Caanta");
}

console.log("Using product:", product.product_code, "stock", product.current_stock);
console.log("Using client:", customer.client_id);

// 1) Single-sale path: blank invoice_no → DF-PSI-####
const { data: autoSaleId, error: autoError } = await supabase.rpc(
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
    p_notes: `${tag} auto-invoice single-sale test`,
  },
);

if (autoError || !autoSaleId) {
  throw new Error(autoError?.message ?? "Auto-invoice create_product_sale failed");
}

const { data: autoSale, error: autoFetchError } = await supabase
  .from("income_register")
  .select(
    "id, invoice_no, sale_status, cogs_expense_id, sale_quantity, amount, entry_type",
  )
  .eq("id", autoSaleId)
  .single();

if (autoFetchError || !autoSale) {
  throw new Error(autoFetchError?.message ?? "Failed to load auto sale");
}

assert(autoSale.entry_type === "product_sale", "expected product_sale");
assert(
  new RegExp(`^${EXPECTED_PREFIX}\\d{4}$`).test(autoSale.invoice_no),
  `Expected ${EXPECTED_PREFIX}####, got ${autoSale.invoice_no}`,
);
assert(autoSale.sale_status === "active", "auto sale should be active");
assert(autoSale.cogs_expense_id, "auto sale missing cogs_expense_id");
console.log("PASS auto-generated sale:", autoSale.invoice_no, autoSale.id);

// Confirm INV counter untouched for this create (PSI is separate)
const { data: counters } = await supabase
  .from("id_sequences")
  .select("entity_type, next_value, tenant_id")
  .eq("tenant_id", CAANTA_TENANT_ID)
  .in("entity_type", ["INV", "PSI"]);
console.log("Counters after auto create:", counters);

// 2) Void flow referencing the new invoice_no
const { error: voidError } = await supabase.rpc("void_product_sale", {
  p_income_id: autoSaleId,
});
if (voidError) throw new Error(`void_product_sale failed: ${voidError.message}`);

const { data: voided, error: voidFetchError } = await supabase
  .from("income_register")
  .select("id, invoice_no, sale_status, voided_at, cogs_reversal_expense_id")
  .eq("id", autoSaleId)
  .single();

if (voidFetchError || !voided) {
  throw new Error(voidFetchError?.message ?? "Failed to load voided sale");
}

assert(voided.sale_status === "voided", "sale should be voided");
assert(voided.invoice_no === autoSale.invoice_no, "void must keep invoice_no");
assert(voided.voided_at, "voided_at should be set");
assert(voided.cogs_reversal_expense_id, "cogs reversal should exist");

const { data: reversalExpense, error: reversalError } = await supabase
  .from("expense_register")
  .select("id, receipt_no")
  .eq("id", voided.cogs_reversal_expense_id)
  .maybeSingle();

if (reversalError) throw new Error(reversalError.message);
assert(
  reversalExpense?.receipt_no === `VOID-COGS-${autoSale.invoice_no}`,
  `Expected VOID-COGS-${autoSale.invoice_no}, got ${reversalExpense?.receipt_no}`,
);
console.log(
  "PASS void kept invoice_no and created",
  reversalExpense.receipt_no,
);

// 3) CSV-style path: explicit legacy invoice_no unchanged
const manualInvoice = `LEGACY-${tag}`;
const { data: manualSaleId, error: manualError } = await supabase.rpc(
  "create_product_sale",
  {
    p_date: today,
    p_invoice_no: manualInvoice,
    p_client_id: customer.client_id,
    p_customer_name: null,
    p_product_id: product.id,
    p_quantity: 0.25,
    p_unit_price: 12,
    p_amount_received: 3,
    p_payment_status: "Partial",
    p_due_date: today,
    p_description: null,
    p_notes: `${tag} csv-style supplied invoice_no`,
  },
);

if (manualError || !manualSaleId) {
  throw new Error(manualError?.message ?? "Manual invoice create failed");
}

const { data: manualSale, error: manualFetchError } = await supabase
  .from("income_register")
  .select("id, invoice_no, sale_status")
  .eq("id", manualSaleId)
  .single();

if (manualFetchError || !manualSale) {
  throw new Error(manualFetchError?.message ?? "Failed to load manual sale");
}

assert(
  manualSale.invoice_no === manualInvoice,
  `CSV path should keep supplied invoice_no, got ${manualSale.invoice_no}`,
);
console.log("PASS CSV-style supplied invoice_no:", manualSale.invoice_no);

// Void the manual sale too so stock is restored
const { error: voidManualError } = await supabase.rpc("void_product_sale", {
  p_income_id: manualSaleId,
});
if (voidManualError) {
  throw new Error(`void manual sale failed: ${voidManualError.message}`);
}
console.log("PASS voided CSV-style sale");

// Prior rows unchanged
const { data: afterRows, error: afterError } = await supabase
  .from("income_register")
  .select("id, invoice_no, sale_status, date, amount")
  .eq("tenant_id", CAANTA_TENANT_ID)
  .eq("entry_type", "product_sale");

if (afterError) throw new Error(afterError.message);

for (const prior of beforeSnapshot) {
  const match = (afterRows ?? []).find((row) => row.id === prior.id);
  assert(match, `Missing prior sale ${prior.id}`);
  assert(
    match.invoice_no === prior.invoice_no,
    `invoice_no changed for ${prior.id}`,
  );
  assert(
    match.sale_status === prior.sale_status,
    `sale_status changed for prior ${prior.id}`,
  );
  assert(match.date === prior.date, `date changed for prior ${prior.id}`);
  assert(
    Number(match.amount) === Number(prior.amount),
    `amount changed for prior ${prior.id}`,
  );
}

console.log("\nALL PASS");
console.log({
  autoInvoiceNo: autoSale.invoice_no,
  manualInvoiceNo: manualSale.invoice_no,
  priorUnchanged: beforeSnapshot.length,
});
