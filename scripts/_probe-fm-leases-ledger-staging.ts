import { resolve } from "node:path";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: resolve(process.cwd(), ".env.staging.local") });

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } },
);

async function main() {
  const fmId = "3b08b635-40f9-41cc-bbd5-02ef81ccb67b";
  const tenantId = "a0792446-3bd1-4eaf-a0e8-84d089d032a0";

const { data: assigns } = await admin
  .from("facility_manager_property_assignments")
  .select("property_id")
  .eq("facility_manager_id", fmId);
const propIds = (assigns ?? []).map((a) => a.property_id as string);

const { data: units } = await admin
  .from("property_units")
  .select("unit_id")
  .eq("tenant_id", tenantId)
  .in("property_id", propIds);
const unitIds = (units ?? []).map((u) => u.unit_id as string);

const { data: leases } = await admin
  .from("leases")
  .select("lease_id, status, unit_id")
  .eq("tenant_id", tenantId)
  .in("unit_id", unitIds);

console.log("properties", propIds.length);
console.log("units", unitIds.length);
console.log("leases", leases);

const leaseIds = (leases ?? []).map((l) => l.lease_id as string);
if (leaseIds.length) {
  const { data: ledger } = await admin
    .from("rent_ledger")
    .select(
      "entry_id, lease_id, status, amount_due_ghs, amount_paid_ghs, charge_type",
    )
    .eq("tenant_id", tenantId)
    .in("lease_id", leaseIds)
    .neq("status", "paid");
  console.log("outstanding ledger", ledger);
  }
}

main().catch(console.error);
