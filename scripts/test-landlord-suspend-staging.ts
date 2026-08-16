/**
 * Staging regression: suspend approved landlord + block login + reactivate via approve.
 *
 *   npx tsx scripts/test-landlord-suspend-staging.ts --env-file .env.staging.local
 */
import { createClient } from "@supabase/supabase-js";
import { assert, loadEnvFromArgv } from "./lib/env";
import {
  approveLandlordForTest,
  isAuthUserBanned,
  reactivateLandlordAuthForTest,
  resolveAvailableSlug,
  suspendLandlordAuthForTest,
} from "./lib/landlord-test-helpers";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const TEST_PASSWORD = "LandlordSuspend-Test-7Kx9!";

type Cleanup = {
  tenantId: string | null;
  authUserId: string | null;
};

async function cleanup(
  admin: ReturnType<typeof createClient>,
  state: Cleanup,
) {
  if (state.authUserId) {
    await admin.auth.admin.deleteUser(state.authUserId).catch(() => undefined);
  }
  if (state.tenantId) {
    await admin
      .from("landlord_subscriptions")
      .delete()
      .eq("tenant_id", state.tenantId);
    await admin.from("landlords").delete().eq("tenant_id", state.tenantId);
    await admin.from("tenants").delete().eq("id", state.tenantId);
  }
  state.authUserId = null;
  state.tenantId = null;
}

async function main() {
  loadEnvFromArgv(process.argv.slice(2));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ??
    "";
  assert(url.includes(STAGING_REF), "Expected staging Supabase URL in env");
  assert(serviceKey, "SUPABASE_SERVICE_ROLE_KEY required");
  assert(anonKey.length > 20, "Missing anon/publishable key for login test");

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const anon = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const stamp = Date.now();
  const email = `landlord.suspend.${stamp}@test.davors`;
  const name = `Landlord Suspend Test ${stamp}`;
  const state: Cleanup = { tenantId: null, authUserId: null };

  console.log("=== Landlord suspend / reactivate (staging) ===\n");

  try {
    const slug = await resolveAvailableSlug(admin, name);
    assert(slug, "Unable to resolve slug");
    const now = new Date().toISOString();

    const { data: tenantRow, error: tenantError } = await admin
      .from("tenants")
      .insert({
        name,
        slug,
        status: "active",
        product_line: "real_estate_only",
        email,
        phone: "+233200000003",
        address: "Suspend Test Address",
        updated_at: now,
      })
      .select("id")
      .single();
    assert(!tenantError && tenantRow, tenantError?.message ?? "tenant insert failed");
    state.tenantId = tenantRow.id;

    const { data: authCreated, error: createError } =
      await admin.auth.admin.createUser({
        email,
        password: TEST_PASSWORD,
        email_confirm: true,
        user_metadata: { full_name: name, portal: "landlord" },
      });
    assert(!createError && authCreated.user, createError?.message ?? "auth create failed");
    state.authUserId = authCreated.user.id;

    const { error: landlordError } = await admin.from("landlords").insert({
      tenant_id: state.tenantId,
      landlord_type: "platform_only",
      approval_status: "pending",
      auth_user_id: authCreated.user.id,
      sms_credit_balance: 0,
      created_at: now,
      updated_at: now,
    });
    assert(!landlordError, landlordError?.message ?? "landlord insert failed");

    await approveLandlordForTest(admin, state.tenantId);
    console.log("PASS — approved landlord with linked auth user");

    const loginBefore = await anon.auth.signInWithPassword({
      email,
      password: TEST_PASSWORD,
    });
    assert(
      !loginBefore.error && loginBefore.data.user,
      loginBefore.error?.message ?? "login before suspend failed",
    );
    await anon.auth.signOut();
    console.log("PASS — login succeeds before suspend");

    const { error: suspendStatusError } = await admin
      .from("landlords")
      .update({
        approval_status: "suspended",
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", state.tenantId);
    assert(!suspendStatusError, suspendStatusError?.message ?? "suspend status failed");

    await suspendLandlordAuthForTest(admin, authCreated.user.id);
    console.log("PASS — suspended status + auth ban applied");

    const { data: bannedUser } = await admin.auth.admin.getUserById(
      authCreated.user.id,
    );
    assert(
      isAuthUserBanned(bannedUser.user?.banned_until),
      "Auth user should be banned after suspend",
    );

    const loginAfterSuspend = await anon.auth.signInWithPassword({
      email,
      password: TEST_PASSWORD,
    });
    assert(
      loginAfterSuspend.error,
      "Login should fail while suspended/banned",
    );
    console.log("PASS — login blocked after suspend");

    await approveLandlordForTest(admin, state.tenantId);
    await reactivateLandlordAuthForTest(admin, authCreated.user.id);
    console.log("PASS — reactivated via approve + ban lift");

    const { data: reactivatedLandlord } = await admin
      .from("landlords")
      .select("approval_status")
      .eq("tenant_id", state.tenantId)
      .single();
    assert(
      reactivatedLandlord?.approval_status === "approved",
      "Landlord should be approved after reactivation",
    );

    const loginAfterReactivate = await anon.auth.signInWithPassword({
      email,
      password: TEST_PASSWORD,
    });
    assert(
      !loginAfterReactivate.error && loginAfterReactivate.data.user,
      loginAfterReactivate.error?.message ?? "login after reactivate failed",
    );
    console.log("PASS — login succeeds after reactivation");

    console.log("\nAll landlord suspend staging checks passed.");
  } finally {
    await cleanup(admin, state);
    console.log("\nCleanup complete.");
  }
}

main().catch((error) => {
  console.error("\nFAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
});
