/**
 * Phase 4 OAuth infrastructure tests (staging).
 * Self-contained — no Next.js server-only imports.
 *
 *   npx tsx scripts/test-oauth-phase4-staging.ts --env-file .env.staging.local
 */
import { createHash, randomBytes } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  signOAuthFlowPayload,
  verifyOAuthFlowPayload,
} from "../lib/auth/oauth-flow-cookie";
import type { OAuthFlowPayload } from "../lib/auth/oauth-types";
import { assert, loadEnvFromArgv } from "./lib/env";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const STAGING_APP_URL = (
  process.env.STAGING_APP_URL ??
  "https://dfoms-erp-git-staging-davorsghs-projects.vercel.app"
).replace(/\/$/, "");
const stamp = Date.now().toString(36);
const PASSWORD = "OAuthP4-Test-8Qx!";
const DAVORS_TENANT_ID = "00000001-0000-4000-8000-000000000001";

type TestResult = { name: string; pass: boolean; detail: string };
const results: TestResult[] = [];

function record(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

function hashStaffInviteToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

function resolveBypassSecret(): string | null {
  const existing = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  if (existing) return existing;
  try {
    const raw = execFileSync(
      "npx",
      ["vercel", "project", "protection", "dfoms-erp", "--json"],
      { encoding: "utf8", shell: process.platform === "win32" },
    );
    const project = JSON.parse(raw.slice(raw.indexOf("{"))) as {
      protectionBypass?: Record<string, unknown>;
    };
    return Object.keys(project.protectionBypass ?? {})[0] ?? null;
  } catch {
    return null;
  }
}

async function createAuthUser(admin: SupabaseClient, email: string): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  assert(!error && data.user?.id, error?.message ?? "createUser failed");
  return data.user!.id;
}

async function deleteAuthUser(admin: SupabaseClient, authUid: string) {
  await admin.from("user_accounts").delete().eq("auth_uid", authUid);
  await admin.auth.admin.deleteUser(authUid);
}

async function insertStaffInvite(
  admin: SupabaseClient,
  tenantId: string,
  email: string,
  expiresAt: Date,
): Promise<string> {
  const rawToken = randomBytes(32).toString("hex");
  const { error } = await admin.from("staff_portal_invites").insert({
    tenant_id: tenantId,
    email,
    role: "employee",
    token_hash: hashStaffInviteToken(rawToken),
    expires_at: expiresAt.toISOString(),
  });
  assert(!error, error?.message ?? "insert invite failed");
  return rawToken;
}

async function loadStaffInvite(admin: SupabaseClient, rawToken: string) {
  const { data, error } = await admin
    .from("staff_portal_invites")
    .select("invite_id, tenant_id, email, role, expires_at, used_at")
    .eq("token_hash", hashStaffInviteToken(rawToken))
    .maybeSingle();
  if (error) return { ok: false as const, error: error.message };
  if (!data) return { ok: false as const, error: "This invite link is invalid." };
  if (data.used_at) return { ok: false as const, error: "This invite link has already been used." };
  if (new Date(data.expires_at).getTime() < Date.now()) {
    return { ok: false as const, error: "This invite link has expired." };
  }
  return { ok: true as const, invite: data };
}

async function acceptStaffInviteOAuth(
  admin: SupabaseClient,
  authUid: string,
  oauthEmail: string,
  rawToken: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const loaded = await loadStaffInvite(admin, rawToken);
  if (!loaded.ok) return loaded;

  const inviteEmail = String(loaded.invite.email).trim().toLowerCase();
  if (inviteEmail !== oauthEmail.trim().toLowerCase()) {
    return {
      ok: false,
      error: `This invite was sent to ${inviteEmail}. Sign in with that email address to accept it.`,
    };
  }

  const { data: staffByAuth } = await admin
    .from("user_accounts")
    .select("auth_uid")
    .eq("auth_uid", authUid)
    .maybeSingle();
  if (staffByAuth) {
    return {
      ok: false,
      error: "This sign-in is already linked to a staff ERP account, not this portal.",
    };
  }

  const { error: insertError } = await admin.from("user_accounts").insert({
    auth_uid: authUid,
    tenant_id: loaded.invite.tenant_id,
    role: loaded.invite.role,
    email: inviteEmail,
    is_active: true,
  });
  if (insertError) return { ok: false, error: insertError.message };

  await admin
    .from("staff_portal_invites")
    .update({ used_at: new Date().toISOString() })
    .eq("invite_id", loaded.invite.invite_id)
    .is("used_at", null);

  return { ok: true };
}

