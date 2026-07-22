/**
 * Staging: simulate POS multi-line checkout with server-generated POS entity codes.
 * Run: node scripts/test-pos-checkout-staging.mjs
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const CAANTA_TENANT_ID = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";
const EXPECTED_PREFIX = "CAN-POS-";

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

loadEnvForce(resolve(process.cwd(), ".env.staging.local"));

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
assert(supabaseUrl && serviceRoleKey, "Missing staging Supabase env");
assert(supabaseUrl.includes("wieflwbfdmjtsdnwbfii"), "Refusing non-staging");

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const today = new Date().toISOString().slice(0, 10);
const tag = `POS${Date.now().toString(36).toUpperCase()}`;

const { data: beforeRows } = await supabase
  .from("income_register")
  .select("id, invoice_no, sale_status, date, amount")
  .eq("tenant_id", CAANTA_TENANT_ID)
  .eq("entry_type", "product_sale")
  .like("invoice_no", `${EXPECTED_PREFIX}%`);

const beforeSnapshot = (beforeRows ?? []).map((row) => ({ ...row }));

const { data: product, error: productError } = await supabase
  .from("finished_products")
  .select("id, product_code, product_name, current_stock, standard_selling_price")
  .eq("tenant_id", CAANTA_TENANT_ID)
  .gt("current_stock", 1)
  .limit(1)
  .maybeSingle();

if (productError || !product) {
  throw new Error(productError?.message ?? "No stocked product on Caanta");
}

const { data: customer } = await supabase
  .from("customers")
  .select("client_id, client_name")
  .eq("tenant_id", CAANTA_TENANT_ID)
  .limit(1)
  .maybeSingle();

assert(customer?.client_id, "No Caanta customer");

const cartLines = [
  { qty: 0.1, price: Number(product.standard_selling_price) || 10 },
  { qty: 0.15, price: Number(product.standard_selling_price) || 10 },
];

let allocatedInvoiceNo = null;
const incomeIds = [];

for (const [index, line] of cartLines.entries()) {
  const { data: incomeId, error } = await supabase.rpc("create_product_sale", {
    p_date: today,
    p_invoice_no: allocatedInvoiceNo,
    p_client_id: customer.client_id,
    p_customer_name: null,
    p_product_id: product.id,
    p_quantity: line.qty,
    p_unit_price: line.price,
    p_amount_received: index === 0 ? line.qty * line.price : 0,
    p_payment_status: "Paid",
    p_due_date: today,
    p_description: null,
    p_notes: `${tag} POS checkout line ${index + 1}`,
    p_invoice_entity_type: "POS",
  });

  if (error || !incomeId) {
    throw new Error(error?.message ?? `Line ${index + 1} failed`);
  }

  incomeIds.push(incomeId);

  if (!allocatedInvoiceNo) {
    const { data: row, error: fetchError } = await supabase
      .from("income_register")
      .select("invoice_no")
      .eq("id", incomeId)
      .single();

    if (fetchError || !row?.invoice_no) {
      throw new Error(fetchError?.message ?? "Missing invoice_no after first line");
    }

    allocatedInvoiceNo = row.invoice_no;
    assert(
      new RegExp(`^${EXPECTED_PREFIX}\\d{4}$`).test(allocatedInvoiceNo),
      `Expected ${EXPECTED_PREFIX}####, got ${allocatedInvoiceNo}`,
    );
    console.log("PASS allocated receipt number:", allocatedInvoiceNo);
  }
}

const { data: postedRows, error: postedError } = await supabase
  .from("income_register")
  .select("id, invoice_no, sale_quantity, amount")
  .in("id", incomeIds);

if (postedError) throw new Error(postedError.message);

assert(postedRows?.length === 2, "Expected two income rows");
for (const row of postedRows ?? []) {
  assert(
    row.invoice_no === allocatedInvoiceNo,
    `Line ${row.id} has ${row.invoice_no}, expected shared ${allocatedInvoiceNo}`,
  );
}

console.log("PASS both cart lines share receipt number:", allocatedInvoiceNo);
console.log(
  "Receipt display would show:",
  allocatedInvoiceNo,
  "total",
  (postedRows ?? []).reduce((sum, row) => sum + Number(row.amount), 0),
);

// PSI counter should not have been consumed by POS checkout
const { data: counters } = await supabase
  .from("id_sequences")
  .select("entity_type, next_value")
  .eq("tenant_id", CAANTA_TENANT_ID)
  .in("entity_type", ["POS", "PSI"]);
console.log("Counters:", counters);

// Prior POS-format rows unchanged
const { data: afterRows } = await supabase
  .from("income_register")
  .select("id, invoice_no, sale_status, date, amount")
  .eq("tenant_id", CAANTA_TENANT_ID)
  .eq("entry_type", "product_sale")
  .like("invoice_no", `${EXPECTED_PREFIX}%`);

for (const prior of beforeSnapshot) {
  const match = (afterRows ?? []).find((row) => row.id === prior.id);
  assert(match, `Missing prior row ${prior.id}`);
  assert(match.invoice_no === prior.invoice_no, `invoice_no changed for ${prior.id}`);
  assert(match.sale_status === prior.sale_status, `status changed for ${prior.id}`);
}

// Cleanup: void both test lines
for (const incomeId of incomeIds) {
  const { error: voidError } = await supabase.rpc("void_product_sale", {
    p_income_id: incomeId,
  });
  if (voidError) {
    console.warn("void cleanup warning:", incomeId, voidError.message);
  }
}

console.log("\nALL PASS", { receiptInvoiceNo: allocatedInvoiceNo, lines: incomeIds.length });
