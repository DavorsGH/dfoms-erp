/**
 * Staging-only: create one customer with generate_next_code('CONTRACT'),
 * mirroring allocateContractNumber used by customers/clients create forms.
 * Leaves the new row in place for inspection (tagged STAGING TEST).
 *
 * Usage: node scripts/test-customer-contract-staging.mjs
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const ENV_FILE = resolve(process.cwd(), ".env.staging.local");
const DAVORS_TENANT_ID = "00000001-0000-4000-8000-000000000001";

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
assert(supabaseUrl && serviceRoleKey, "Missing staging env");
assert(
  supabaseUrl.includes("wieflwbfdmjtsdnwbfii"),
  `Refusing non-staging (${supabaseUrl})`,
);

const apiSource = readFileSync(
  resolve("app/dashboard/crm/customers/customer-contract-api.ts"),
  "utf8",
);
assert(
  apiSource.includes('CONTRACT_NUMBER_ENTITY_TYPE = "CONTRACT"'),
  "customer-contract-api missing CONTRACT entity type",
);
assert(
  apiSource.includes('rpc("generate_next_code"'),
  "customer-contract-api does not call generate_next_code",
);

for (const file of [
  "app/dashboard/crm/customers/customers.tsx",
  "app/dashboard/operations/clients.tsx",
]) {
  const source = readFileSync(resolve(file), "utf8");
  assert(
    source.includes("allocateContractNumber"),
    `${file} does not call allocateContractNumber`,
  );
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const before = await supabase
  .from("customers")
  .select("client_id, client_name, contract_number")
  .eq("tenant_id", DAVORS_TENANT_ID)
  .order("client_id");

if (before.error) throw new Error(before.error.message);

const beforeSnapshot = (before.data ?? []).map((row) => ({
  client_id: row.client_id,
  client_name: row.client_name,
  contract_number: row.contract_number,
}));

console.log("Before existing Davors customers:", beforeSnapshot.length);
console.log(
  "Existing contract_numbers:",
  beforeSnapshot.map((r) => ({
    client_id: r.client_id,
    contract_number: r.contract_number,
  })),
);

const { data: contractNumber, error: codeError } = await supabase.rpc(
  "generate_next_code",
  {
    p_tenant_id: DAVORS_TENANT_ID,
    p_entity_type: "CONTRACT",
    p_padding: 4,
  },
);

if (codeError || !contractNumber) {
  throw new Error(codeError?.message ?? "generate_next_code CONTRACT failed");
}

assert(
  /^DF-CONTRACT-\d{4}$/.test(contractNumber),
  `Expected DF-CONTRACT-####, got ${contractNumber}`,
);

const clientId = `CLI-STG-${Date.now().toString(36).toUpperCase()}`;
const clientName = `STAGING TEST Contract Auto ${clientId}`;

const { data: inserted, error: insertError } = await supabase
  .from("customers")
  .insert({
    tenant_id: DAVORS_TENANT_ID,
    client_id: clientId,
    client_name: clientName,
    contract_number: contractNumber,
    contract_status: "active",
    customer_type: "service_client",
    status: "active",
    notes: "STAGING TEST — generate_next_code CONTRACT wiring",
  })
  .select("client_id, client_name, contract_number, tenant_id")
  .single();

if (insertError) throw new Error(insertError.message);

console.log("Inserted:", inserted);

const after = await supabase
  .from("customers")
  .select("client_id, client_name, contract_number")
  .eq("tenant_id", DAVORS_TENANT_ID)
  .order("client_id");

if (after.error) throw new Error(after.error.message);

for (const prior of beforeSnapshot) {
  const match = (after.data ?? []).find((row) => row.client_id === prior.client_id);
  assert(match, `Missing prior customer ${prior.client_id}`);
  assert(
    match.contract_number === prior.contract_number,
    `Prior customer ${prior.client_id} contract_number changed: ${prior.contract_number} → ${match.contract_number}`,
  );
}

const seq = await supabase
  .from("id_sequences")
  .select("entity_type, next_value")
  .eq("tenant_id", DAVORS_TENANT_ID)
  .eq("entity_type", "CONTRACT")
  .maybeSingle();

if (seq.error) throw new Error(seq.error.message);

console.log("id_sequences CONTRACT:", seq.data);
console.log("SUCCESS:", {
  client_id: inserted.client_id,
  contract_number: inserted.contract_number,
  existing_rows_unchanged: beforeSnapshot.length,
});
