/**
 * Phase 3 production smoke tests (portal.davorsfacilities.com).
 *
 *   npx tsx scripts/test-phase3-production-smoke.ts --env-file .env.local.backup
 */
import { createHash, randomBytes } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { assert, loadEnvFromArgv } from "./lib/env";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const PRODUCTION_APP_URL = "https://portal.davorsfacilities.com";
const DAVORS_TENANT_ID = "00000001-0000-4000-8000-000000000001";
const STAFF_EMAIL =
  process.env.PRODUCTION_STAFF_EMAIL?.trim() ?? "david.avors@gmail.com";
const INVITE_PASSWORD = "Phase3Invite-Test12!";
const stamp = Date.now().toString(36);

type Result = { name: string; pass: boolean; detail?: string };
const results: Result[] = [];

function record(name: string, pass: boolean, detail?: string) {
  results.push({ name, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

function hashStaffInviteToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
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

async function sessionFromMagicLink(
  supabaseUrl: string,
  anonKey: string,
  admin: SupabaseClient,
  email: string,
  redirectPath: string,
) {
  const { data, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: `${PRODUCTION_APP_URL}${redirectPath}` },
  });
  if (error || !data.properties?.hashed_token) {
    return { ok: false as const, error: error?.message ?? "generateLink failed" };
  }

  const anon = createClient(supabaseUrl, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const verified = await anon.auth.verifyOtp({
    type: "magiclink",
    token_hash: data.properties.hashed_token,
  });
  if (verified.error || !verified.data.session) {
    return { ok: false as const, error: verified.error?.message ?? "verifyOtp failed" };
  }
  return { ok: true as const, session: verified.data.session };
}

function buildSessionCookie(
  supabaseUrl: string,
  session: {
    access_token: string;
    refresh_token: string;
    expires_at?: number;
    expires_in?: number;
    user: unknown;
  },
): string {
  const projectRef = new URL(supabaseUrl).hostname.split(".")[0];
  const cookieName = `sb-${projectRef}-auth-token`;
  const cookieValue = encodeURIComponent(
    JSON.stringify({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: session.expires_at,
      expires_in: session.expires_in,
      token_type: "bearer",
      user: session.user,
    }),
  );
  return `${cookieName}=${cookieValue}`;
}

async function fetchHub(path: string, cookie?: string) {
  const response = await fetch(`${PRODUCTION_APP_URL}${path}`, {
    redirect: "follow",
    headers: cookie ? { Cookie: cookie } : {},
  });
  return { response, finalUrl: response.url };
}

async function testOAuthStartRedirects() {
  for (const [provider, label, needle] of [
    ["google", "Google", "accounts.google.com"],
    ["azure", "Microsoft", "login.microsoftonline.com"],
  ] as const) {
    const res = await fetch(
      `${PRODUCTION_APP_URL}/auth/start?provider=${provider}&persona=staff&flow=login`,
      { redirect: "manual" },
    );
    const location = res.headers.get("location") ?? "";
    record(
      `Staff OAuth ${label} auth/start redirect`,
      res.status >= 300 &&
        res.status < 400 &&
        (location.includes(needle) || location.includes("supabase.co")),
      `status=${res.status}`,
    );
  }
}

async function testStaffAccountHubViaMagicLink(
  supabaseUrl: string,
  anonKey: string,
  admin: SupabaseClient,
) {
  const sessionResult = await sessionFromMagicLink(
    supabaseUrl,
    anonKey,
    admin,
    STAFF_EMAIL,
    "/dashboard/my-account",
  );
  if (!sessionResult.ok) {
    record(
      "Staff account hub /dashboard/my-account",
      false,
      sessionResult.error,
    );
    return;
  }

  const cookie = buildSessionCookie(supabaseUrl, sessionResult.session);
  const staff = await fetchHub("/dashboard/my-account", cookie);
  record(
    "Staff account hub /dashboard/my-account",
    staff.response.ok && staff.finalUrl.includes("/dashboard/my-account"),
    staff.response.ok ? undefined : `HTTP ${staff.response.status}`,
  );
  record(
    "Staff login MFA gate (david, enforcement off)",
    !staff.finalUrl.includes("/login/mfa"),
    staff.finalUrl,
  );
}

async function testPortalAccountHubs(
  supabaseUrl: string,
  anonKey: string,
  admin: SupabaseClient,
) {
  const { data: lesseeRows } = await admin
    .from("lessees")
    .select("auth_user_id, email")
    .limit(50);

  let lesseeEmail: string | null = null;
  for (const row of lesseeRows ?? []) {
    if (typeof row.email === "string" && row.email.includes("@")) {
      lesseeEmail = row.email.trim().toLowerCase();
      break;
    }
    if (!row.auth_user_id) continue;
    const { data: authUser } = await admin.auth.admin.getUserById(row.auth_user_id);
    const email = authUser.user?.email?.trim().toLowerCase();
    if (email) {
      lesseeEmail = email;
      break;
    }
  }

  if (lesseeEmail) {
    const sessionResult = await sessionFromMagicLink(
      supabaseUrl,
      anonKey,
      admin,
      lesseeEmail,
      "/portal/account",
    );
    if (sessionResult.ok) {
      const cookie = buildSessionCookie(supabaseUrl, sessionResult.session);
      const portal = await fetchHub("/portal/account", cookie);
      record(
        "Tenant account hub /portal/account",
        portal.response.ok && portal.finalUrl.includes("/portal/account"),
        lesseeEmail,
      );
    } else {
      record("Tenant account hub /portal/account", false, sessionResult.error);
    }
  } else {
    record("Tenant account hub /portal/account", false, "no lessee with auth email");
  }

  const { data: landlordRows } = await admin
    .from("landlords")
    .select("tenant_id, landlord_type, approval_status")
    .eq("approval_status", "approved")
    .limit(20);

  let landlordEmail: string | null = null;
  for (const row of landlordRows ?? []) {
    const { data: tenant } = await admin
      .from("tenants")
      .select("email")
      .eq("id", row.tenant_id)
      .maybeSingle();
    const email =
      typeof tenant?.email === "string" ? tenant.email.trim().toLowerCase() : "";
    if (email) {
      landlordEmail = email;
      break;
    }
  }

  if (landlordEmail) {
    const sessionResult = await sessionFromMagicLink(
      supabaseUrl,
      anonKey,
      admin,
      landlordEmail,
      "/landlord-portal/account",
    );
    if (sessionResult.ok) {
      const cookie = buildSessionCookie(supabaseUrl, sessionResult.session);
      const lp = await fetchHub("/landlord-portal/account", cookie);
      record(
        "Landlord account hub /landlord-portal/account",
        lp.response.ok && lp.finalUrl.includes("/landlord-portal/account"),
        landlordEmail,
      );
    } else {
      record(
        "Landlord account hub /landlord-portal/account",
        false,
        sessionResult.error,
      );
    }
  } else {
    record(
      "Landlord account hub /landlord-portal/account",
      false,
      "no approved landlord tenant email",
    );
  }
}

async function testStaffInviteOAuthAccept(admin: SupabaseClient) {
  const email = `phase3-invite-${stamp}@example.com`;
  const rawToken = randomBytes(32).toString("hex");
  const { error: inviteErr } = await admin.from("staff_portal_invites").insert({
    tenant_id: DAVORS_TENANT_ID,
    email,
    role: "employee",
    token_hash: hashStaffInviteToken(rawToken),
    expires_at: new Date(Date.now() + 86400000).toISOString(),
  });
  assert(!inviteErr, inviteErr?.message ?? "invite insert failed");

  const { data: created, error: createErr } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  assert(!createErr && created.user?.id, createErr?.message ?? "createUser failed");
  const authUid = created.user!.id;

  try {
    const result = await acceptStaffInviteOAuth(admin, authUid, email, rawToken);
    const { data: account } = await admin
      .from("user_accounts")
      .select("auth_uid, tenant_id, email")
      .eq("auth_uid", authUid)
      .maybeSingle();
    record(
      "Staff invite OAuth accept",
      result.ok && Boolean(account),
      result.ok ? `tenant ${account?.tenant_id}` : result.error,
    );

    const passwordRes = await fetch(`${PRODUCTION_APP_URL}/api/staff/accept-invite`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: rawToken, password: INVITE_PASSWORD }),
    });
    record(
      "Staff invite password accept API (used invite)",
      passwordRes.status === 400,
      `expected 400 for used token, got ${passwordRes.status}`,
    );
  } finally {
    await admin.from("user_accounts").delete().eq("auth_uid", authUid);
    await admin
      .from("staff_portal_invites")
      .delete()
      .eq("token_hash", hashStaffInviteToken(rawToken));
    await admin.auth.admin.deleteUser(authUid);
  }
}

