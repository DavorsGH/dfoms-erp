/**
 * Staging-only: create one client invoice using generate_next_code('INV')
 * the same way createClientInvoice now does, then verify existing rows are untouched.
 *
 * Usage: node scripts/test-client-invoice-inv-staging.mjs
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const ENV_FILE = resolve(process.cwd(), ".env.staging.local");
const DAVORS_TENANT_ID = "00000001-0000-4000-8000-000000000001";
const API_SOURCE = resolve(process.cwd(), "utils/client-invoices-api.ts");

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
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error(
    "Staging environment is missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY",
  );
}

assert(
  supabaseUrl.includes("wieflwbfdmjtsdnwbfii"),
  `Refusing to run: URL is not staging (${supabaseUrl})`,
);

const source = readFileSync(API_SOURCE, "utf8");
assert(
  source.includes('p_entity_type: "INV"'),
  "client-invoices-api.ts does not call generate_next_code with entity INV",
);
assert(
  source.includes('rpc("generate_next_code"'),
  "client-invoices-api.ts does not call generate_next_code RPC",
);
assert(
  !source.includes("suggestInvoiceNumber("),
  "client-invoices-api.ts still uses legacy suggestInvoiceNumber on create",
);

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const before = await supabase
  .from("client_invoices")
  .select("id, invoice_number, invoice_sequence, created_at, updated_at")
  .eq("tenant_id", DAVORS_TENANT_ID)
  .order("invoice_sequence", { ascending: true });

if (before.error) throw new Error(before.error.message);

const beforeSnapshot = (before.data ?? []).map((row) => ({
  id: row.id,
  invoice_number: row.invoice_number,
  invoice_sequence: row.invoice_sequence,
  updated_at: row.updated_at,
}));

console.log("Before (Davors):", beforeSnapshot);

const { data: customer, error: customerError } = await supabase
  .from("customers")
  .select("client_id, client_name")
  .eq("tenant_id", DAVORS_TENANT_ID)
  .order("client_name", { ascending: true })
  .limit(1)
  .maybeSingle();

if (customerError || !customer) {
  throw new Error(customerError?.message ?? "No customer found for Davors tenant");
}

// Mirror createClientInvoice: allocate number first, then max(invoice_sequence)+1.
const { data: invoiceNumber, error: codeError } = await supabase.rpc(
  "generate_next_code",
  {
    p_tenant_id: DAVORS_TENANT_ID,
    p_entity_type: "INV",
    p_padding: 4,
  },
);

if (codeError || !invoiceNumber) {
  throw new Error(codeError?.message ?? "generate_next_code returned empty");
}

const { data: maxSeqRow, error: seqError } = await supabase
  .from("client_invoices")
  .select("invoice_sequence")
  .eq("tenant_id", DAVORS_TENANT_ID)
  .order("invoice_sequence", { ascending: false })
  .limit(1)
  .maybeSingle();

if (seqError) throw new Error(seqError.message);

const invoiceSequence = (maxSeqRow?.invoice_sequence ?? 0) + 1;
const today = new Date().toISOString().slice(0, 10);

const header = {
  tenant_id: DAVORS_TENANT_ID,
  client_id: customer.client_id,
  invoice_number: invoiceNumber,
  invoice_sequence: invoiceSequence,
  invoice_date: today,
  due_date: today,
  bill_to_name: customer.client_name,
  subtotal: 100,
  vat_nhil_getfund_rate: 20,
  tax_due: 20,
  wht_rate: 7.5,
  wht_amount: 7.5,
  total_amount_due: 112.5,
  status: "draft",
  amount_received: 0,
  notes: "STAGING TEST — generate_next_code INV wiring",
  updated_at: new Date().toISOString(),
};

const { data: created, error: insertError } = await supabase
  .from("client_invoices")
  .insert(header)
  .select("id, invoice_number, invoice_sequence, created_at")
  .single();

if (insertError || !created) {
  throw new Error(insertError?.message ?? "Insert failed");
}

const { error: lineError } = await supabase.from("client_invoice_line_items").insert({
  invoice_id: created.id,
  tenant_id: DAVORS_TENANT_ID,
  description: "Staging INV code smoke line",
  labour_amount: 100,
  material_amount: 0,
  discount_amount: 0,
  taxed: true,
  total_cost: 100,
  sort_order: 0,
});

if (lineError) {
  await supabase.from("client_invoices").delete().eq("id", created.id);
  throw new Error(lineError.message);
}

const after = await supabase
  .from("client_invoices")
  .select("id, invoice_number, invoice_sequence, updated_at")
  .eq("tenant_id", DAVORS_TENANT_ID)
  .order("invoice_sequence", { ascending: true });

if (after.error) throw new Error(after.error.message);

for (const prior of beforeSnapshot) {
  const match = (after.data ?? []).find((row) => row.id === prior.id);
  assert(match, `Missing prior invoice ${prior.id}`);
  assert(
    match.invoice_number === prior.invoice_number,
    `invoice_number changed for ${prior.id}: ${prior.invoice_number} -> ${match.invoice_number}`,
  );
  assert(
    match.invoice_sequence === prior.invoice_sequence,
    `invoice_sequence changed for ${prior.id}`,
  );
  assert(
    match.updated_at === prior.updated_at,
    `updated_at changed for prior invoice ${prior.id}`,
  );
}

assert(
  /^DF-INV-\d{4}$/.test(created.invoice_number),
  `Expected DF-INV-####, got ${created.invoice_number}`,
);
assert(
  created.invoice_sequence === invoiceSequence,
  `Expected invoice_sequence ${invoiceSequence}, got ${created.invoice_sequence}`,
);

console.log("\nPASS created invoice:", created);
console.log("Prior invoices unchanged:", beforeSnapshot.length);
console.log("All Davors invoices now:", after.data);
