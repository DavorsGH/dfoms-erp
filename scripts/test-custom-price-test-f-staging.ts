/**
 * Verify custom_price_set_by accepts auth UUID (Test F, GH₵50, reason "Testing").
 *
 *   npx tsx scripts/test-custom-price-test-f-staging.ts
 */
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadEnvForce } from "./lib/env";

const TEST_F_TENANT_ID = "9e7393c7-ab3a-47af-87bd-51da92fd07d4";
const DAVID_EMAIL = "david.avors@gmail.com";

loadEnvForce(resolve(process.cwd(), ".env.local"));

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!url || !serviceKey) {
    throw new Error("Missing Supabase env vars");
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: actor, error: actorError } = await admin
    .from("user_accounts")
    .select("auth_uid, email")
    .ilike("email", DAVID_EMAIL)
    .maybeSingle();

  if (actorError || !actor?.auth_uid) {
    throw new Error(actorError?.message ?? "David user_accounts row not found");
  }

  const { data: subscription, error: subError } = await admin
    .from("crm_subscriptions")
    .select("id")
    .eq("linked_tenant_id", TEST_F_TENANT_ID)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (subError || !subscription) {
    throw new Error(subError?.message ?? "Test F subscription not found");
  }

  const { error: updateError } = await admin
    .from("crm_subscriptions")
    .update({
      custom_price_ghs: 50,
      custom_price_reason: "Testing",
      custom_price_set_by: actor.auth_uid,
      custom_price_set_at: new Date().toISOString(),
    })
    .eq("id", subscription.id);

  if (updateError) {
    throw new Error(`UPDATE failed: ${updateError.message}`);
  }

  const { data: saved, error: readError } = await admin
    .from("crm_subscriptions")
    .select(
      "custom_price_ghs, custom_price_reason, custom_price_set_by, custom_price_set_at",
    )
    .eq("id", subscription.id)
    .single();

  if (readError || !saved) {
    throw new Error(readError?.message ?? "Read-back failed");
  }

  console.log("PASS: Test F custom price saved");
  console.log(JSON.stringify(saved, null, 2));
  console.log(`custom_price_set_by is UUID auth_uid: ${actor.auth_uid}`);
}

main().catch((err) => {
  console.error("FAIL:", err instanceof Error ? err.message : err);
  process.exit(1);
});
