/**
 * Staging: manual expense receipt_no auto-gen (EXP) + vendor override + COGS untouched.
 * Run: node scripts/test-expense-receipt-exp-staging.mjs
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const DAVORS_TENANT_ID = "00000001-0000-4000-8000-000000000001";
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

loadEnvForce(resolve(process.cwd(), ".env.staging.local"));

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
assert(supabaseUrl && serviceRoleKey, "Missing staging env");
assert(supabaseUrl.includes("wieflwbfdmjtsdnwbfii"), "Refusing non-staging");

const source = readFileSync(
  resolve(process.cwd(), "app/dashboard/finance/expense-register.tsx"),
  "utf8",
);
assert(
  source.includes("resolveManualExpenseReceiptNo"),
  "expense-register.tsx does not call resolveManualExpenseReceiptNo",
);

const apiSource = readFileSync(
  resolve(process.cwd(), "app/dashboard/finance/expense-register-api.ts"),
  "utf8",
);
assert(apiSource.includes('EXPENSE_RECEIPT_ENTITY_TYPE'), "missing EXP constant usage");
assert(apiSource.includes('p_entity_type: EXPENSE_RECEIPT_ENTITY_TYPE'), "missing EXP RPC");

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const today = new Date().toISOString().slice(0, 10);
const tag = `EXP${Date.now().toString(36).toUpperCase()}`;

const { data: beforeRows, error: beforeError } = await supabase
  .from("expense_register")
  .select("id, receipt_no, amount, vendor")
  .eq("tenant_id", DAVORS_TENANT_ID)
  .order("receipt_no", { ascending: true })
  .limit(50);

if (beforeError) throw new Error(beforeError.message);
const beforeSnapshot = (beforeRows ?? []).map((row) => ({ ...row }));
console.log("Sampled prior Davors expenses:", beforeSnapshot.length);

// 1) Blank receipt → auto EXP
const { data: autoCode, error: codeError } = await supabase.rpc(
  "generate_next_code",
  {
    p_tenant_id: DAVORS_TENANT_ID,
    p_entity_type: "EXP",
    p_padding: 4,
  },
);
if (codeError || !autoCode) {
  throw new Error(codeError?.message ?? "generate_next_code EXP failed");
}
assert(/^DF-EXP-\d{4}$/.test(autoCode), `Expected DF-EXP-####, got ${autoCode}`);

const autoPayload = {
  tenant_id: DAVORS_TENANT_ID,
  date: today,
  expense_category: "Direct Operational",
  sub_category: "Cleaning Supplies",
  description: `${tag} auto receipt test`,
  vendor: "Staging Auto Vendor",
  price: 25,
  quantity: 1,
  amount: 25,
  payment_method: "Cash",
  approved_by: "System",
  receipt_no: autoCode,
  payment_status: "Paid",
  notes: `${tag} blank→auto`,
};

const { data: autoRow, error: autoInsertError } = await supabase
  .from("expense_register")
  .insert(autoPayload)
  .select("id, receipt_no")
  .single();

if (autoInsertError || !autoRow) {
  throw new Error(autoInsertError?.message ?? "auto insert failed");
}
assert(autoRow.receipt_no === autoCode, "stored receipt_no mismatch");
console.log("PASS auto-generated manual expense:", autoRow.receipt_no);

// 2) Vendor override — must NOT consume another EXP if we only insert with supplied #
const vendorReceipt = `VENDOR-${tag}`;
const overridePayload = {
  ...autoPayload,
  vendor: "Staging Paper Receipt Vendor",
  description: `${tag} vendor override test`,
  receipt_no: vendorReceipt,
  notes: `${tag} explicit vendor receipt`,
  amount: 15,
  price: 15,
};

const { data: overrideRow, error: overrideError } = await supabase
  .from("expense_register")
  .insert(overridePayload)
  .select("id, receipt_no")
  .single();

if (overrideError || !overrideRow) {
  throw new Error(overrideError?.message ?? "override insert failed");
}
assert(
  overrideRow.receipt_no === vendorReceipt,
  `Expected vendor receipt kept, got ${overrideRow.receipt_no}`,
);
console.log("PASS vendor override kept:", overrideRow.receipt_no);

const { data: countersAfterOverride } = await supabase
  .from("id_sequences")
  .select("entity_type, next_value")
  .eq("tenant_id", DAVORS_TENANT_ID)
  .eq("entity_type", "EXP")
  .maybeSingle();

assert(
  countersAfterOverride?.next_value === 1,
  `EXP counter should still be 1 after one allocate + override (got ${countersAfterOverride?.next_value})`,
);
console.log("PASS EXP counter unchanged by vendor override:", countersAfterOverride);

// 3) COGS path still prefixes from invoice_no (create_product_sale) — use Caanta stock
const { data: product } = await supabase
  .from("finished_products")
  .select("id, current_stock")
  .eq("tenant_id", CAANTA_TENANT_ID)
  .gt("current_stock", 0.5)
  .limit(1)
  .maybeSingle();

assert(product?.id, "Need Caanta product with stock for COGS check");

const { data: customer } = await supabase
  .from("customers")
  .select("client_id")
  .eq("tenant_id", CAANTA_TENANT_ID)
  .limit(1)
  .maybeSingle();

assert(customer?.client_id, "Need Caanta customer");

const { data: saleId, error: saleError } = await supabase.rpc("create_product_sale", {
  p_date: today,
  p_invoice_no: null,
  p_client_id: customer.client_id,
  p_customer_name: null,
  p_product_id: product.id,
  p_quantity: 0.1,
  p_unit_price: 10,
  p_amount_received: 0,
  p_payment_status: "Pending",
  p_due_date: today,
  p_description: null,
  p_notes: `${tag} COGS format check`,
  p_invoice_entity_type: "PSI",
});

if (saleError || !saleId) {
  throw new Error(saleError?.message ?? "create_product_sale failed");
}

const { data: saleRow } = await supabase
  .from("income_register")
  .select("id, invoice_no, cogs_expense_id")
  .eq("id", saleId)
  .single();

assert(saleRow?.cogs_expense_id, "missing cogs_expense_id");
assert(/^CAN-PSI-\d{4}$/.test(saleRow.invoice_no), `unexpected invoice ${saleRow.invoice_no}`);

const { data: cogsRow } = await supabase
  .from("expense_register")
  .select("id, receipt_no")
  .eq("id", saleRow.cogs_expense_id)
  .single();

assert(
  cogsRow?.receipt_no === `COGS-${saleRow.invoice_no}`,
  `Expected COGS-${saleRow.invoice_no}, got ${cogsRow?.receipt_no}`,
);
console.log("PASS COGS format untouched:", cogsRow.receipt_no);

const { error: voidError } = await supabase.rpc("void_product_sale", {
  p_income_id: saleId,
});
if (voidError) throw new Error(`void cleanup failed: ${voidError.message}`);

const { data: voidedSale } = await supabase
  .from("income_register")
  .select("cogs_reversal_expense_id")
  .eq("id", saleId)
  .single();

const { data: voidCogs } = await supabase
  .from("expense_register")
  .select("receipt_no")
  .eq("id", voidedSale.cogs_reversal_expense_id)
  .maybeSingle();

assert(
  voidCogs?.receipt_no === `VOID-COGS-${saleRow.invoice_no}`,
  `Expected VOID-COGS-${saleRow.invoice_no}, got ${voidCogs?.receipt_no}`,
);
console.log("PASS VOID-COGS format untouched:", voidCogs.receipt_no);

// Prior sampled rows unchanged
const { data: afterRows } = await supabase
  .from("expense_register")
  .select("id, receipt_no, amount, vendor")
  .in(
    "id",
    beforeSnapshot.map((row) => row.id),
  );

for (const prior of beforeSnapshot) {
  const match = (afterRows ?? []).find((row) => row.id === prior.id);
  assert(match, `Missing prior expense ${prior.id}`);
  assert(match.receipt_no === prior.receipt_no, `receipt_no changed for ${prior.id}`);
  assert(Number(match.amount) === Number(prior.amount), `amount changed for ${prior.id}`);
}

// Cleanup test expense rows
await supabase.from("expense_register").delete().in("id", [autoRow.id, overrideRow.id]);

console.log("\nALL PASS", {
  autoReceipt: autoCode,
  vendorReceipt,
  cogsReceipt: cogsRow.receipt_no,
  voidCogsReceipt: voidCogs.receipt_no,
});
