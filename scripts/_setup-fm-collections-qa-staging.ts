/**
 * Staging QA setup: outstanding rent_ledger + landlord test password for collection confirm.
 * Usage: npx tsx scripts/_setup-fm-collections-qa-staging.ts
 */
import { resolve } from "node:path";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: resolve(process.cwd(), ".env.staging.local") });

const TENANT_ID = "a0792446-3bd1-4eaf-a0e8-84d089d032a0";
const FM_ID = "3b08b635-40f9-41cc-bbd5-02ef81ccb67b";
const LANDLORD_EMAIL = "david.avors@unifaitechnologies.com";
const LANDLORD_PASSWORD = "LandlordStagingTest!2026";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceKey) throw new Error("Missing staging creds");

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: landlord } = await admin
    .from("landlords")
    .select("auth_user_id")
    .eq("tenant_id", TENANT_ID)
    .maybeSingle();
  if (!landlord?.auth_user_id) throw new Error("Landlord auth_user_id missing");

  const { error: pwError } = await admin.auth.admin.updateUserById(
    landlord.auth_user_id as string,
    { password: LANDLORD_PASSWORD, email_confirm: true },
  );
  if (pwError) throw pwError;
  console.log("OK: landlord password set for", LANDLORD_EMAIL);

  const { data: assigns } = await admin
    .from("facility_manager_property_assignments")
    .select("property_id")
    .eq("facility_manager_id", FM_ID);
  const propIds = (assigns ?? []).map((a) => a.property_id as string);

  const { data: units } = await admin
    .from("property_units")
    .select("unit_id")
    .eq("tenant_id", TENANT_ID)
    .in("property_id", propIds);
  const unitIds = (units ?? []).map((u) => u.unit_id as string);

  const { data: lease } = await admin
    .from("leases")
    .select("lease_id")
    .eq("tenant_id", TENANT_ID)
    .eq("status", "active")
    .in("unit_id", unitIds)
    .limit(1)
    .maybeSingle();

  if (!lease) {
    console.log("WARN: no active lease on FM property — skip ledger seed");
    return;
  }

  const { data: existing } = await admin
    .from("rent_ledger")
    .select("entry_id, amount_due_ghs, amount_paid_ghs, status")
    .eq("tenant_id", TENANT_ID)
    .eq("lease_id", lease.lease_id)
    .neq("status", "paid")
    .limit(1)
    .maybeSingle();

  // Clear stale pending FM collections so QA can record a fresh one.
  const { data: pendingCols } = await admin
    .from("facility_manager_collections")
    .select("collection_id")
    .eq("tenant_id", TENANT_ID)
    .eq("status", "pending_landlord_confirmation");
  if (pendingCols?.length) {
    const ids = pendingCols.map((c) => c.collection_id as string);
    const { error: rejectError } = await admin
      .from("facility_manager_collections")
      .update({
        status: "rejected",
        rejection_reason: "QA setup reset",
        confirmed_at: new Date().toISOString(),
      })
      .in("collection_id", ids);
    if (rejectError) throw rejectError;
    console.log("OK: rejected stale pending collections", ids.length);
  }

  if (existing) {
    const { error: resetError } = await admin
      .from("rent_ledger")
      .update({
        amount_paid_ghs: 0,
        status: "pending",
        updated_at: new Date().toISOString(),
      })
      .eq("entry_id", existing.entry_id);
    if (resetError) throw resetError;
    console.log(
      "OK: outstanding ledger already exists (reset amount_paid for QA)",
      existing.entry_id,
    );
    return;
  }

  const entryId = crypto.randomUUID();
  const today = new Date().toISOString().slice(0, 10);
  const { error: insertError } = await admin.from("rent_ledger").insert({
    entry_id: entryId,
    tenant_id: TENANT_ID,
    lease_id: lease.lease_id,
    charge_type: "rent",
    description: null,
    period_start: today,
    period_end: today,
    amount_due_ghs: 500,
    amount_paid_ghs: 0,
    credit_ghs: 0,
    status: "pending",
    verification_status: "not_required",
    payment_method: null,
    payment_date: null,
    notes: "FM collections QA seed",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  });

  if (insertError) throw insertError;
  console.log("OK: seeded outstanding rent_ledger", entryId);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
