/**
 * Staging: SITE + CLIENT generate_next_code wiring (mirrors create forms).
 * Leaves tagged rows for inspection; does not mutate prior rows.
 *
 * Usage: node scripts/test-site-client-codes-staging.mjs
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const DAVORS = "00000001-0000-4000-8000-000000000001";

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
assert(supabaseUrl && serviceRoleKey, "Missing staging env");
assert(supabaseUrl.includes("wieflwbfdmjtsdnwbfii"), "Refusing non-staging");

const sitesSource = readFileSync(
  resolve("app/dashboard/operations/sites.tsx"),
  "utf8",
);
const customersSource = readFileSync(
  resolve("app/dashboard/crm/customers/customers.tsx"),
  "utf8",
);
const clientsSource = readFileSync(
  resolve("app/dashboard/operations/clients.tsx"),
  "utf8",
);
const signupSource = readFileSync(resolve("app/api/signup/route.ts"), "utf8");

assert(sitesSource.includes("allocateSiteCode"), "sites.tsx missing allocateSiteCode");
assert(
  !sitesSource.includes('generateNextOperationsId(\n        "SITE"') &&
    !sitesSource.includes('generateNextOperationsId("SITE"'),
  "sites.tsx still uses generateNextOperationsId SITE",
);
assert(customersSource.includes("allocateClientId"), "customers missing allocateClientId");
assert(clientsSource.includes("allocateClientId"), "clients missing allocateClientId");
assert(
  signupSource.includes("generateNextCustomerClientId"),
  "signup path unexpectedly dropped generateNextCustomerClientId",
);
assert(
  !signupSource.includes("allocateClientId"),
  "signup path should not use allocateClientId",
);

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const beforeSites = await supabase
  .from("sites")
  .select("site_code, site_name")
  .eq("tenant_id", DAVORS)
  .order("site_code");
if (beforeSites.error) throw new Error(beforeSites.error.message);

const beforeCustomers = await supabase
  .from("customers")
  .select("client_id, client_name, contract_number")
  .eq("tenant_id", DAVORS)
  .order("client_id");
if (beforeCustomers.error) throw new Error(beforeCustomers.error.message);

const siteSnapshot = (beforeSites.data ?? []).map((r) => ({ ...r }));
const customerSnapshot = (beforeCustomers.data ?? []).map((r) => ({ ...r }));
console.log("Before sites:", siteSnapshot.length);
console.log("Before customers:", customerSnapshot.length);

const { data: siteCode, error: siteCodeError } = await supabase.rpc(
  "generate_next_code",
  { p_tenant_id: DAVORS, p_entity_type: "SITE", p_padding: 4 },
);
if (siteCodeError || !siteCode) {
  throw new Error(siteCodeError?.message ?? "SITE allocate failed");
}
assert(/^DF-SITE-\d{4}$/.test(siteCode), `Expected DF-SITE-####, got ${siteCode}`);

const { data: clientId, error: clientIdError } = await supabase.rpc(
  "generate_next_code",
  { p_tenant_id: DAVORS, p_entity_type: "CLIENT", p_padding: 4 },
);
if (clientIdError || !clientId) {
  throw new Error(clientIdError?.message ?? "CLIENT allocate failed");
}
assert(
  /^DF-CLIENT-\d{4}$/.test(clientId),
  `Expected DF-CLIENT-####, got ${clientId}`,
);

const { data: contractNumber, error: contractError } = await supabase.rpc(
  "generate_next_code",
  { p_tenant_id: DAVORS, p_entity_type: "CONTRACT", p_padding: 4 },
);
if (contractError || !contractNumber) {
  throw new Error(contractError?.message ?? "CONTRACT allocate failed");
}

const tag = `STG-SC-${Date.now().toString(36).toUpperCase()}`;

const { data: insertedCustomer, error: customerInsertError } = await supabase
  .from("customers")
  .insert({
    tenant_id: DAVORS,
    client_id: clientId,
    client_name: `${tag} Client`,
    contract_number: contractNumber,
    contract_status: "Active",
    customer_type: "service_client",
    status: "active",
    notes: "STAGING TEST — SITE/CLIENT generate_next_code",
  })
  .select("client_id, client_name, contract_number")
  .single();
if (customerInsertError) throw new Error(customerInsertError.message);

const { data: insertedSite, error: siteInsertError } = await supabase
  .from("sites")
  .insert({
    tenant_id: DAVORS,
    site_code: siteCode,
    site_name: `${tag} Site`,
    client_id: insertedCustomer.client_id,
    notes: "STAGING TEST — SITE generate_next_code",
  })
  .select("site_code, site_name, client_id")
  .single();
if (siteInsertError) throw new Error(siteInsertError.message);

console.log("Inserted customer:", insertedCustomer);
console.log("Inserted site:", insertedSite);

const afterSites = await supabase
  .from("sites")
  .select("site_code, site_name")
  .eq("tenant_id", DAVORS)
  .order("site_code");
if (afterSites.error) throw new Error(afterSites.error.message);

const afterCustomers = await supabase
  .from("customers")
  .select("client_id, client_name, contract_number")
  .eq("tenant_id", DAVORS)
  .order("client_id");
if (afterCustomers.error) throw new Error(afterCustomers.error.message);

for (const prior of siteSnapshot) {
  const match = (afterSites.data ?? []).find((r) => r.site_code === prior.site_code);
  assert(match, `Missing prior site ${prior.site_code}`);
  assert(
    match.site_name === prior.site_name,
    `Prior site ${prior.site_code} changed`,
  );
}

for (const prior of customerSnapshot) {
  const match = (afterCustomers.data ?? []).find(
    (r) => r.client_id === prior.client_id,
  );
  assert(match, `Missing prior customer ${prior.client_id}`);
  assert(
    match.client_name === prior.client_name &&
      match.contract_number === prior.contract_number,
    `Prior customer ${prior.client_id} changed`,
  );
}

const seq = await supabase
  .from("id_sequences")
  .select("entity_type, next_value")
  .eq("tenant_id", DAVORS)
  .in("entity_type", ["SITE", "CLIENT"]);
if (seq.error) throw new Error(seq.error.message);

console.log("id_sequences:", seq.data);
console.log("SUCCESS:", {
  site_code: insertedSite.site_code,
  client_id: insertedCustomer.client_id,
  contract_number: insertedCustomer.contract_number,
  prior_sites_unchanged: siteSnapshot.length,
  prior_customers_unchanged: customerSnapshot.length,
});
