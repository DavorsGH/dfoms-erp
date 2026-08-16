/**
 * Staging regression: landlord self-signup → email confirm → auto-approve → login.
 *
 *   npx tsx scripts/test-landlord-signup-auto-approve-staging.ts --env-file .env.staging.local
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  buildUniqueSlugCandidates,
  slugifyCompanyName,
} from "../utils/tenant-signup";
import { assert, loadEnvFromArgv } from "./lib/env";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const TEST_PASSWORD = "LandlordSignup-Test-7Kx9!";
const ERP_SUITE_TRIAL_DAYS = 90;

type Cleanup = {
  tenantId: string | null;
  authUserId: string | null;
};

async function resolveAvailableSlug(admin: SupabaseClient, name: string) {
  const baseSlug = slugifyCompanyName(name);
  const candidates = buildUniqueSlugCandidates(baseSlug);
  const { data: existingRows, error } = await admin
    .from("tenants")
    .select("slug")
    .in("slug", candidates);
  assert(!error, error?.message ?? "slug lookup failed");
  const taken = new Set((existingRows ?? []).map((row) => row.slug));
  return candidates.find((candidate) => !taken.has(candidate)) ?? null;
}

async function createTestPendingLandlord(
  admin: SupabaseClient,
  input: { name: string; email: string; phone: string; address: string },
) {
  const slug = await resolveAvailableSlug(admin, input.name);
  assert(slug, "Unable to resolve slug");

  const now = new Date().toISOString();
  const { data: tenantRow, error: tenantError } = await admin
    .from("tenants")
    .insert({
      name: input.name,
      slug,
      status: "active",
      product_line: "real_estate_only",
      email: input.email,
      phone: input.phone,
      address: input.address,
      updated_at: now,
    })
    .select("id")
    .single();
  assert(!tenantError && tenantRow, tenantError?.message ?? "tenant insert failed");

  const { error: landlordError } = await admin.from("landlords").insert({
    tenant_id: tenantRow.id,
    landlord_type: "platform_only",
    approval_status: "pending",
    sms_credit_balance: 0,
    created_at: now,
    updated_at: now,
  });
  assert(!landlordError, landlordError?.message ?? "landlord insert failed");

  return tenantRow.id as string;
}

async function approveLandlordForTest(admin: SupabaseClient, tenantId: string) {
  const { data: landlord, error: landlordError } = await admin
    .from("landlords")
    .select("approval_status, landlord_type")
    .eq("tenant_id", tenantId)
    .single();
  assert(!landlordError && landlord, landlordError?.message ?? "landlord load failed");

  if (landlord.approval_status === "approved") {
    return { transitioned: false };
  }

  const { error: updateError } = await admin
    .from("landlords")
    .update({
      approval_status: "approved",
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", tenantId);
  assert(!updateError, updateError?.message ?? "approve update failed");

  const { data: existingSub } = await admin
    .from("landlord_subscriptions")
    .select("tenant_id")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (!existingSub && landlord.landlord_type === "platform_only") {
    const trialEnd = new Date();
    trialEnd.setUTCDate(trialEnd.getUTCDate() + ERP_SUITE_TRIAL_DAYS);
    const trialEndsAt = trialEnd.toISOString().slice(0, 10);
    const periodStart = new Date().toISOString().slice(0, 10);

    const { error: subError } = await admin.from("landlord_subscriptions").insert({
      tenant_id: tenantId,
      tier: "platform",
      status: "trialing",
      trial_ends_at: trialEndsAt,
      active_unit_count: 0,
      included_units: 0,
      base_price_ghs: 0,
      extra_unit_price_ghs: 0,
      current_period_price_ghs: 0,
      current_period_start: periodStart,
      current_period_end: trialEndsAt,
      billing_cycle: "monthly",
      pending_billing_cycle: null,
    });
    assert(!subError, subError?.message ?? "subscription insert failed");
  }

  return { transitioned: true };
}

async function cleanup(admin: SupabaseClient, state: Cleanup) {
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
  assert(url.includes(STAGING_REF), "Expected staging Supabase URL in env");
  assert(serviceKey, "SUPABASE_SERVICE_ROLE_KEY required");

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const stamp = Date.now();
  const email = `landlord.signup.${stamp}@test.davors`;
  const name = `Landlord Signup Test ${stamp}`;
  const state: Cleanup = { tenantId: null, authUserId: null };

  console.log("=== Landlord signup auto-approve (staging) ===\n");

  try {
    state.tenantId = await createTestPendingLandlord(admin, {
      name,
      email,
      phone: "+233200000001",
      address: "Test Address, Accra",
    });
    console.log("PASS — pending landlord tenant created");

    const { data: authCreated, error: createError } =
      await admin.auth.admin.createUser({
        email,
        password: TEST_PASSWORD,
        email_confirm: false,
        user_metadata: { full_name: name, portal: "landlord" },
      });
    assert(!createError && authCreated.user, createError?.message ?? "auth create failed");
    state.authUserId = authCreated.user.id;

    const { error: linkError } = await admin
      .from("landlords")
      .update({ auth_user_id: authCreated.user.id })
      .eq("tenant_id", state.tenantId)
      .is("auth_user_id", null);
    assert(!linkError, linkError?.message ?? "landlord link failed");
    console.log("PASS — auth user created (unconfirmed)");

    const { data: unconfirmedUser } = await admin.auth.admin.getUserById(
      authCreated.user.id,
    );
    assert(
      !unconfirmedUser.user?.email_confirmed_at,
      "Auth user should be unconfirmed after createUser(email_confirm: false)",
    );
    console.log("PASS — email not confirmed (login blocked by Supabase Auth)");

    const { data: pendingLandlord } = await admin
      .from("landlords")
      .select("approval_status")
      .eq("tenant_id", state.tenantId)
      .single();
    assert(
      pendingLandlord?.approval_status === "pending",
      "Landlord should remain pending before confirm",
    );
    console.log("PASS — approval_status still pending pre-confirm");

    const { data: linkData, error: verifyLinkError } =
      await admin.auth.admin.generateLink({
        type: "signup",
        email,
        password: TEST_PASSWORD,
      });
    assert(
      !verifyLinkError && linkData?.properties?.hashed_token,
      verifyLinkError?.message ?? "generateLink failed",
    );
    console.log("PASS — verification link generated (signup email path)");

    const anonKey =
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ??
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ??
      process.env.SUPABASE_ANON_KEY?.trim() ??
      "";
    assert(anonKey.length > 20, "Missing usable anon/publishable key for verifyOtp/login");

    const anon = createClient(url, anonKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const { error: verifyError } = await anon.auth.verifyOtp({
      token_hash: linkData.properties.hashed_token,
      type: "signup",
    });
    assert(!verifyError, verifyError?.message ?? "verifyOtp failed");
    console.log("PASS — email confirmed via verifyOtp (real auth path)");

    const { data: confirmedUser } = await admin.auth.admin.getUserById(
      authCreated.user.id,
    );
    assert(
      confirmedUser.user?.email_confirmed_at,
      "Auth user should have email_confirmed_at after verify",
    );

    const approval = await approveLandlordForTest(admin, state.tenantId);
    assert(approval.transitioned, "First approval should transition pending → approved");
    console.log("PASS — auto-approve on confirm (mirrors approveLandlordTenant)");

    const { data: approvedLandlord } = await admin
      .from("landlords")
      .select("approval_status")
      .eq("tenant_id", state.tenantId)
      .single();
    assert(
      approvedLandlord?.approval_status === "approved",
      "Landlord should be approved after confirm flow",
    );

    const { data: subscription } = await admin
      .from("landlord_subscriptions")
      .select("status")
      .eq("tenant_id", state.tenantId)
      .maybeSingle();
    assert(
      subscription?.status === "trialing",
      "Platform-only trial subscription should be seeded on approve",
    );
    console.log("PASS — trial subscription seeded");

    const reApproval = await approveLandlordForTest(admin, state.tenantId);
    assert(!reApproval.transitioned, "Re-approve should be idempotent");
    console.log("PASS — idempotent re-approve");

    await anon.auth.signOut();
    const loginAfter = await anon.auth.signInWithPassword({
      email,
      password: TEST_PASSWORD,
    });
    assert(
      !loginAfter.error && loginAfter.data.user,
      loginAfter.error?.message ?? "login after confirm failed",
    );
    console.log("PASS — login succeeds after email confirmation");

    console.log("\nAll landlord signup auto-approve staging checks passed.");
  } finally {
    await cleanup(admin, state);
    console.log("\nCleanup complete.");
  }
}

main().catch((error) => {
  console.error("\nFAILED:", error instanceof Error ? error.message : error);
  process.exit(1);
});
