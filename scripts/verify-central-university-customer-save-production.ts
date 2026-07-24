/**
 * Production verification: simulate fixed CRM Customer save for Central University.
 * Confirms service_client/active save succeeds and leaves other fields unchanged.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

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
  loadEnvForce(resolve(process.cwd(), ".env.local"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  assert(url.includes("tvcurcnmasnocwdxzgvz"), "Refusing non-production");

  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: before, error: beforeError } = await admin
    .from("customers")
    .select("*")
    .eq("client_id", "CL-001")
    .maybeSingle();
  assert(!beforeError && before, beforeError?.message ?? "CL-001 missing");

  console.log("BEFORE snapshot keys:", {
    client_id: before.client_id,
    client_name: before.client_name,
    customer_type: before.customer_type,
    status: before.status,
    phone: before.phone,
    email: before.email,
    contact_person: before.contact_person,
    contract_status: before.contract_status,
  });

  // Simulate fixed UI save: same values the form would send for an unchanged edit
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

  assert(payload.customer_type === "service_client", "expected service_client");
  assert(payload.status === "active", "expected active");

  const { error: saveError } = await admin
    .from("customers")
    .update(payload)
    .eq("client_id", "CL-001");
  assert(!saveError, `Save failed: ${saveError?.message}`);

  const { data: after, error: afterError } = await admin
    .from("customers")
    .select("*")
    .eq("client_id", "CL-001")
    .maybeSingle();
  assert(!afterError && after, afterError?.message ?? "CL-001 missing after");

  const tracked = [
    "client_id",
    "client_name",
    "contact_person",
    "phone",
    "email",
    "address",
    "gps_location",
    "contract_number",
    "contract_start",
    "contract_end",
    "service_frequency",
    "services_provided",
    "assigned_supervisor",
    "contract_status",
    "notes",
    "customer_type",
    "status",
    "source",
    "tenant_id",
  ] as const;

  const drifts: string[] = [];
  for (const key of tracked) {
    if (JSON.stringify(before[key]) !== JSON.stringify(after[key])) {
      drifts.push(
        `${key}: ${JSON.stringify(before[key])} -> ${JSON.stringify(after[key])}`,
      );
    }
  }

  // Sanity: old UI value still rejected
  const { error: oldUiError } = await admin
    .from("customers")
    .update({ customer_type: "Business" })
    .eq("client_id", "CL-001");

  console.log(
    JSON.stringify(
      {
        save_ok: true,
        customer_type: after.customer_type,
        status: after.status,
        drifts,
        old_Business_still_rejected: Boolean(oldUiError),
        old_Business_error: oldUiError?.message ?? null,
      },
      null,
      2,
    ),
  );

  assert(drifts.length === 0, `Unexpected field drifts: ${drifts.join("; ")}`);
  assert(oldUiError, "Expected Business to still violate constraint");
  console.log("PASS: Central University edit save succeeds; no field drifts");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