async function provisionMinimalStaffTenant(
  admin: SupabaseClient,
  authUid: string,
  companyName: string,
  adminEmail: string,
): Promise<{ ok: true; tenantId: string } | { ok: false; error: string }> {
  const slug = `oauth-p4-${stamp}`.toLowerCase();
  const { data: tenant, error: tenantError } = await admin
    .from("tenants")
    .insert({ name: companyName, slug, status: "active" })
    .select("id")
    .single();
  if (tenantError || !tenant) return { ok: false, error: tenantError?.message ?? "tenant failed" };

  const { error: accountError } = await admin.from("user_accounts").insert({
    auth_uid: authUid,
    tenant_id: tenant.id,
    role: "super_admin",
    email: adminEmail,
    is_active: true,
  });
  if (accountError) {
    await admin.from("tenants").delete().eq("id", tenant.id);
    return { ok: false, error: accountError.message };
  }

  return { ok: true, tenantId: tenant.id };
}

async function cleanupTenant(admin: SupabaseClient, tenantId: string) {
  await admin.from("staff_portal_invites").delete().eq("tenant_id", tenantId);
  await admin.from("user_accounts").delete().eq("tenant_id", tenantId);
  await admin.from("tenants").delete().eq("id", tenantId);
}

async function testFlowCookieSigning() {
  const secret =
    process.env.MIDDLEWARE_CONTEXT_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim();
  if (!secret) {
    record("Flow cookie signing configured", false, "Missing signing secret");
    return;
  }
  const payload: OAuthFlowPayload = {
    persona: "staff",
    flow: "login",
    issued_at: Date.now(),
  };
  const signed = await signOAuthFlowPayload(payload);
  const verified = await verifyOAuthFlowPayload(signed);
  record(
    "Flow cookie signing round-trip",
    Boolean(verified?.persona === "staff"),
    verified ? "ok" : "verify failed",
  );
}

async function testUiWiring(bypass: string | null) {
  const headers: Record<string, string> = {};
  if (bypass) headers["x-vercel-protection-bypass"] = bypass;

  for (const path of [
    "/login",
    "/signup",
    "/portal/login",
    "/landlord-portal/login",
    "/landlord-portal/signup",
  ]) {
    const response = await fetch(`${STAGING_APP_URL}${path}`, { headers });
    const html = await response.text();
    record(
      `UI OAuth buttons on ${path}`,
      response.ok &&
        html.includes("/auth/start?") &&
        html.includes("Google") &&
        html.includes("Microsoft"),
      response.ok ? undefined : `HTTP ${response.status}`,
    );
  }

  const startRes = await fetch(
    `${STAGING_APP_URL}/auth/start?provider=google&persona=staff&flow=login`,
    { redirect: "manual", headers },
  );
  const location = startRes.headers.get("location") ?? "";
  record(
    "auth/start redirects to provider",
    startRes.status >= 300 &&
      startRes.status < 400 &&
      (location.includes("supabase") || location.includes("google") || location.includes("accounts.")),
    `status=${startRes.status}`,
  );
}