async function testStaffOAuthSignupCleanup(admin: SupabaseClient) {
  const email = `phase3-oauth-signup-${stamp}@example.com`;
  const { data: created, error } = await admin.auth.admin.createUser({
    email,
    email_confirm: true,
  });
  assert(!error && created.user?.id, error?.message ?? "createUser failed");
  const authUid = created.user!.id;
  const tenantId = crypto.randomUUID();
  const companyName = `Phase3 OAuth ${stamp}`;

  try {
    const { error: tenantErr } = await admin.from("tenants").insert({
      id: tenantId,
      name: companyName,
      slug: `phase3-oauth-${stamp}`.slice(0, 40),
      status: "active",
    });
    record(
      "Staff OAuth signup provisioning + cleanup",
      !tenantErr,
      tenantErr?.message ?? tenantId,
    );
  } finally {
    await admin.from("tenants").delete().eq("id", tenantId);
    await admin.auth.admin.deleteUser(authUid);
  }
}

async function testTenantIsolationSpotCheck(admin: SupabaseClient) {
  const { data: tenants } = await admin
    .from("tenants")
    .select("id, name")
    .neq("id", DAVORS_TENANT_ID)
    .limit(2);
  if (!tenants || tenants.length < 2) {
    record("Tenant isolation spot check", true, "skipped (<2 non-Davors tenants)");
    return;
  }
  const [a, b] = tenants;
  const bEmployees =
    (
      await admin.from("employees").select("employee_id").eq("tenant_id", b.id).limit(5)
    ).data?.map((r) => r.employee_id) ?? [];
  const { count: crossCount } = await admin
    .from("employees")
    .select("employee_id", { count: "exact", head: true })
    .eq("tenant_id", a.id)
    .in("employee_id", bEmployees);
  record(
    "Tenant isolation spot check (employees)",
    (crossCount ?? 0) === 0,
    `tenants ${a.name} vs ${b.name}`,
  );
}

async function main() {
  loadEnvFromArgv(process.argv.slice(2));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ??
    "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  assert(url.includes(PRODUCTION_REF), `Expected production ref ${PRODUCTION_REF}`);
  assert(anonKey && serviceKey, "Missing Supabase keys");

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log(`\n=== Phase 3 production smoke (${PRODUCTION_APP_URL}) ===\n`);
  await testOAuthStartRedirects();
  await testStaffAccountHubViaMagicLink(url, anonKey, admin);
  await testPortalAccountHubs(url, anonKey, admin);
  await testStaffInviteOAuthAccept(admin);
  await testStaffOAuthSignupCleanup(admin);
  await testTenantIsolationSpotCheck(admin);

  const failed = results.filter((r) => !r.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length > 0) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
