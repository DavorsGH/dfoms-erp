import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const envFile = process.argv[2] ?? ".env.staging.local";
const tenantQuery = process.argv[3] ?? "caanta";

function loadEnvForce(filePath) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    process.env[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim();
  }
}

loadEnvForce(resolve(process.cwd(), envFile));

const round2 = (v) => Math.round(v * 100) / 100;
const round4 = (v) => Math.round(v * 10000) / 10000;

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

console.log(`Env file: ${envFile}`);
console.log(
  `Project ref: ${new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname.split(".")[0]}\n`,
);

// --- Resolve tenant ---
const { data: tenants, error: tenantError } = await supabase
  .from("tenants")
  .select("id, name, status")
  .ilike("name", `%${tenantQuery}%`);

if (tenantError) throw tenantError;
if (!tenants || tenants.length === 0) {
  throw new Error(`No tenant matched "${tenantQuery}"`);
}
if (tenants.length > 1) {
  console.log("Multiple tenants matched:");
  console.table(tenants);
}

const tenant = tenants[0];
console.log(`Tenant: ${tenant.name} (${tenant.id}) status=${tenant.status}\n`);
const tid = tenant.id;

// --- 1. Accounts payable outstanding ---
const { data: payables, error: payError } = await supabase
  .from("accounts_payable")
  .select("invoice_date, amount, amount_paid, balance_due, status, vendor_name, description")
  .eq("tenant_id", tid);
if (payError) throw payError;

let apTotal = 0;
const apRows = (payables ?? []).map((p) => {
  const bal =
    p.balance_due !== null && p.balance_due !== undefined
      ? Math.max(Number(p.balance_due) || 0, 0)
      : Math.max((Number(p.amount) || 0) - (Number(p.amount_paid) || 0), 0);
  apTotal += bal;
  return {
    invoice_date: p.invoice_date,
    vendor: p.vendor_name,
    amount: Number(p.amount) || 0,
    paid: Number(p.amount_paid) || 0,
    outstanding: round2(bal),
    status: p.status,
    description: p.description,
  };
});
apTotal = round2(apTotal);

console.log("=== 1. Accounts Payable (outstanding) ===");
console.table(apRows);
console.log(`TOTAL OUTSTANDING AP: GHS ${apTotal.toFixed(2)}\n`);

// --- 2. Inventory valuation (mirror calculateTotalInventoryValue) ---
const { data: finished, error: fpError } = await supabase
  .from("finished_products")
  .select("id, product_code, product_name, current_stock, sourcing_type")
  .eq("tenant_id", tid);
if (fpError) throw fpError;

const { data: batches, error: batchError } = await supabase
  .from("production_batches")
  .select("finished_product_id, total_batch_cost, quantity_produced")
  .eq("tenant_id", tid);
if (batchError) throw batchError;

const { data: rawMaterials, error: rmError } = await supabase
  .from("raw_materials")
  .select("id, material_code, material_name, current_stock, average_cost_per_unit")
  .eq("tenant_id", tid);
if (rmError) throw rmError;

// finished average cost = SUM(total_batch_cost) / SUM(quantity_produced) per product
const batchAgg = new Map();
for (const b of batches ?? []) {
  const cur = batchAgg.get(b.finished_product_id) ?? { cost: 0, qty: 0 };
  cur.cost += Number(b.total_batch_cost) || 0;
  cur.qty += Number(b.quantity_produced) || 0;
  batchAgg.set(b.finished_product_id, cur);
}
const finishedAvg = new Map();
for (const [pid, v] of batchAgg.entries()) {
  finishedAvg.set(pid, v.qty > 0 ? round4(v.cost / v.qty) : 0);
}

let finishedTotal = 0;
const fpRows = (finished ?? []).map((p) => {
  const stock = Number(p.current_stock) || 0;
  const avg = finishedAvg.get(p.id) ?? 0;
  const value = stock * avg;
  finishedTotal += value;
  return {
    product: `${p.product_code} — ${p.product_name}`,
    sourcing: p.sourcing_type,
    current_stock: stock,
    batch_avg_cost: avg,
    has_batches: batchAgg.has(p.id),
    inv_value: round2(value),
  };
});

let rawTotal = 0;
const rmRows = (rawMaterials ?? []).map((m) => {
  const stock = Number(m.current_stock) || 0;
  const cost = Number(m.average_cost_per_unit) || 0;
  const value = stock * cost;
  rawTotal += value;
  return {
    material: `${m.material_code} — ${m.material_name}`,
    current_stock: stock,
    avg_cost: cost,
    inv_value: round2(value),
  };
});

const inventoryValue = round2(rawTotal + finishedTotal);

console.log("=== 2a. Finished products valuation (stock x batch-only avg cost) ===");
console.table(fpRows);
console.log(`Finished products inventory value: GHS ${round2(finishedTotal).toFixed(2)}`);

console.log("\n=== 2b. Raw materials valuation (stock x average_cost_per_unit) ===");
console.table(rmRows);
console.log(`Raw materials inventory value: GHS ${round2(rawTotal).toFixed(2)}`);

console.log(
  `\nTOTAL calculateTotalInventoryValue: GHS ${inventoryValue.toFixed(2)}\n`,
);

// --- product_purchases (what SHOULD back purchased finished-product stock) ---
const { data: productPurchases, error: ppError } = await supabase
  .from("product_purchases")
  .select("product_id, quantity, cost_per_unit, total_cost, payment_method, purchase_date")
  .eq("tenant_id", tid);

if (!ppError) {
  let ppTotal = 0;
  const ppRows = (productPurchases ?? []).map((p) => {
    ppTotal += Number(p.total_cost) || 0;
    return {
      date: p.purchase_date,
      qty: Number(p.quantity) || 0,
      unit: Number(p.cost_per_unit) || 0,
      total: round2(Number(p.total_cost) || 0),
      payment: p.payment_method,
    };
  });
  console.log("=== 2c. product_purchases (finished product buys) ===");
  console.table(ppRows);
  console.log(`Total product_purchases cost: GHS ${round2(ppTotal).toFixed(2)}\n`);
} else {
  console.log(`(product_purchases query skipped: ${ppError.message})\n`);
}

// --- inventory_balance_config ---
const { data: cfg, error: cfgError } = await supabase
  .from("inventory_balance_config")
  .select("*")
  .eq("tenant_id", tid);
if (!cfgError) {
  console.log("=== inventory_balance_config ===");
  console.table(cfg ?? []);
} else {
  console.log(`(inventory_balance_config: ${cfgError.message})`);
}

// --- 3. Gap analysis ---
console.log("\n=== 3. Gap analysis ===");
console.log(`Outstanding AP (liability):        GHS ${apTotal.toFixed(2)}`);
console.log(`Inventory value (asset, current):  GHS ${inventoryValue.toFixed(2)}`);
console.log(
  `AP minus inventory value:          GHS ${round2(apTotal - inventoryValue).toFixed(2)}`,
);
console.log(`Dashboard reported imbalance:      GHS 1600.00`);
console.log(
  `\nMatches 1,600 gap? ${Math.abs(round2(apTotal - inventoryValue) - 1600) <= 0.01 ? "YES (exact)" : "not exact — see numbers above"}`,
);