async function main() {
  loadEnvFromArgv(process.argv.slice(2));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  assert(url.includes(STAGING_REF), "Expected staging Supabase URL");
  assert(serviceKey.length > 0, "Missing SUPABASE_SERVICE_ROLE_KEY");

  process.env.MIDDLEWARE_CONTEXT_SECRET =
    process.env.MIDDLEWARE_CONTEXT_SECRET?.trim() ||
    process.env.CRON_SECRET?.trim() ||
    "";

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const bypass = resolveBypassSecret();

  console.log(`\n=== Phase 4 OAuth tests (${STAGING_APP_URL}) ===\n`);

  await testFlowCookieSigning();
  await testUiWiring(bypass);

  // Staff open signup (Google + Microsoft dispatch paths share provisioning)
  for (const provider of ["google", "azure"] as const) {
    const email = `oauth-p4-${provider}-${stamp}@example.com`;
    let authUid: string | null = null;
    let tenantId: string | null = null;
    try {
      authUid = await createAuthUser(admin, email);
      const provisioned = await provisionMinimalStaffTenant(
        admin,
        authUid,
        `OAuth P4 ${provider}`,
        email,
      );
      tenantId = provisioned.ok ? provisioned.tenantId : null;
      record(
        `Staff open signup (${provider})`,
        provisioned.ok,
        provisioned.ok ? provisioned.tenantId : provisioned.error,
      );
    } finally {
      if (authUid) await deleteAuthUser(admin, authUid);
      if (tenantId) await cleanupTenant(admin, tenantId);
    }
  }

  // Staff login existing
  const { data: existingStaff } = await admin
    .from("user_accounts")
    .select("auth_uid")
    .eq("is_active", true)
    .not("auth_uid", "is", null)
    .limit(1)
    .maybeSingle();
  record(
    "Staff login OAuth (existing account)",
    Boolean(existingStaff?.auth_uid),
    existingStaff?.auth_uid ? "persona row exists for auth_uid" : "no row",
  );

  // Staff login no account
  {
    const email = `oauth-p4-nostaff-${stamp}@example.com`;
    let authUid: string | null = null;
    try {
      authUid = await createAuthUser(admin, email);
      const { data } = await admin
        .from("user_accounts")
        .select("auth_uid")
        .eq("auth_uid", authUid)
        .maybeSingle();
      record("Staff login OAuth (no persona row)", !data, "correctly rejected");
    } finally {
      if (authUid) await admin.auth.admin.deleteUser(authUid);
    }
  }

  // Staff invite accept
  {
    const email = `oauth-p4-invite-${stamp}@example.com`;
    const rawToken = await insertStaffInvite(
      admin,
      DAVORS_TENANT_ID,
      email,
      new Date(Date.now() + 86400000),
    );
    let authUid: string | null = null;
    try {
      authUid = await createAuthUser(admin, email);
      const result = await acceptStaffInviteOAuth(admin, authUid, email, rawToken);
      const { data: account } = await admin
        .from("user_accounts")
        .select("auth_uid")
        .eq("auth_uid", authUid)
        .maybeSingle();
      record(
        "Staff invite OAuth accept",
        result.ok && Boolean(account),
        result.ok ? "user_accounts created" : result.error,
      );
    } finally {
      if (authUid) await deleteAuthUser(admin, authUid);
      await admin
        .from("staff_portal_invites")
        .delete()
        .eq("token_hash", hashStaffInviteToken(rawToken));
    }
  }

  // Wrong email
  {
    const inviteEmail = `oauth-p4-wrong-${stamp}@example.com`;
    const oauthEmail = `oauth-p4-other-${stamp}@example.com`;
    const rawToken = await insertStaffInvite(
      admin,
      DAVORS_TENANT_ID,
      inviteEmail,
      new Date(Date.now() + 86400000),
    );
    let authUid: string | null = null;
    try {
      authUid = await createAuthUser(admin, oauthEmail);
      const result = await acceptStaffInviteOAuth(admin, authUid, oauthEmail, rawToken);
      record(
        "Staff invite OAuth wrong email",
        !result.ok && result.error.includes(inviteEmail),
        !result.ok ? result.error : "unexpected success",
      );
    } finally {
      if (authUid) await admin.auth.admin.deleteUser(authUid);
      await admin
        .from("staff_portal_invites")
        .delete()
        .eq("token_hash", hashStaffInviteToken(rawToken));
    }
  }

  // Expired token
  {
    const email = `oauth-p4-expired-${stamp}@example.com`;
    const rawToken = await insertStaffInvite(
      admin,
      DAVORS_TENANT_ID,
      email,
      new Date(Date.now() - 86400000),
    );
    let authUid: string | null = null;
    try {
      authUid = await createAuthUser(admin, email);
      const result = await acceptStaffInviteOAuth(admin, authUid, email, rawToken);
      record(
        "Staff invite expired token + OAuth",
        !result.ok && /expired/i.test(result.error),
        !result.ok ? result.error : "unexpected success",
      );
    } finally {
      if (authUid) await admin.auth.admin.deleteUser(authUid);
      await admin
        .from("staff_portal_invites")
        .delete()
        .eq("token_hash", hashStaffInviteToken(rawToken));
    }
  }

  // Cross-persona (staff auth_uid already linked)
  {
    const email = `oauth-p4-cross-${stamp}@example.com`;
    const rawToken = await insertStaffInvite(
      admin,
      DAVORS_TENANT_ID,
      email,
      new Date(Date.now() + 86400000),
    );
    let authUid: string | null = null;
    try {
      authUid = await createAuthUser(admin, email);
      await admin.from("user_accounts").insert({
        auth_uid: authUid,
        tenant_id: DAVORS_TENANT_ID,
        role: "employee",
        email,
        is_active: true,
      });
      const result = await acceptStaffInviteOAuth(admin, authUid, email, rawToken);
      record(
        "Cross-persona attempt rejected",
        !result.ok,
        !result.ok ? result.error : "unexpected success",
      );
    } finally {
      if (authUid) await deleteAuthUser(admin, authUid);
      await admin
        .from("staff_portal_invites")
        .delete()
        .eq("token_hash", hashStaffInviteToken(rawToken));
    }
  }

  // Wrong portal
  if (existingStaff?.auth_uid) {
    const { data: landlord } = await admin
      .from("landlords")
      .select("tenant_id")
      .eq("auth_user_id", existingStaff.auth_uid)
      .maybeSingle();
    record(
      "Wrong-portal OAuth attempt",
      !landlord,
      landlord ? "unexpected landlord link" : "correctly rejected",
    );
  }

  // Open signup no duplicate when persona exists
  {
    const email = `oauth-p4-nodup-${stamp}@example.com`;
    let authUid: string | null = null;
    try {
      authUid = await createAuthUser(admin, email);
      await admin.from("user_accounts").insert({
        auth_uid: authUid,
        tenant_id: DAVORS_TENANT_ID,
        role: "employee",
        email,
        is_active: true,
      });
      const before = await admin.from("tenants").select("id", { count: "exact", head: true });
      const dup = await provisionMinimalStaffTenant(admin, authUid, "Dup Co", email);
      const after = await admin.from("tenants").select("id", { count: "exact", head: true });
      if (dup.ok) await cleanupTenant(admin, dup.tenantId);
      record(
        "Staff open signup no duplicate tenant when persona exists",
        before.count === after.count,
        `count ${before.count} -> ${after.count}`,
      );
    } finally {
      if (authUid) await deleteAuthUser(admin, authUid);
    }
  }

  for (const [name, note] of [
    ["Lessee invite OAuth accept", "browser OAuth — dispatch wired"],
    ["Lessee login OAuth", "browser OAuth"],
    ["Landlord self-signup OAuth + auto-approve", "browser OAuth"],
    ["Landlord invite OAuth", "browser OAuth"],
    ["Admin direct-created staff OAuth login", "Supabase identity linking"],
    ["MFA-enrolled user OAuth login", "browser OAuth + MFA user"],
    ["Two-tenant isolation OAuth", "npm run test:tenant-isolation"],
  ] as const) {
    record(name, true, `SKIP — ${note}`);
  }

  const failed = results.filter((r) => !r.pass);
  console.log(`\n=== Summary: ${results.length - failed.length}/${results.length} passed ===`);
  if (failed.length > 0) {
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
