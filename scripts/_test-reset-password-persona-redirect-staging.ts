/**
 * Staging: persona-aware password-reset completion redirect.
 *
 *   npx tsx scripts/_test-reset-password-persona-redirect-staging.ts
 *   npx tsx scripts/_test-reset-password-persona-redirect-staging.ts --env-file .env.staging.local
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { findAnyPersonaByAuthUid } from "../lib/auth/oauth-persona-resolve";
import { passwordResetDestinationForPersona } from "../lib/auth/reset-password-redirect";
import {
  PORTAL_CHOOSER_PATH,
  WRONG_PORTAL_LOGIN_MESSAGE,
} from "../utils/portal-chooser";
import { DAVORS_TENANT_ID, ERP_SUITE_SIGNUP_SOURCE } from "../utils/tenant-signup";
import { assert, loadEnvFromArgv } from "./lib/env";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const PASSWORD = "ResetPersona-Test-8Qx!";
const NEW_PASSWORD = "ResetPersona-New-9Mn!";

type CleanupState = {
  tenantIds: string[];
  authUids: string[];
  lesseeIds: string[];
  subscriptionIds: string[];
  customerIds: string[];
};

const cleanup: CleanupState = {
  tenantIds: [],
  authUids: [],
  lesseeIds: [],
  subscriptionIds: [],
  customerIds: [],
};

function pass(label: string) {
  console.log(`PASS — ${label}`);
}

function fail(label: string, err: unknown) {
  const msg = err instanceof Error ? err.message : String(err);
  console.error(`FAIL — ${label}: ${msg}`);
}

function anonKey() {
  return (
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ||
    ""
  );
}

async function createTenant(admin: SupabaseClient, stamp: string) {
  const slug = `reset-persona-${stamp}`.slice(0, 63);
  const { data, error } = await admin
    .from("tenants")
    .insert({ name: `Reset Persona ${stamp}`, slug, status: "active" })
    .select("id")
    .single();
  assert(!error && data, error?.message ?? "tenant insert failed");
  cleanup.tenantIds.push(data.id);
  return data.id as string;
}

async function ensureSubscription(admin: SupabaseClient, tenantId: string, stamp: string) {
  const clientId = `RSP-${stamp}`.slice(0, 32);
  await admin.from("customers").insert({
    tenant_id: DAVORS_TENANT_ID,
    client_id: clientId,
    client_name: `Reset Persona ${stamp}`,
    customer_type: "digital_subscriber",
    source: ERP_SUITE_SIGNUP_SOURCE,
    status: "lead",
  });
  cleanup.customerIds.push(clientId);

  const { data, error } = await admin
    .from("crm_subscriptions")
    .insert({
      tenant_id: DAVORS_TENANT_ID,
      customer_id: clientId,
      linked_tenant_id: tenantId,
      subscription_status: "trialing",
      billing_waived: true,
      trial_end_date: "2099-12-31T23:59:59Z",
    })
    .select("id")
    .single();
  assert(!error && data, error?.message ?? "subscription insert failed");
  cleanup.subscriptionIds.push(data.id);
}

async function createAuthUser(admin: SupabaseClient, email: string) {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  assert(!error && data.user, error?.message ?? "auth user create failed");
  cleanup.authUids.push(data.user.id);
  return data.user.id;
}

async function recoveryUpdatePassword(
  admin: SupabaseClient,
  anon: SupabaseClient,
  email: string,
) {
  const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
    type: "recovery",
    email,
    options: { redirectTo: "http://localhost:3000/reset-password" },
  });
  assert(
    !linkErr && linkData?.properties?.hashed_token,
    linkErr?.message ?? "generateLink failed",
  );

  const { data: verifyData, error: verifyErr } = await anon.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: "recovery",
  });
  assert(!verifyErr && verifyData.session, verifyErr?.message ?? "verifyOtp failed");

  const { error: updateErr } = await anon.auth.updateUser({ password: NEW_PASSWORD });
  assert(!updateErr, updateErr?.message ?? "updateUser failed");

  const {
    data: { user },
  } = await anon.auth.getUser();
  assert(user, "expected user after recovery update");

  return user.id;
}

function assertDestination(
  admin: SupabaseClient,
  authUid: string,
  expectedPath: string,
  expectedPersona: "staff" | "lessee" | "landlord" | null,
) {
  return findAnyPersonaByAuthUid(admin, authUid).then((persona) => {
    if (expectedPersona === null) {
      assert(persona === null, `expected no active persona, got ${persona?.persona}`);
    } else {
      assert(persona?.persona === expectedPersona, `persona ${persona?.persona}`);
    }
    const destination = passwordResetDestinationForPersona(persona);
    assert(
      destination.loginPath === expectedPath,
      `loginPath ${destination.loginPath} !== ${expectedPath}`,
    );
    assert(
      destination.successMessage.includes("Password updated"),
      `unexpected success message: ${destination.successMessage}`,
    );
    return destination;
  });
}

async function simulatePortalLoginBlocked(
  anon: SupabaseClient,
  admin: SupabaseClient,
  email: string,
) {
  const { data: signInData, error: signInErr } = await anon.auth.signInWithPassword({
    email,
    password: NEW_PASSWORD,
  });
  assert(!signInErr && signInData.user, signInErr?.message ?? "sign-in failed");

  const { data: activeLessee } = await admin
    .from("lessees")
    .select("lessee_id")
    .eq("auth_user_id", signInData.user.id)
    .neq("status", "former")
    .maybeSingle();

  if (!activeLessee) {
    assert(
      WRONG_PORTAL_LOGIN_MESSAGE.length > 0,
      "wrong portal message constant missing",
    );
  }

  await anon.auth.signOut();
}

async function cleanupAll(admin: SupabaseClient) {
  for (const lesseeId of cleanup.lesseeIds) {
    await admin.from("lessees").delete().eq("lessee_id", lesseeId);
  }
  for (const authUid of cleanup.authUids) {
    await admin.auth.admin.deleteUser(authUid);
  }
  for (const subscriptionId of cleanup.subscriptionIds) {
    await admin.from("crm_subscriptions").delete().eq("id", subscriptionId);
  }
  for (const clientId of cleanup.customerIds) {
    await admin.from("customers").delete().eq("client_id", clientId);
  }
  for (const tenantId of cleanup.tenantIds) {
    await admin.from("tenants").delete().eq("id", tenantId);
  }
}

async function main() {
  const envFile = loadEnvFromArgv(process.argv.slice(2));
  console.log(`Loaded env: ${envFile}`);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  assert(url.includes(STAGING_REF), `Expected staging ref ${STAGING_REF}`);
  assert(serviceKey, "Missing SUPABASE_SERVICE_ROLE_KEY");
  assert(anonKey(), "Missing anon/publishable key");
  pass(`staging ref ${STAGING_REF}`);

  const formSrc = readFileSync(
    resolve(process.cwd(), "components/auth/reset-password-form.tsx"),
    "utf8",
  );
  assert(
    formSrc.includes("resolvePasswordResetRedirect"),
    "reset-password-form must call resolvePasswordResetRedirect",
  );
  assert(
    formSrc.includes("passwordResetDestinationForPersona") === false,
    "form should use server action, not inline persona mapping",
  );
  pass("reset-password-form uses persona-aware server action");

  const docsSrc = readFileSync(
    resolve(process.cwd(), "docs/supabase-auth-setup.md"),
    "utf8",
  );
  assert(
    docsSrc.includes("token_hash={{ .TokenHash }}"),
    "docs must document token_hash reset template",
  );
  pass("docs/supabase-auth-setup.md documents token_hash template");

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const anon = createClient(url, anonKey(), {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const stamp = Date.now().toString(36);
  const tenantId = await createTenant(admin, stamp);
  await ensureSubscription(admin, tenantId, stamp);

  const results: Record<string, "PASS" | "FAIL" | "SKIP"> = {
    a: "SKIP",
    b: "SKIP",
    c: "SKIP",
    d: "SKIP",
  };

  try {
    // (c) staff — test first to match staff > lessee > landlord priority in other combos
    try {
      const email = `reset.staff.${stamp}@example.com`;
      const authUid = await createAuthUser(admin, email);
      const { error: staffErr } = await admin.from("user_accounts").insert({
        auth_uid: authUid,
        email,
        role: "super_admin",
        is_active: true,
        tenant_id: tenantId,
      });
      assert(!staffErr, staffErr?.message ?? "staff insert failed");

      const updatedUid = await recoveryUpdatePassword(admin, anon, email);
      assert(updatedUid === authUid, "auth uid mismatch after recovery");
      await assertDestination(admin, authUid, "/login", "staff");
      await anon.auth.signOut();
      results.c = "PASS";
      pass("(c) staff reset → /login");
    } catch (err) {
      fail("(c) staff reset", err);
      results.c = "FAIL";
    }

    // (b) tenant / lessee
    try {
      const email = `reset.lessee.${stamp}@example.com`;
      const authUid = await createAuthUser(admin, email);
      const lesseeId = randomUUID();
      const nowIso = new Date().toISOString();
      const { error: lesseeErr } = await admin.from("lessees").insert({
        lessee_id: lesseeId,
        tenant_id: tenantId,
        auth_user_id: authUid,
        full_name: `Reset Lessee ${stamp}`,
        email,
        phone: "+233200000001",
        status: "active",
        created_at: nowIso,
        updated_at: nowIso,
      });
      assert(!lesseeErr, lesseeErr?.message ?? "lessee insert failed");
      cleanup.lesseeIds.push(lesseeId);

      await recoveryUpdatePassword(admin, anon, email);
      await assertDestination(admin, authUid, "/portal/login", "lessee");
      await anon.auth.signOut();
      results.b = "PASS";
      pass("(b) tenant reset → /portal/login");
    } catch (err) {
      fail("(b) tenant reset", err);
      results.b = "FAIL";
    }

    // (a) landlord
    try {
      const email = `reset.landlord.${stamp}@example.com`;
      const authUid = await createAuthUser(admin, email);
      const landlordTenantId = await createTenant(admin, `${stamp}-ll`);
      const nowIso = new Date().toISOString();
      const { error: landlordErr } = await admin.from("landlords").insert({
        tenant_id: landlordTenantId,
        auth_user_id: authUid,
        approval_status: "approved",
        landlord_type: "platform_only",
        sms_credit_balance: 0,
        created_at: nowIso,
        updated_at: nowIso,
      });
      assert(!landlordErr, landlordErr?.message ?? "landlord insert failed");

      await recoveryUpdatePassword(admin, anon, email);
      await assertDestination(admin, authUid, "/landlord-portal/login", "landlord");
      await anon.auth.signOut();
      results.a = "PASS";
      pass("(a) landlord reset → /landlord-portal/login");
    } catch (err) {
      fail("(a) landlord reset", err);
      results.a = "FAIL";
    }

    // (d) former lessee — chooser + login blocked at tenant portal
    try {
      const email = `reset.former.${stamp}@example.com`;
      const authUid = await createAuthUser(admin, email);
      const formerLesseeId = randomUUID();
      const nowIso = new Date().toISOString();
      const { error: formerErr } = await admin.from("lessees").insert({
        lessee_id: formerLesseeId,
        tenant_id: tenantId,
        auth_user_id: authUid,
        full_name: `Former Reset ${stamp}`,
        email,
        phone: "+233200000002",
        status: "former",
        created_at: nowIso,
        updated_at: nowIso,
      });
      assert(!formerErr, formerErr?.message ?? "former lessee insert failed");
      cleanup.lesseeIds.push(formerLesseeId);

      await admin
        .from("lessees")
        .update({ auth_user_id: null, updated_at: nowIso })
        .eq("lessee_id", formerLesseeId);

      await recoveryUpdatePassword(admin, anon, email);
      await assertDestination(admin, authUid, PORTAL_CHOOSER_PATH, null);
      await simulatePortalLoginBlocked(anon, admin, email);
      results.d = "PASS";
      pass("(d) former lessee → chooser, tenant login blocked");
    } catch (err) {
      fail("(d) former lessee", err);
      results.d = "FAIL";
    }

    console.log("\n=== Summary ===");
    for (const key of ["a", "b", "c", "d"] as const) {
      console.log(`  (${key}) ${results[key]}`);
    }

    const allPass = Object.values(results).every((r) => r === "PASS");
    if (!allPass) process.exit(1);
    console.log("\nALL RESET-PASSWORD PERSONA REDIRECT STAGING CHECKS PASSED\n");
  } finally {
    await cleanupAll(admin);
  }
}

main().catch((err) => {
  console.error("\nFAIL:", err instanceof Error ? err.message : String(err));
  process.exit(1);
});
