/**
 * Staging: verify CRM customer save with fixed type/status values.
 * Usage: npx tsx scripts/verify-customer-type-status-save-staging.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const DAVORS = "00000001-0000-4000-8000-000000000001";
const CAANTA = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";

function loadEnvForce(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  loadEnvForce(resolve(process.cwd(), ".env.staging.local"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  assert(url.includes("wieflwbfdmjtsdnwbfii"), "Refusing non-staging");

  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Prefer Davors, fall back to Caanta
  let tenantId = DAVORS;
  let { data: customers, error } = await admin
    .from("customers")
    .select("*")
    .eq("tenant_id", DAVORS)
    .order("client_id")
    .limit(5);
  assert(!error, error?.message ?? "Davors customers query failed");

  if (!customers?.length) {
    tenantId = CAANTA;
    const caanta = await admin
      .from("customers")
      .select("*")
      .eq("tenant_id", CAANTA)
      .order("client_id")
      .limit(5);
    assert(!caanta.error, caanta.error?.message ?? "Caanta customers query failed");
    customers = caanta.data ?? [];
  }

  assert(customers.length > 0, "No customers on staging for Davors or Caanta");
  const before = customers[0];

  const payload = {
    client_name: before.client_name,
    contact_person: before.contact_person,
    phone: before.phone,
    email: before.email,
    address: before.address,
    gps_location: before.gps_location,
    contract_number: before.contract_number,
    contract_start: before.contract_start,
    contract_end: before.contract_end,
    service_frequency: before.service_frequency,
    services_provided: before.services_provided,
    assigned_supervisor: before.assigned_supervisor,
    contract_status: before.contract_status,
    notes: before.notes,
    customer_type: before.customer_type ?? "service_client",
    status: before.status ?? "active",
  };

  // Ensure values are constraint-legal (same as fixed UI)
  assert(
    ["service_client", "digital_subscriber", "both"].includes(
      payload.customer_type,
    ),
    `unexpected customer_type ${payload.customer_type}`,
  );
  assert(
    ["lead", "active", "inactive"].includes(payload.status),
    `unexpected status ${payload.status}`,
  );

  const { error: saveError } = await admin
    .from("customers")
    .update(payload)
    .eq("client_id", before.client_id)
    .eq("tenant_id", tenantId);
  assert(!saveError, `Save failed: ${saveError?.message}`);

  const { data: after, error: afterError } = await admin
    .from("customers")
    .select("*")
    .eq("client_id", before.client_id)
    .eq("tenant_id", tenantId)
    .maybeSingle();
  assert(!afterError && after, afterError?.message ?? "missing after save");

  const tracked = [
    "client_id",
    "client_name",
    "contact_person",
    "phone",
    "email",
    "customer_type",
    "status",
    "contract_status",
    "tenant_id",
  ] as const;
  const drifts: string[] = [];
  for (const key of tracked) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      drifts.push(`${key}: ${before[key]} -> ${after[key]}`);
    }
  }

  const { error: badTypeError } = await admin
    .from("customers")
    .update({ customer_type: "Business" })
    .eq("client_id", before.client_id)
    .eq("tenant_id", tenantId);

  console.log(
    JSON.stringify(
      {
        tenant_id: tenantId,
        client_id: before.client_id,
        client_name: before.client_name,
        saved_customer_type: after.customer_type,
        saved_status: after.status,
        save_ok: true,
        drifts,
        Business_still_rejected: Boolean(badTypeError),
      },
      null,
      2,
    ),
  );

  assert(drifts.length === 0, `Unexpected drifts: ${drifts.join("; ")}`);
  assert(badTypeError, "Expected Business to still fail constraint");
  console.log("PASS: staging customer save with fixed type/status values");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
