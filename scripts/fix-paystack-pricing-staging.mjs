/**
 * Fix null price_ghs, correct wrong Paystack plan amounts, harden sync.
 * Staging only. Usage: node scripts/fix-paystack-pricing-staging.mjs
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { resolveDatabaseUrl } from "./resolve-database-url.mjs";

const DAVORS = "00000001-0000-4000-8000-000000000001";
const PAYSTACK_BASE = "https://api.paystack.co";

const PUBLISHED_GHS = {
  "ERP Suite - Starter (Monthly)": 115,
  "ERP Suite - Starter (Yearly)": 1380,
  "ERP Suite - Professional (Monthly)": 170,
  "ERP Suite - Professional (Yearly)": 2040,
  "ERP Suite - Business (Monthly)": 230,
  "ERP Suite - Business (Yearly)": 2300,
  "ERP Suite - Enterprise (Monthly)": 345,
  "ERP Suite - Enterprise (Yearly)": 3450,
};

const WRONG_PLAN_CODES = [
  "PLN_6324kr7mpmaqb1w",
  "PLN_va2pyeviuf6bmcj",
  "PLN_t9cf7tekpph9ax6",
  "PLN_tu2h3ss5pead18q",
  "PLN_8x5zbyu1tv7m41a",
  "PLN_1430ulqerr6mdb1",
  "PLN_k93ns6gtx00gw3z",
  "PLN_g8jr6dmoa8wr9le",
];

function loadEnvForce(filePath) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    process.env[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim();
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

loadEnvForce(resolve(process.cwd(), ".env.staging.local"));
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const secretKey = (process.env.PAYSTACK_SECRET_KEY ?? "").trim();
assert(supabaseUrl?.includes("wieflwbfdmjtsdnwbfii"), "Refusing non-staging");
assert(secretKey.startsWith("sk_test_"), "Need sk_test_ key");

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

// --- 1. Snapshot before ---
const { data: before, error: beforeError } = await supabase
  .from("crm_products")
  .select("id, name, billing_cycle, unit_price, price_ghs, paystack_plan_code")
  .eq("tenant_id", DAVORS)
  .eq("category", "ERP Suite")
  .order("name");
if (beforeError) throw new Error(beforeError.message);
console.log("=== BEFORE ===");
console.table(before);

const nullCount = (before ?? []).filter((r) => r.price_ghs == null).length;
console.log(`Rows with null price_ghs: ${nullCount}/${before?.length ?? 0}`);

// --- Root-cause checks via SQL history / schema ---
const { default: pg } = await import("pg");
const client = new pg.Client({
  connectionString: resolveDatabaseUrl(),
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const col = await client.query(`
  SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_name='crm_products' AND column_name IN ('price_ghs','paystack_plan_code','unit_price')
  ORDER BY 1
`);
console.log("\n=== columns ===");
console.table(col.rows);

const script107 = readFileSync(
  resolve(process.cwd(), "../../06 Database/107_paystack_plan_and_billing_waiver.sql"),
  "utf8",
);
assert(
  !/price_ghs/i.test(script107) || !/UPDATE\s+crm_products/i.test(script107),
  "unexpected",
);
console.log(
  "\nScript 107 touches price_ghs?",
  /price_ghs/i.test(script107) ? "YES" : "NO (only ADD paystack_plan_code)",
);

await client.end();

// --- 2. Correct price_ghs ---
for (const [name, ghs] of Object.entries(PUBLISHED_GHS)) {
  const { data, error } = await supabase
    .from("crm_products")
    .update({ price_ghs: ghs })
    .eq("tenant_id", DAVORS)
    .eq("category", "ERP Suite")
    .eq("name", name)
    .select("id, name, price_ghs");
  if (error) throw new Error(`${name}: ${error.message}`);
  assert((data?.length ?? 0) === 1, `Expected 1 row for ${name}, got ${data?.length}`);
  console.log(`Set ${name} → price_ghs=${ghs}`);
}

const { data: afterFix, error: afterFixError } = await supabase
  .from("crm_products")
  .select("id, name, billing_cycle, unit_price, price_ghs, paystack_plan_code")
  .eq("tenant_id", DAVORS)
  .eq("category", "ERP Suite")
  .order("name");
if (afterFixError) throw new Error(afterFixError.message);
console.log("\n=== AFTER price_ghs FIX ===");
console.table(afterFix);
assert(
  (afterFix ?? []).every((r) => Number(r.price_ghs) === PUBLISHED_GHS[r.name]),
  "price_ghs mismatch after fix",
);

// --- 4. Paystack: no DELETE endpoint — update amounts in place ---
console.log("\n=== Paystack plan handling ===");
console.log(
  "Paystack Plan API has PUT /plan/:code (update) but NO DELETE. Updating amounts in place.",
);

const updatedPlans = [];
for (const row of afterFix) {
  const code = row.paystack_plan_code;
  assert(code, `Missing plan_code on ${row.name}`);
  assert(
    WRONG_PLAN_CODES.includes(code),
    `Unexpected plan_code ${code} on ${row.name} (not in wrong-list)`,
  );

  const amountPesewas = Math.round(Number(row.price_ghs) * 100);
  const res = await fetch(`${PAYSTACK_BASE}/plan/${code}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      amount: amountPesewas,
      currency: "GHS",
      update_existing_subscriptions: false,
    }),
  });
  const payload = await res.json().catch(() => null);
  if (!res.ok || payload?.status === false) {
    throw new Error(
      `Update ${code} failed: ${payload?.message ?? res.statusText}`,
    );
  }

  // Fetch to confirm amount
  const fetchRes = await fetch(`${PAYSTACK_BASE}/plan/${code}`, {
    headers: { Authorization: `Bearer ${secretKey}` },
  });
  const fetchPayload = await fetchRes.json();
  const confirmedAmount = fetchPayload?.data?.amount;
  assert(
    confirmedAmount === amountPesewas,
    `${code}: expected amount ${amountPesewas}, got ${confirmedAmount}`,
  );

  updatedPlans.push({
    name: row.name,
    plan_code: code,
    price_ghs: Number(row.price_ghs),
    amount_pesewas: confirmedAmount,
    paystack_name: fetchPayload?.data?.name,
  });
  console.log(
    `Updated ${code}: ${row.name} → ${row.price_ghs} GHS (${amountPesewas}p)`,
  );
}

console.log("\n=== UPDATED PLANS (correct amounts) ===");
console.table(updatedPlans);

// Verify list still has these 8 (not deleted — can't delete)
console.log(
  "\nKept existing plan_codes (updated in place). No orphan recreate needed.",
);
console.log("DONE");
