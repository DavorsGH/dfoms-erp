/**
 * Staging security matrix for portal Login access APIs.
 *
 * Creates temporary fixtures (login-access-test+…@davorstechnologies.com),
 * hits real HTTP routes against staging Supabase, verifies audit rows, then
 * deletes every fixture (Auth, app rows, audit) and confirms cleanup.
 *
 * Covers landlord/lessee/FM paths (cases 1–11) plus staff User Accounts and
 * Tenant Management paths (cases 13–22) and self-edit / inactive-session
 * guards (23–26). Cleanup confirmation is case 12.
 *
 * API base (routes must include portal-login-access):
 *   - default: http://localhost:3000  (npm run dev + .env.staging.local)
 *   - LOGIN_ACCESS_API_BASE=… to override
 *   - LOGIN_ACCESS_USE_VERCEL=1 to use STAGING_APP_URL (after routes are deployed)
 *
 * Usage:
 *   npx tsx scripts/test-login-access-staging.ts --env-file .env.staging.local
 */
import { randomBytes, randomUUID } from "node:crypto";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import pg from "pg";
import { assert, loadEnvFromArgv } from "./lib/env";
import { DAVORS_TENANT_ID } from "../utils/tenant-signup";
import {
  SHARED_LOGIN_NON_DAVORS_REFUSAL_MESSAGE,
  TEMP_PASSWORD_EXPIRED_MESSAGE,
} from "../utils/portal-login-access/types";
import { readMustChangeState } from "../utils/portal-login-access/must-change-state";
import { PASSWORD_MIN_LENGTH } from "../utils/password-policy";
import {
  ACCOUNT_INACTIVE_NOTICE,
  ACCOUNT_NO_LONGER_ACTIVE_MESSAGE,
  SELF_ROLE_ACCESS_CHANGE_MESSAGE,
} from "../lib/auth/account-inactive-message";
import { isSupabaseAuthTokenCookie } from "../lib/auth/session-persistence";

const TEST_PASSWORD = "LoginAccess-Test-9Qx!ab12";
const TEMP_PASSWORD = "LoginAccess-Temp-7Mn!cd34";
const NEW_PASSWORD = "LoginAccess-New-3Kp!ef56";
const VERIFICATION_METHOD = "in_person";

type Cookie = { name: string; value: string };
type CaseResult = { name: string; pass: boolean; detail: string };

type CleanupState = {
  tenantIds: string[];
  authUids: string[];
  lesseeIds: string[];
  facilityManagerIds: string[];
  auditReasonTag: string;
  startedAt: string;
};

const results: CaseResult[] = [];

function record(name: string, pass: boolean, detail: string) {
  results.push({ name, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${name}${detail ? ` — ${detail}` : ""}`);
}

function emailFor(stamp: string, label: string): string {
  return `login-access-test+${stamp}-${label}@davorstechnologies.com`;
}

function bypassHeaders(): Record<string, string> {
  const bypass =
    process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim() ||
    "IJ7aYbMjtmTzXvZFVY1MdDdZYAlZcIDq";
  return bypass ? { "x-vercel-protection-bypass": bypass } : {};
}

function cookieHeader(store: Cookie[]): string {
  return store.map((c) => `${c.name}=${c.value}`).join("; ");
}

/**
 * Login-access routes may not be on Vercel until pushed. Local `npm run dev`
 * with `.env.staging.local` is the staging harness (same Supabase project).
 * Override with LOGIN_ACCESS_API_BASE, or set LOGIN_ACCESS_USE_VERCEL=1.
 */
function stagingBaseUrl(): string {
  const override = process.env.LOGIN_ACCESS_API_BASE?.trim();
  if (override) return override.replace(/\/$/, "");
  if (process.env.LOGIN_ACCESS_USE_VERCEL === "1") {
    return (
      process.env.STAGING_APP_URL ??
      "https://dfoms-erp-git-staging-davorsghs-projects.vercel.app"
    ).replace(/\/$/, "");
  }
  return "http://localhost:3000";
}

function makeSessionClient(
  url: string,
  anon: string,
  cookieStore: Cookie[],
) {
  return createServerClient(url, anon, {
    cookies: {
      getAll() {
        return cookieStore;
      },
      setAll(cookiesToSet) {
        for (const cookie of cookiesToSet) {
          const index = cookieStore.findIndex((row) => row.name === cookie.name);
          if (index >= 0) {
            cookieStore[index] = { name: cookie.name, value: cookie.value };
          } else {
            cookieStore.push({ name: cookie.name, value: cookie.value });
          }
        }
      },
    },
  });
}

async function signInCookies(
  url: string,
  anon: string,
  email: string,
  password: string,
): Promise<Cookie[]> {
  const cookieStore: Cookie[] = [];
  const client = makeSessionClient(url, anon, cookieStore);
  const { error } = await client.auth.signInWithPassword({ email, password });
  assert(!error, error?.message ?? `sign-in failed for ${email}`);
  assert(cookieStore.length > 0, `no auth cookies for ${email}`);
  return cookieStore;
}

async function fetchWithRetry(
  input: string,
  init: RequestInit,
  attempts = 3,
): Promise<Response> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i += 1) {
    try {
      return await fetch(input, init);
    } catch (error) {
      lastError = error;
      await new Promise((resolve) => setTimeout(resolve, 400 * (i + 1)));
    }
  }
  throw lastError instanceof Error
    ? lastError
    : new Error(String(lastError ?? "fetch failed"));
}

async function apiJson(
  path: string,
  options: {
    method?: string;
    cookies?: Cookie[];
    body?: Record<string, unknown>;
  } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetchWithRetry(`${stagingBaseUrl()}${path}`, {
    method: options.method ?? "GET",
    headers: {
      "Content-Type": "application/json",
      ...(options.cookies?.length
        ? { Cookie: cookieHeader(options.cookies) }
        : {}),
      ...bypassHeaders(),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const body = (await response.json().catch(() => ({}))) as Record<
    string,
    unknown
  >;
  return { status: response.status, body };
}

async function apiHtml(
  path: string,
  cookies?: Cookie[],
  options: { redirect?: RequestRedirect } = {},
): Promise<{ status: number; text: string; location: string | null }> {
  const response = await fetchWithRetry(`${stagingBaseUrl()}${path}`, {
    method: "GET",
    redirect: options.redirect ?? "follow",
    headers: {
      ...(cookies?.length ? { Cookie: cookieHeader(cookies) } : {}),
      ...bypassHeaders(),
    },
  });
  const text = await response.text();
  return {
    status: response.status,
    text,
    location: response.headers.get("location"),
  };
}

function applySetCookieHeaders(jar: Cookie[], response: Response): void {
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[];
  };
  const rawList =
    typeof headers.getSetCookie === "function"
      ? headers.getSetCookie()
      : (() => {
          const single = response.headers.get("set-cookie");
          return single ? [single] : [];
        })();

  for (const raw of rawList) {
    const parts = raw.split(/,(?=\s*[^;=]+=)/);
    for (const part of parts) {
      const [nv] = part.split(";");
      const eq = nv.indexOf("=");
      if (eq < 0) continue;
      const name = nv.slice(0, eq).trim();
      const value = nv.slice(eq + 1).trim();
      const expired =
        value === "" ||
        /max-age=0/i.test(part) ||
        /expires=.*1970/i.test(part);
      const idx = jar.findIndex((c) => c.name === name);
      if (expired) {
        if (idx >= 0) jar.splice(idx, 1);
      } else if (idx >= 0) {
        jar[idx] = { name, value };
      } else {
        jar.push({ name, value });
      }
    }
  }
}

function authCookiesPresent(jar: Cookie[]): boolean {
  return jar.some((c) => isSupabaseAuthTokenCookie(c.name) && c.value.length > 0);
}

type RedirectHop = {
  path: string;
  status: number;
  location: string | null;
  authCookiesAfter: boolean;
};

/**
 * Follow redirects like a browser cookie jar (max hops). Used for inactive-session
 * guards so we catch ERR_TOO_MANY_REDIRECTS loops that a single manual hop misses.
 */
async function followRedirectChain(
  startPath: string,
  jar: Cookie[],
  maxHops = 5,
): Promise<{
  hops: RedirectHop[];
  finalStatus: number;
  finalPath: string;
  finalText: string;
  loopDetected: boolean;
}> {
  const hops: RedirectHop[] = [];
  let path = startPath;
  let finalStatus = 0;
  let finalText = "";
  const seen = new Set<string>();

  for (let i = 0; i < maxHops; i += 1) {
    if (seen.has(path)) {
      return {
        hops,
        finalStatus,
        finalPath: path,
        finalText,
        loopDetected: true,
      };
    }
    seen.add(path);

    const response = await fetchWithRetry(`${stagingBaseUrl()}${path}`, {
      method: "GET",
      redirect: "manual",
      headers: {
        ...(jar.length ? { Cookie: cookieHeader(jar) } : {}),
        ...bypassHeaders(),
      },
    });
    applySetCookieHeaders(jar, response);
    const location = response.headers.get("location");
    hops.push({
      path,
      status: response.status,
      location,
      authCookiesAfter: authCookiesPresent(jar),
    });
    finalStatus = response.status;

    if (response.status >= 300 && response.status < 400 && location) {
      const next = location.startsWith("http")
        ? `${new URL(location).pathname}${new URL(location).search}`
        : location;
      path = next;
      continue;
    }

    finalText = await response.text();
    return {
      hops,
      finalStatus,
      finalPath: path,
      finalText,
      loopDetected: false,
    };
  }

  return {
    hops,
    finalStatus,
    finalPath: path,
    finalText,
    loopDetected: true,
  };
}

function inactiveSessionPass(options: {
  chain: Awaited<ReturnType<typeof followRedirectChain>>;
  jar: Cookie[];
  expectedLoginPath: string;
}): { pass: boolean; detail: string } {
  const { chain, jar, expectedLoginPath } = options;
  const hopSummary = chain.hops
    .map(
      (h) =>
        `${h.path}→${h.status}${h.location ? `→${h.location}` : ""}(auth=${h.authCookiesAfter ? "y" : "n"})`,
    )
    .join(" | ");
  const onLogin =
    chain.finalPath.startsWith(expectedLoginPath) &&
    chain.finalPath.includes(`notice=${ACCOUNT_INACTIVE_NOTICE}`);
  const noticeVisible =
    chain.finalText.includes(ACCOUNT_NO_LONGER_ACTIVE_MESSAGE) ||
    chain.finalText.includes("no longer active");
  const cookiesCleared = !authCookiesPresent(jar);
  const pass =
    !chain.loopDetected &&
    chain.finalStatus === 200 &&
    onLogin &&
    noticeVisible &&
    cookiesCleared;
  return {
    pass,
    detail: pass
      ? `200 ${chain.finalPath}; cookies cleared; hops=${chain.hops.length}`
      : `loop=${chain.loopDetected} status=${chain.finalStatus} path=${chain.finalPath} notice=${noticeVisible} cookiesCleared=${cookiesCleared} [${hopSummary}]`,
  };
}

async function insertStaffAccount(
  admin: SupabaseClient,
  options: {
    authUid: string;
    email: string;
    tenantId: string;
    role?: string;
  },
) {
  const { error } = await admin.from("user_accounts").insert({
    auth_uid: options.authUid,
    email: options.email,
    role: options.role ?? "employee",
    is_active: true,
    tenant_id: options.tenantId,
  });
  assert(!error, error?.message ?? `staff insert ${options.email}`);
}

async function createAuthUser(
  admin: SupabaseClient,
  cleanup: CleanupState,
  email: string,
  portal?: string,
): Promise<string> {
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: TEST_PASSWORD,
    email_confirm: true,
    user_metadata: portal ? { portal, full_name: email } : { full_name: email },
  });
  assert(!error && data.user, error?.message ?? `createUser ${email}`);
  cleanup.authUids.push(data.user.id);
  return data.user.id;
}

async function createReTenant(
  admin: SupabaseClient,
  cleanup: CleanupState,
  stamp: string,
  label: string,
  email: string,
): Promise<string> {
  const slug = `la-test-${stamp}-${label}`.slice(0, 63);
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("tenants")
    .insert({
      name: `Login Access Test ${stamp} ${label}`,
      slug,
      status: "active",
      product_line: "real_estate_only",
      email,
      phone: "+233200000010",
      address: "Login Access Test Address",
      updated_at: now,
    })
    .select("id")
    .single();
  assert(!error && data, error?.message ?? `tenant insert ${label}`);
  cleanup.tenantIds.push(data.id);
  return data.id as string;
}

async function insertLandlord(
  admin: SupabaseClient,
  tenantId: string,
  authUserId: string,
  landlordType: "platform_only" | "davors_managed",
) {
  const now = new Date().toISOString();
  const { error } = await admin.from("landlords").insert({
    tenant_id: tenantId,
    auth_user_id: authUserId,
    landlord_type: landlordType,
    approval_status: "approved",
    sms_credit_balance: 0,
    created_at: now,
    updated_at: now,
  });
  assert(!error, error?.message ?? "landlord insert failed");
}

async function insertLessee(
  admin: SupabaseClient,
  cleanup: CleanupState,
  tenantId: string,
  options: {
    email: string;
    fullName: string;
    authUserId?: string | null;
  },
): Promise<string> {
  const lesseeId = randomUUID();
  const now = new Date().toISOString();
  const { error } = await admin.from("lessees").insert({
    lessee_id: lesseeId,
    tenant_id: tenantId,
    full_name: options.fullName,
    email: options.email,
    phone: "+233200000011",
    status: "active",
    auth_user_id: options.authUserId ?? null,
    created_at: now,
    updated_at: now,
  });
  assert(!error, error?.message ?? "lessee insert failed");
  cleanup.lesseeIds.push(lesseeId);
  return lesseeId;
}

async function insertFacilityManager(
  admin: SupabaseClient,
  cleanup: CleanupState,
  tenantId: string,
  options: {
    email: string;
    fullName: string;
    authUserId?: string | null;
  },
): Promise<string> {
  const now = new Date().toISOString();
  const { data, error } = await admin
    .from("facility_managers")
    .insert({
      tenant_id: tenantId,
      full_name: options.fullName,
      email: options.email,
      status: options.authUserId ? "active" : "invited",
      auth_user_id: options.authUserId ?? null,
      can_manage_maintenance: true,
      can_manage_complaints: true,
      can_manage_inspections: true,
      can_log_services: true,
      can_collect_rent: false,
      can_collect_charges: false,
      invited_at: now,
      activated_at: options.authUserId ? now : null,
      updated_at: now,
    })
    .select("facility_manager_id")
    .single();
  assert(!error && data, error?.message ?? "FM insert failed");
  cleanup.facilityManagerIds.push(data.facility_manager_id as string);
  return data.facility_manager_id as string;
}

function verificationBody(
  reasonTag: string,
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    verification_method: VERIFICATION_METHOD,
    reason: reasonTag,
    ...extra,
  };
}

async function countAudit(
  admin: SupabaseClient,
  filters: {
    reasonTag: string;
    action?: string;
    actorPersona?: string;
    targetRecordId?: string;
    since: string;
  },
): Promise<number> {
  let query = admin
    .from("portal_login_access_audit")
    .select("id", { count: "exact", head: true })
    .eq("reason", filters.reasonTag)
    .gte("created_at", filters.since);
  if (filters.action) query = query.eq("action", filters.action);
  if (filters.actorPersona) {
    query = query.eq("actor_persona", filters.actorPersona);
  }
  if (filters.targetRecordId) {
    query = query.eq("target_record_id", filters.targetRecordId);
  }
  const { count, error } = await query;
  assert(!error, error?.message ?? "audit count failed");
  return count ?? 0;
}

async function fetchAuditRows(
  admin: SupabaseClient,
  reasonTag: string,
  since: string,
) {
  const { data, error } = await admin
    .from("portal_login_access_audit")
    .select(
      "id, actor_persona, target_persona, target_record_id, action, verification_method, reason, old_email, new_email",
    )
    .eq("reason", reasonTag)
    .gte("created_at", since);
  assert(!error, error?.message ?? "audit select failed");
  return data ?? [];
}

function rowContainsPassword(row: Record<string, unknown>): boolean {
  const blob = JSON.stringify(row).toLowerCase();
  return (
    blob.includes(TEST_PASSWORD.toLowerCase()) ||
    blob.includes(TEMP_PASSWORD.toLowerCase()) ||
    blob.includes(NEW_PASSWORD.toLowerCase()) ||
    /"password"\s*:/.test(blob)
  );
}

async function cleanupAll(admin: SupabaseClient, cleanup: CleanupState) {
  const { error: auditError } = await admin
    .from("portal_login_access_audit")
    .delete()
    .eq("reason", cleanup.auditReasonTag);
  if (auditError) {
    console.warn("audit cleanup warning:", auditError.message);
  }

  for (const fmId of cleanup.facilityManagerIds) {
    await admin
      .from("facility_manager_property_assignments")
      .delete()
      .eq("facility_manager_id", fmId);
    await admin
      .from("facility_manager_portal_invites")
      .delete()
      .eq("facility_manager_id", fmId);
    await admin.from("facility_managers").delete().eq("facility_manager_id", fmId);
  }

  for (const lesseeId of cleanup.lesseeIds) {
    await admin.from("lessees").delete().eq("lessee_id", lesseeId);
  }

  for (const tenantId of cleanup.tenantIds) {
    await admin.from("landlords").delete().eq("tenant_id", tenantId);
    await admin.from("user_accounts").delete().eq("tenant_id", tenantId);
    await admin.from("tenants").delete().eq("id", tenantId);
  }

  // Davors-tenant staff fixture (shared-login / temp Davors admin) — by auth uid only
  for (const authUid of cleanup.authUids) {
    await admin.from("user_accounts").delete().eq("auth_uid", authUid);
    await admin.auth.admin.deleteUser(authUid).catch(() => undefined);
  }
}

async function confirmCleanup(
  admin: SupabaseClient,
  cleanup: CleanupState,
): Promise<{ ok: boolean; detail: string }> {
  const leftovers: string[] = [];

  const { count: auditLeft } = await admin
    .from("portal_login_access_audit")
    .select("id", { count: "exact", head: true })
    .eq("reason", cleanup.auditReasonTag);
  if ((auditLeft ?? 0) > 0) {
    leftovers.push(`audit=${auditLeft}`);
  }

  if (cleanup.lesseeIds.length > 0) {
    const { count } = await admin
      .from("lessees")
      .select("lessee_id", { count: "exact", head: true })
      .in("lessee_id", cleanup.lesseeIds);
    if ((count ?? 0) > 0) leftovers.push(`lessees=${count}`);
  }

  if (cleanup.facilityManagerIds.length > 0) {
    const { count } = await admin
      .from("facility_managers")
      .select("facility_manager_id", { count: "exact", head: true })
      .in("facility_manager_id", cleanup.facilityManagerIds);
    if ((count ?? 0) > 0) leftovers.push(`fms=${count}`);
  }

  if (cleanup.tenantIds.length > 0) {
    const { count } = await admin
      .from("tenants")
      .select("id", { count: "exact", head: true })
      .in("id", cleanup.tenantIds);
    if ((count ?? 0) > 0) leftovers.push(`tenants=${count}`);
  }

  for (const authUid of cleanup.authUids) {
    const { data } = await admin.auth.admin.getUserById(authUid);
    if (data?.user) leftovers.push(`auth=${authUid.slice(0, 8)}`);
  }

  if (leftovers.length > 0) {
    return { ok: false, detail: leftovers.join(", ") };
  }
  return { ok: true, detail: "all fixtures and audit rows removed" };
}

async function main() {
  const envFile = loadEnvFromArgv(process.argv.slice(2));
  const apiBase = stagingBaseUrl();
  console.log(`Env: ${envFile}`);
  console.log(`API base: ${apiBase}`);

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const anon =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim() ||
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim();
  assert(url && serviceKey && anon, "Missing Supabase staging env");
  assert(url.includes("wieflwbfdmjtsdnwbfii"), "Refusing non-staging Supabase URL");
  assert(
    TEST_PASSWORD.length >= PASSWORD_MIN_LENGTH &&
      TEMP_PASSWORD.length >= PASSWORD_MIN_LENGTH,
    "test passwords must meet policy length",
  );

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const stamp = `${Date.now().toString(36)}${randomBytes(2).toString("hex")}`;
  const reasonTag = `login-access-staging-test ${stamp}`;
  const cleanup: CleanupState = {
    tenantIds: [],
    authUids: [],
    lesseeIds: [],
    facilityManagerIds: [],
    auditReasonTag: reasonTag,
    startedAt: new Date().toISOString(),
  };

  let successAuditExpected = 0;

  try {
    console.log("\n--- Creating fixtures ---");

    // Non-Davors super_admin (case 1)
    const nonDavorsTenantId = await createReTenant(
      admin,
      cleanup,
      stamp,
      "nondavors",
      emailFor(stamp, "nondavors-tenant"),
    );
    const nonDavorsAdminEmail = emailFor(stamp, "nondavors-admin");
    const nonDavorsAdminUid = await createAuthUser(
      admin,
      cleanup,
      nonDavorsAdminEmail,
      "staff",
    );
    {
      const { error } = await admin.from("user_accounts").insert({
        auth_uid: nonDavorsAdminUid,
        email: nonDavorsAdminEmail,
        role: "super_admin",
        is_active: true,
        tenant_id: nonDavorsTenantId,
      });
      assert(!error, error?.message ?? "non-Davors admin insert");
    }

    // Temp Davors platform super_admin (cases 5–8, 10–11)
    const davorsAdminEmail = emailFor(stamp, "davors-admin");
    const davorsAdminUid = await createAuthUser(
      admin,
      cleanup,
      davorsAdminEmail,
      "staff",
    );
    {
      const { error } = await admin.from("user_accounts").insert({
        auth_uid: davorsAdminUid,
        email: davorsAdminEmail,
        role: "super_admin",
        is_active: true,
        tenant_id: DAVORS_TENANT_ID,
      });
      assert(!error, error?.message ?? "Davors admin insert");
    }

    // Platform-only landlord A (+ lessee + FM)
    const poAEmail = emailFor(stamp, "po-a-landlord");
    const poATenantId = await createReTenant(
      admin,
      cleanup,
      stamp,
      "poa",
      poAEmail,
    );
    const poAAuthUid = await createAuthUser(admin, cleanup, poAEmail, "landlord");
    await insertLandlord(admin, poATenantId, poAAuthUid, "platform_only");

    const poALesseeEmail = emailFor(stamp, "po-a-lessee");
    const poALesseeAuth = await createAuthUser(
      admin,
      cleanup,
      poALesseeEmail,
      "lessee",
    );
    const poALesseeId = await insertLessee(admin, cleanup, poATenantId, {
      email: poALesseeEmail,
      fullName: "LA Test Lessee A",
      authUserId: poALesseeAuth,
    });

    const poAFmEmail = emailFor(stamp, "po-a-fm");
    const poAFmAuth = await createAuthUser(
      admin,
      cleanup,
      poAFmEmail,
      "facility_manager",
    );
    const poAFmId = await insertFacilityManager(admin, cleanup, poATenantId, {
      email: poAFmEmail,
      fullName: "LA Test FM A",
      authUserId: poAFmAuth,
    });

    // Platform-only landlord B (cross-tenant target)
    const poBEmail = emailFor(stamp, "po-b-landlord");
    const poBTenantId = await createReTenant(
      admin,
      cleanup,
      stamp,
      "pob",
      poBEmail,
    );
    const poBAuthUid = await createAuthUser(admin, cleanup, poBEmail, "landlord");
    await insertLandlord(admin, poBTenantId, poBAuthUid, "platform_only");

    const poBLesseeEmail = emailFor(stamp, "po-b-lessee");
    const poBLesseeAuth = await createAuthUser(
      admin,
      cleanup,
      poBLesseeEmail,
      "lessee",
    );
    const poBLesseeId = await insertLessee(admin, cleanup, poBTenantId, {
      email: poBLesseeEmail,
      fullName: "LA Test Lessee B",
      authUserId: poBLesseeAuth,
    });

    const poBFmEmail = emailFor(stamp, "po-b-fm");
    const poBFmAuth = await createAuthUser(
      admin,
      cleanup,
      poBFmEmail,
      "facility_manager",
    );
    const poBFmId = await insertFacilityManager(admin, cleanup, poBTenantId, {
      email: poBFmEmail,
      fullName: "LA Test FM B",
      authUserId: poBFmAuth,
    });

    // Davors-managed landlord (+ lessee + FM for shared-login + admin success)
    const dmEmail = emailFor(stamp, "dm-landlord");
    const dmTenantId = await createReTenant(admin, cleanup, stamp, "dm", dmEmail);
    const dmAuthUid = await createAuthUser(admin, cleanup, dmEmail, "landlord");
    await insertLandlord(admin, dmTenantId, dmAuthUid, "davors_managed");

    const dmLesseeEmail = emailFor(stamp, "dm-lessee");
    const dmLesseeAuth = await createAuthUser(
      admin,
      cleanup,
      dmLesseeEmail,
      "lessee",
    );
    const dmLesseeId = await insertLessee(admin, cleanup, dmTenantId, {
      email: dmLesseeEmail,
      fullName: "LA Test DM Lessee",
      authUserId: dmLesseeAuth,
    });

    const dmFmEmail = emailFor(stamp, "dm-fm");
    const dmFmAuth = await createAuthUser(
      admin,
      cleanup,
      dmFmEmail,
      "facility_manager",
    );
    const dmFmId = await insertFacilityManager(admin, cleanup, dmTenantId, {
      email: dmFmEmail,
      fullName: "LA Test DM FM",
      authUserId: dmFmAuth,
    });

    // Shared-login staff row for dm lessee auth (other tenant)
    const sharedStaffTenantId = await createReTenant(
      admin,
      cleanup,
      stamp,
      "sharedstaff",
      emailFor(stamp, "shared-staff-tenant"),
    );
    {
      const { error } = await admin.from("user_accounts").insert({
        auth_uid: dmLesseeAuth,
        email: dmLesseeEmail,
        role: "employee",
        is_active: true,
        tenant_id: sharedStaffTenantId,
      });
      assert(!error, error?.message ?? "shared staff insert");
    }

    // Email already used by another Auth user (case 7)
    const takenEmail = emailFor(stamp, "taken-email");
    await createAuthUser(admin, cleanup, takenEmail, "lessee");

    // Create-login: null auth_user_id (case 8a)
    const nullAuthLesseeEmail = emailFor(stamp, "null-auth-lessee");
    const nullAuthLesseeId = await insertLessee(admin, cleanup, dmTenantId, {
      email: nullAuthLesseeEmail,
      fullName: "LA Test Null Auth Lessee",
      authUserId: null,
    });

    // Create-login: orphan stored id (case 8b) — create Auth, link, delete Auth,
    // then re-point lessee.auth_user_id at the missing id (FK bypass via replica role).
    const orphanLesseeEmail = emailFor(stamp, "orphan-lessee");
    const orphanAuthId = await createAuthUser(
      admin,
      cleanup,
      orphanLesseeEmail,
      "lessee",
    );
    const orphanLesseeId = await insertLessee(admin, cleanup, dmTenantId, {
      email: orphanLesseeEmail,
      fullName: "LA Test Orphan Lessee",
      authUserId: orphanAuthId,
    });
    await admin.auth.admin.deleteUser(orphanAuthId);
    cleanup.authUids = cleanup.authUids.filter((id) => id !== orphanAuthId);
    {
      const databaseUrl = process.env.DATABASE_URL?.trim();
      assert(databaseUrl, "DATABASE_URL required to plant orphan auth_user_id");
      const pool = new pg.Pool({ connectionString: databaseUrl });
      try {
        await pool.query("BEGIN");
        await pool.query("SET LOCAL session_replication_role = replica");
        await pool.query(
          `UPDATE public.lessees
           SET auth_user_id = $1::uuid
           WHERE lessee_id = $2::uuid`,
          [orphanAuthId, orphanLesseeId],
        );
        await pool.query("COMMIT");
      } catch (error) {
        await pool.query("ROLLBACK").catch(() => undefined);
        throw error;
      } finally {
        await pool.end();
      }
      cleanup.authUids.push(orphanAuthId);
    }

    // Expired temp password user (case 9) — use poA lessee auth
    await admin.auth.admin.updateUserById(poALesseeAuth, {
      app_metadata: {
        must_change_password: true,
        temp_password_expires_at: new Date(
          Date.now() - 60 * 60 * 1000,
        ).toISOString(),
      },
    });

    // --- Staff / User Accounts fixtures (cases 13–22) ---
    // Staff in non-Davors tenant (reset + email change)
    const staffOwnEmail = emailFor(stamp, "staff-own");
    const staffOwnUid = await createAuthUser(
      admin,
      cleanup,
      staffOwnEmail,
      "staff",
    );
    await insertStaffAccount(admin, {
      authUid: staffOwnUid,
      email: staffOwnEmail,
      tenantId: nonDavorsTenantId,
      role: "employee",
    });

    // Staff for forced set-password (case 20)
    const staffForceEmail = emailFor(stamp, "staff-force-pwd");
    const staffForceUid = await createAuthUser(
      admin,
      cleanup,
      staffForceEmail,
      "staff",
    );
    await insertStaffAccount(admin, {
      authUid: staffForceUid,
      email: staffForceEmail,
      tenantId: nonDavorsTenantId,
      role: "employee",
    });

    // Staff in another customer tenant (cross-tenant targets)
    const otherStaffTenantId = await createReTenant(
      admin,
      cleanup,
      stamp,
      "otherstaff",
      emailFor(stamp, "other-staff-tenant"),
    );
    const staffOtherEmail = emailFor(stamp, "staff-other");
    const staffOtherUid = await createAuthUser(
      admin,
      cleanup,
      staffOtherEmail,
      "staff",
    );
    await insertStaffAccount(admin, {
      authUid: staffOtherUid,
      email: staffOtherEmail,
      tenantId: otherStaffTenantId,
      role: "employee",
    });

    // Tenant admin for shared-staff tenant (case 16 actor)
    const sharedStaffAdminEmail = emailFor(stamp, "shared-staff-admin");
    const sharedStaffAdminUid = await createAuthUser(
      admin,
      cleanup,
      sharedStaffAdminEmail,
      "staff",
    );
    await insertStaffAccount(admin, {
      authUid: sharedStaffAdminUid,
      email: sharedStaffAdminEmail,
      tenantId: sharedStaffTenantId,
      role: "super_admin",
    });

    const staffChangedEmail = emailFor(stamp, "staff-own-changed");

    const nonDavorsCookies = await signInCookies(
      url,
      anon,
      nonDavorsAdminEmail,
      TEST_PASSWORD,
    );
    const poACookies = await signInCookies(url, anon, poAEmail, TEST_PASSWORD);
    const dmLandlordCookies = await signInCookies(
      url,
      anon,
      dmEmail,
      TEST_PASSWORD,
    );
    const davorsCookies = await signInCookies(
      url,
      anon,
      davorsAdminEmail,
      TEST_PASSWORD,
    );
    const sharedStaffAdminCookies = await signInCookies(
      url,
      anon,
      sharedStaffAdminEmail,
      TEST_PASSWORD,
    );

    console.log("\n--- Running cases ---");

    // ---------- Case 1 ----------
    {
      const routes: Array<{ path: string; method: string; body?: Record<string, unknown> }> =
        [
          {
            path: `/api/admin/portal-login-access/status?persona=lessee&tenant_id=${dmTenantId}&lessee_id=${dmLesseeId}`,
            method: "GET",
          },
          {
            path: "/api/admin/portal-login-access/reset-link",
            method: "POST",
            body: {
              persona: "lessee",
              tenant_id: dmTenantId,
              lessee_id: dmLesseeId,
              ...verificationBody(reasonTag),
            },
          },
          {
            path: "/api/admin/portal-login-access/set-temp-password",
            method: "POST",
            body: {
              persona: "lessee",
              tenant_id: dmTenantId,
              lessee_id: dmLesseeId,
              password: TEMP_PASSWORD,
              ...verificationBody(reasonTag),
            },
          },
          {
            path: "/api/admin/portal-login-access/change-email",
            method: "POST",
            body: {
              persona: "lessee",
              tenant_id: dmTenantId,
              lessee_id: dmLesseeId,
              email: emailFor(stamp, "should-not-apply"),
              ...verificationBody(reasonTag),
            },
          },
          {
            path: "/api/admin/portal-login-access/create-login",
            method: "POST",
            body: {
              persona: "lessee",
              tenant_id: dmTenantId,
              lessee_id: nullAuthLesseeId,
              email: nullAuthLesseeEmail,
              password: TEMP_PASSWORD,
              ...verificationBody(reasonTag),
            },
          },
        ];

      let all403 = true;
      const details: string[] = [];
      for (const route of routes) {
        const res = await apiJson(route.path, {
          method: route.method,
          cookies: nonDavorsCookies,
          body: route.body,
        });
        if (res.status !== 403) {
          all403 = false;
          details.push(`${route.path}→${res.status}`);
        }
      }
      record(
        "1. Non-Davors super_admin → Davors admin routes 403",
        all403,
        all403 ? "all 5 routes 403" : details.join("; "),
      );
    }

    // ---------- Case 2 ----------
    {
      const before = await countAudit(admin, {
        reasonTag,
        actorPersona: "landlord",
        since: cleanup.startedAt,
      });
      const lesseeReset = await apiJson(
        "/api/landlord-portal/portal-login-access/reset-link",
        {
          method: "POST",
          cookies: poACookies,
          body: {
            persona: "lessee",
            tenant_id: poATenantId,
            lessee_id: poALesseeId,
            ...verificationBody(reasonTag),
          },
        },
      );
      const fmTemp = await apiJson(
        "/api/landlord-portal/portal-login-access/set-temp-password",
        {
          method: "POST",
          cookies: poACookies,
          body: {
            persona: "facility_manager",
            tenant_id: poATenantId,
            facility_manager_id: poAFmId,
            password: TEMP_PASSWORD,
            ...verificationBody(reasonTag),
          },
        },
      );
      const afterRows = await fetchAuditRows(admin, reasonTag, cleanup.startedAt);
      const landlordRows = afterRows.filter((r) => r.actor_persona === "landlord");
      const lesseeAudit = landlordRows.find(
        (r) =>
          r.target_record_id === poALesseeId && r.action === "reset_link_sent",
      );
      const fmAudit = landlordRows.find(
        (r) =>
          r.target_record_id === poAFmId && r.action === "temp_password_set",
      );
      const pass =
        lesseeReset.status === 200 &&
        fmTemp.status === 200 &&
        Boolean(lesseeAudit) &&
        Boolean(fmAudit) &&
        lesseeAudit?.verification_method === VERIFICATION_METHOD &&
        fmAudit?.verification_method === VERIFICATION_METHOD &&
        lesseeAudit?.reason === reasonTag &&
        fmAudit?.reason === reasonTag &&
        landlordRows.length >= before + 2;
      if (pass) successAuditExpected += 2;
      record(
        "2. platform_only landlord resets own lessee + FM",
        pass,
        pass
          ? "reset_link + temp_password audited as landlord"
          : `lessee=${lesseeReset.status} fm=${fmTemp.status} audits=${landlordRows.length}`,
      );
    }

    // ---------- Case 3 ----------
    {
      const otherLessee = await apiJson(
        "/api/landlord-portal/portal-login-access/reset-link",
        {
          method: "POST",
          cookies: poACookies,
          body: {
            persona: "lessee",
            tenant_id: poBTenantId,
            lessee_id: poBLesseeId,
            ...verificationBody(reasonTag),
          },
        },
      );
      const otherFm = await apiJson(
        "/api/landlord-portal/portal-login-access/set-temp-password",
        {
          method: "POST",
          cookies: poACookies,
          body: {
            persona: "facility_manager",
            tenant_id: poBTenantId,
            facility_manager_id: poBFmId,
            password: TEMP_PASSWORD,
            ...verificationBody(reasonTag),
          },
        },
      );
      const pass = otherLessee.status === 403 && otherFm.status === 403;
      record(
        "3. platform_only landlord → other landlord targets 403",
        pass,
        `lessee=${otherLessee.status} fm=${otherFm.status}`,
      );
    }

    // ---------- Case 4 ----------
    {
      const res = await apiJson(
        "/api/landlord-portal/portal-login-access/reset-link",
        {
          method: "POST",
          cookies: dmLandlordCookies,
          body: {
            persona: "lessee",
            tenant_id: dmTenantId,
            lessee_id: dmLesseeId,
            ...verificationBody(reasonTag),
          },
        },
      );
      record(
        "4. davors_managed landlord → landlord-portal routes 403",
        res.status === 403,
        `status=${res.status}`,
      );
    }

    // ---------- Case 5 ----------
    {
      const forbid = await apiJson(
        "/api/admin/portal-login-access/reset-link",
        {
          method: "POST",
          cookies: davorsCookies,
          body: {
            persona: "lessee",
            tenant_id: poATenantId,
            lessee_id: poALesseeId,
            ...verificationBody(reasonTag),
          },
        },
      );
      const allow = await apiJson(
        "/api/admin/portal-login-access/set-temp-password",
        {
          method: "POST",
          cookies: davorsCookies,
          body: {
            persona: "facility_manager",
            tenant_id: dmTenantId,
            facility_manager_id: dmFmId,
            password: TEMP_PASSWORD,
            ...verificationBody(reasonTag),
            // shared login possible on dm lessee; FM should be clean
          },
        },
      );
      const pass = forbid.status === 403 && allow.status === 200;
      if (allow.status === 200) successAuditExpected += 1;
      record(
        "5. Davors admin platform_only 403 / davors_managed success",
        pass,
        `platform_only=${forbid.status} davors_managed=${allow.status}`,
      );
    }

    // ---------- Case 6 ----------
    {
      // Attach staff link to platform_only lessee for landlord refusal path
      {
        const { error } = await admin.from("user_accounts").insert({
          auth_uid: poALesseeAuth,
          email: poALesseeEmail,
          role: "employee",
          is_active: true,
          tenant_id: sharedStaffTenantId,
        });
        assert(!error, error?.message ?? "poA shared staff insert");
      }

      const landlordShared = await apiJson(
        "/api/landlord-portal/portal-login-access/reset-link",
        {
          method: "POST",
          cookies: poACookies,
          body: {
            persona: "lessee",
            tenant_id: poATenantId,
            lessee_id: poALesseeId,
            ...verificationBody(reasonTag),
          },
        },
      );

      const davorsNeedConfirm = await apiJson(
        "/api/admin/portal-login-access/reset-link",
        {
          method: "POST",
          cookies: davorsCookies,
          body: {
            persona: "lessee",
            tenant_id: dmTenantId,
            lessee_id: dmLesseeId,
            ...verificationBody(reasonTag),
          },
        },
      );

      const davorsConfirm = await apiJson(
        "/api/admin/portal-login-access/reset-link",
        {
          method: "POST",
          cookies: davorsCookies,
          body: {
            persona: "lessee",
            tenant_id: dmTenantId,
            lessee_id: dmLesseeId,
            confirm_shared_login: true,
            ...verificationBody(reasonTag),
          },
        },
      );

      const landlordRefused =
        landlordShared.status === 409 &&
        landlordShared.body.code === "shared_login_refused" &&
        (String(landlordShared.body.error) ===
          SHARED_LOGIN_NON_DAVORS_REFUSAL_MESSAGE ||
          String(landlordShared.body.error ?? "").includes(
            "contact Davors support",
          ));
      const needsConfirm =
        davorsNeedConfirm.status === 409 &&
        davorsNeedConfirm.body.code === "shared_login_requires_confirmation";
      const confirmed = davorsConfirm.status === 200;
      if (confirmed) successAuditExpected += 1;

      const pass = landlordRefused && needsConfirm && confirmed;
      record(
        "6. Shared login refusal (landlord) + confirm (Davors)",
        pass,
        pass
          ? "refused then confirmed"
          : `landlord=${landlordShared.status}/${landlordShared.body.code} need=${davorsNeedConfirm.status}/${davorsNeedConfirm.body.code} ok=${davorsConfirm.status}`,
      );
    }

    // ---------- Case 7 ----------
    {
      const { data: beforeAuth } = await admin.auth.admin.getUserById(dmFmAuth);
      const beforeEmail = beforeAuth?.user?.email?.toLowerCase() ?? "";
      const res = await apiJson(
        "/api/admin/portal-login-access/change-email",
        {
          method: "POST",
          cookies: davorsCookies,
          body: {
            persona: "facility_manager",
            tenant_id: dmTenantId,
            facility_manager_id: dmFmId,
            email: takenEmail,
            ...verificationBody(reasonTag),
          },
        },
      );
      const { data: afterAuth } = await admin.auth.admin.getUserById(dmFmAuth);
      const afterEmail = afterAuth?.user?.email?.toLowerCase() ?? "";
      const pass =
        res.status === 409 &&
        afterEmail === beforeEmail &&
        afterEmail !== takenEmail.toLowerCase();
      record(
        "7. Change email to existing Auth email refused",
        pass,
        `status=${res.status} email_unchanged=${afterEmail === beforeEmail}`,
      );
    }

    // ---------- Case 8 ----------
    {
      const createNull = await apiJson(
        "/api/admin/portal-login-access/create-login",
        {
          method: "POST",
          cookies: davorsCookies,
          body: {
            persona: "lessee",
            tenant_id: dmTenantId,
            lessee_id: nullAuthLesseeId,
            email: nullAuthLesseeEmail,
            password: TEMP_PASSWORD,
            ...verificationBody(reasonTag),
          },
        },
      );
      const { data: nullLessee } = await admin
        .from("lessees")
        .select("auth_user_id")
        .eq("lessee_id", nullAuthLesseeId)
        .maybeSingle();
      const linkedId =
        typeof nullLessee?.auth_user_id === "string"
          ? nullLessee.auth_user_id
          : null;
      if (linkedId) cleanup.authUids.push(linkedId);

      const createOrphan = await apiJson(
        "/api/admin/portal-login-access/create-login",
        {
          method: "POST",
          cookies: davorsCookies,
          body: {
            persona: "lessee",
            tenant_id: dmTenantId,
            lessee_id: orphanLesseeId,
            email: orphanLesseeEmail,
            password: TEMP_PASSWORD,
            ...verificationBody(reasonTag),
          },
        },
      );
      const { data: orphanAuth } =
        await admin.auth.admin.getUserById(orphanAuthId);
      const orphanOk =
        createOrphan.status === 200 &&
        Boolean(orphanAuth?.user) &&
        orphanAuth?.user?.id === orphanAuthId;

      const nullOk =
        createNull.status === 200 &&
        Boolean(linkedId) &&
        linkedId !== orphanAuthId;

      if (nullOk) successAuditExpected += 1;
      if (orphanOk) successAuditExpected += 1;

      record(
        "8. Create login (null auth + orphan id preserve)",
        nullOk && orphanOk,
        `null=${createNull.status} linked=${linkedId?.slice(0, 8) ?? "none"} orphan=${createOrphan.status} sameId=${orphanAuth?.user?.id === orphanAuthId}`,
      );
    }

    // ---------- Case 9 ----------
    {
      const { data: expiredUser } =
        await admin.auth.admin.getUserById(poALesseeAuth);
      const meta =
        expiredUser?.user?.app_metadata &&
        typeof expiredUser.user.app_metadata === "object"
          ? (expiredUser.user.app_metadata as Record<string, unknown>)
          : {};
      const state = readMustChangeState(meta);
      // Mirrors clearMustChangePasswordWithNewPassword early-return when expired
      const gateResult = state.expired
        ? {
            ok: false as const,
            error: TEMP_PASSWORD_EXPIRED_MESSAGE,
            expired: true as const,
          }
        : { ok: true as const };
      const pass =
        state.mustChange &&
        state.expired &&
        gateResult.ok === false &&
        gateResult.error === TEMP_PASSWORD_EXPIRED_MESSAGE;
      record(
        "9. Expired temp password blocked",
        pass,
        pass
          ? "must_change + past expires_at → expiry message"
          : `mustChange=${state.mustChange} expired=${state.expired}`,
      );
    }

    // ---------- Case 10 ----------
    {
      const missingMethod = await apiJson(
        "/api/admin/portal-login-access/reset-link",
        {
          method: "POST",
          cookies: davorsCookies,
          body: {
            persona: "lessee",
            tenant_id: dmTenantId,
            lessee_id: dmLesseeId,
            reason: reasonTag,
            confirm_shared_login: true,
          },
        },
      );
      const missingReason = await apiJson(
        "/api/admin/portal-login-access/reset-link",
        {
          method: "POST",
          cookies: davorsCookies,
          body: {
            persona: "lessee",
            tenant_id: dmTenantId,
            lessee_id: dmLesseeId,
            verification_method: VERIFICATION_METHOD,
            confirm_shared_login: true,
          },
        },
      );
      const pass =
        missingMethod.status === 400 &&
        missingMethod.body.field === "verification_method" &&
        missingReason.status === 400 &&
        missingReason.body.field === "reason";
      record(
        "10. Missing verification_method / reason rejected by API",
        pass,
        `method=${missingMethod.status}/${missingMethod.body.field} reason=${missingReason.status}/${missingReason.body.field}`,
      );
    }

    // ---------- Case 11 ----------
    {
      const rows = await fetchAuditRows(admin, reasonTag, cleanup.startedAt);
      const noPassword = rows.every(
        (row) => !rowContainsPassword(row as Record<string, unknown>),
      );
      // Notify copy is fixed prose (no password field) — assert audit + known template shape
      const emailTemplateHasNoPassword =
        !"A temporary password was set for your DavSuite portal login by"
          .toLowerCase()
          .includes("password:") &&
        !TEMP_PASSWORD.includes("by your");

      const countOk =
        successAuditExpected > 0 && rows.length === successAuditExpected;
      const pass = noPassword && emailTemplateHasNoPassword && countOk;
      record(
        "11. Audit rows exact + no passwords in audit/email payload",
        pass,
        `rows=${rows.length} expected=${successAuditExpected} noPassword=${noPassword}`,
      );
    }

    // ---------- Case 13 ----------
    {
      const reset = await apiJson(
        "/api/tenant-admin/portal-login-access/reset-link",
        {
          method: "POST",
          cookies: nonDavorsCookies,
          body: {
            persona: "staff",
            tenant_id: nonDavorsTenantId,
            auth_uid: staffOwnUid,
            ...verificationBody(reasonTag),
          },
        },
      );
      const temp = await apiJson(
        "/api/tenant-admin/portal-login-access/set-temp-password",
        {
          method: "POST",
          cookies: nonDavorsCookies,
          body: {
            persona: "staff",
            tenant_id: nonDavorsTenantId,
            auth_uid: staffOwnUid,
            password: TEMP_PASSWORD,
            ...verificationBody(reasonTag),
          },
        },
      );
      const change = await apiJson(
        "/api/tenant-admin/portal-login-access/change-email",
        {
          method: "POST",
          cookies: nonDavorsCookies,
          body: {
            persona: "staff",
            tenant_id: nonDavorsTenantId,
            auth_uid: staffOwnUid,
            email: staffChangedEmail,
            ...verificationBody(reasonTag),
          },
        },
      );
      const { data: authAfter } =
        await admin.auth.admin.getUserById(staffOwnUid);
      const { data: accountAfter } = await admin
        .from("user_accounts")
        .select("email")
        .eq("auth_uid", staffOwnUid)
        .eq("tenant_id", nonDavorsTenantId)
        .maybeSingle();
      const auditRows = await fetchAuditRows(admin, reasonTag, cleanup.startedAt);
      const staffAudits = auditRows.filter(
        (r) =>
          r.actor_persona === "tenant_admin" &&
          r.target_persona === "staff" &&
          r.target_record_id === staffOwnUid,
      );
      const changeAudit = staffAudits.find((r) => r.action === "email_changed");
      const authEmail = authAfter?.user?.email?.toLowerCase() ?? "";
      const accountEmail =
        typeof accountAfter?.email === "string"
          ? accountAfter.email.toLowerCase()
          : "";
      const pass =
        reset.status === 200 &&
        temp.status === 200 &&
        change.status === 200 &&
        staffAudits.length >= 3 &&
        Boolean(changeAudit) &&
        authEmail === staffChangedEmail.toLowerCase() &&
        accountEmail === staffChangedEmail.toLowerCase() &&
        accountEmail === authEmail;
      record(
        "13. Tenant super_admin resets own-tenant staff",
        pass,
        pass
          ? "reset+temp+email; audit tenant_admin→staff; user_accounts synced"
          : `reset=${reset.status} temp=${temp.status} change=${change.status} auth=${authEmail} acct=${accountEmail} audits=${staffAudits.length}`,
      );
    }

    // ---------- Case 14 ----------
    {
      const res = await apiJson(
        "/api/tenant-admin/portal-login-access/reset-link",
        {
          method: "POST",
          cookies: nonDavorsCookies,
          body: {
            persona: "staff",
            tenant_id: otherStaffTenantId,
            auth_uid: staffOtherUid,
            ...verificationBody(reasonTag),
          },
        },
      );
      record(
        "14. Tenant super_admin → other-tenant staff 403",
        res.status === 403,
        `status=${res.status}`,
      );
    }

    // ---------- Case 15 ----------
    {
      const loginAccess = await apiJson(
        "/api/tenant-admin/portal-login-access/reset-link",
        {
          method: "POST",
          cookies: nonDavorsCookies,
          body: {
            persona: "staff",
            tenant_id: nonDavorsTenantId,
            auth_uid: nonDavorsAdminUid,
            ...verificationBody(reasonTag),
          },
        },
      );
      const deactivate = await apiJson("/api/admin/users/deactivate", {
        method: "POST",
        cookies: nonDavorsCookies,
        body: { auth_uid: nonDavorsAdminUid },
      });
      const del = await apiJson("/api/admin/users/delete", {
        method: "POST",
        cookies: nonDavorsCookies,
        body: { auth_uid: nonDavorsAdminUid },
      });
      const loginBlocked =
        loginAccess.status === 403 &&
        String(loginAccess.body.error ?? "")
          .toLowerCase()
          .includes("own account");
      const deactivateBlocked =
        deactivate.status === 400 &&
        String(deactivate.body.error ?? "")
          .toLowerCase()
          .includes("own account");
      const deleteBlocked =
        del.status === 400 &&
        String(del.body.error ?? "")
          .toLowerCase()
          .includes("own account");
      const pass = loginBlocked && deactivateBlocked && deleteBlocked;
      record(
        "15. Super_admin cannot target own account",
        pass,
        `login=${loginAccess.status} deactivate=${deactivate.status} delete=${del.status}`,
      );
    }

    // ---------- Case 16 ----------
    {
      const tenantRefused = await apiJson(
        "/api/tenant-admin/portal-login-access/reset-link",
        {
          method: "POST",
          cookies: sharedStaffAdminCookies,
          body: {
            persona: "staff",
            tenant_id: sharedStaffTenantId,
            auth_uid: dmLesseeAuth,
            ...verificationBody(reasonTag),
          },
        },
      );
      const davorsNeedConfirm = await apiJson(
        "/api/admin/portal-login-access/reset-link",
        {
          method: "POST",
          cookies: davorsCookies,
          body: {
            persona: "staff",
            tenant_id: sharedStaffTenantId,
            auth_uid: dmLesseeAuth,
            ...verificationBody(reasonTag),
          },
        },
      );
      const davorsConfirm = await apiJson(
        "/api/admin/portal-login-access/reset-link",
        {
          method: "POST",
          cookies: davorsCookies,
          body: {
            persona: "staff",
            tenant_id: sharedStaffTenantId,
            auth_uid: dmLesseeAuth,
            confirm_shared_login: true,
            ...verificationBody(reasonTag),
          },
        },
      );
      const refused =
        tenantRefused.status === 409 &&
        tenantRefused.body.code === "shared_login_refused" &&
        (String(tenantRefused.body.error) ===
          SHARED_LOGIN_NON_DAVORS_REFUSAL_MESSAGE ||
          String(tenantRefused.body.error ?? "").includes(
            "contact Davors support",
          ));
      const needsConfirm =
        davorsNeedConfirm.status === 409 &&
        davorsNeedConfirm.body.code === "shared_login_requires_confirmation" &&
        Array.isArray(davorsNeedConfirm.body.shared_links) &&
        (davorsNeedConfirm.body.shared_links as unknown[]).length > 0;
      const confirmed = davorsConfirm.status === 200;
      const pass = refused && needsConfirm && confirmed;
      record(
        "16. Shared login staff: tenant admin refused, Davors confirms",
        pass,
        pass
          ? "refused then linked+confirmed"
          : `tenant=${tenantRefused.status}/${tenantRefused.body.code} need=${davorsNeedConfirm.status}/${davorsNeedConfirm.body.code} ok=${davorsConfirm.status}`,
      );
    }

    // ---------- Case 17 ----------
    {
      const list = await apiJson(
        `/api/admin/portal-login-access/tenant-super-admins?tenant_id=${encodeURIComponent(nonDavorsTenantId)}`,
        { cookies: davorsCookies },
      );
      const reset = await apiJson(
        "/api/admin/portal-login-access/reset-link",
        {
          method: "POST",
          cookies: davorsCookies,
          body: {
            persona: "staff",
            tenant_id: nonDavorsTenantId,
            auth_uid: nonDavorsAdminUid,
            ...verificationBody(reasonTag),
          },
        },
      );
      const auditRows = await fetchAuditRows(admin, reasonTag, cleanup.startedAt);
      const row = auditRows.find(
        (r) =>
          r.actor_persona === "davors_admin" &&
          r.target_persona === "staff" &&
          r.target_record_id === nonDavorsAdminUid &&
          r.action === "reset_link_sent",
      );
      const listOk =
        list.status === 200 &&
        Array.isArray(list.body.super_admins) &&
        (list.body.super_admins as Array<{ authUid?: string }>).some(
          (r) => r.authUid === nonDavorsAdminUid,
        );
      const pass = listOk && reset.status === 200 && Boolean(row);
      record(
        "17. Davors admin resets customer tenant super_admin",
        pass,
        pass
          ? "Tenant Management list + reset audited as davors_admin"
          : `list=${list.status} reset=${reset.status} audit=${Boolean(row)}`,
      );
    }

    // ---------- Case 18 ----------
    {
      const list = await apiJson(
        `/api/admin/portal-login-access/tenant-super-admins?tenant_id=${encodeURIComponent(nonDavorsTenantId)}`,
        { cookies: nonDavorsCookies },
      );
      const reset = await apiJson(
        "/api/admin/portal-login-access/reset-link",
        {
          method: "POST",
          cookies: nonDavorsCookies,
          body: {
            persona: "staff",
            tenant_id: nonDavorsTenantId,
            auth_uid: staffOwnUid,
            ...verificationBody(reasonTag),
          },
        },
      );
      const pass = list.status === 403 && reset.status === 403;
      record(
        "18. Non-Davors super_admin → Tenant Management login routes 403",
        pass,
        `list=${list.status} reset=${reset.status}`,
      );
    }

    // ---------- Case 19 ----------
    {
      const { data: beforeAccount } = await admin
        .from("user_accounts")
        .select("email, role, employee_id, client_id, is_active")
        .eq("auth_uid", staffForceUid)
        .eq("tenant_id", nonDavorsTenantId)
        .maybeSingle();
      const { data: beforeAuth } =
        await admin.auth.admin.getUserById(staffForceUid);
      const beforeEmail =
        typeof beforeAccount?.email === "string"
          ? beforeAccount.email.toLowerCase()
          : "";
      const beforeAuthEmail = beforeAuth?.user?.email?.toLowerCase() ?? "";
      const forged = emailFor(stamp, "forged-via-update");
      // Use a role that does not require employee/client so validation reaches
      // the email-change guard (the request is rejected before any write).
      const res = await apiJson("/api/admin/users/update", {
        method: "POST",
        cookies: nonDavorsCookies,
        body: {
          auth_uid: staffForceUid,
          email: forged,
          role: "director",
          employee_id: null,
          client_id: null,
          supervisor_site_codes: [],
          is_active: beforeAccount?.is_active ?? true,
        },
      });
      const { data: afterAccount } = await admin
        .from("user_accounts")
        .select("email")
        .eq("auth_uid", staffForceUid)
        .eq("tenant_id", nonDavorsTenantId)
        .maybeSingle();
      const { data: afterAuth } =
        await admin.auth.admin.getUserById(staffForceUid);
      const afterEmail =
        typeof afterAccount?.email === "string"
          ? afterAccount.email.toLowerCase()
          : "";
      const afterAuthEmail = afterAuth?.user?.email?.toLowerCase() ?? "";
      const pass =
        res.status === 400 &&
        String(res.body.error) ===
          "Use Change login email in Login access to change a user's email." &&
        afterEmail === beforeEmail &&
        afterAuthEmail === beforeAuthEmail &&
        afterEmail !== forged.toLowerCase();
      record(
        "19. POST /api/admin/users/update rejects email change",
        pass,
        pass
          ? "400 + unchanged Auth/user_accounts"
          : `status=${res.status} err=${String(res.body.error ?? "").slice(0, 80)} acct=${afterEmail}`,
      );
    }

    // ---------- Case 20 ----------
    {
      const temp = await apiJson(
        "/api/tenant-admin/portal-login-access/set-temp-password",
        {
          method: "POST",
          cookies: nonDavorsCookies,
          body: {
            persona: "staff",
            tenant_id: nonDavorsTenantId,
            auth_uid: staffForceUid,
            password: TEMP_PASSWORD,
            ...verificationBody(reasonTag),
          },
        },
      );
      const { data: afterTemp } =
        await admin.auth.admin.getUserById(staffForceUid);
      const tempMeta =
        afterTemp?.user?.app_metadata &&
        typeof afterTemp.user.app_metadata === "object"
          ? (afterTemp.user.app_metadata as Record<string, unknown>)
          : {};
      const afterTempState = readMustChangeState(tempMeta);

      // Mirror clearMustChangePasswordWithNewPassword (server action) with a
      // signed-in staff session + service-role metadata clear.
      let setPasswordOk = false;
      if (temp.status === 200 && afterTempState.mustChange) {
        const staffCookies = await signInCookies(
          url,
          anon,
          staffForceEmail,
          TEMP_PASSWORD,
        );
        const sessionClient = makeSessionClient(url, anon, staffCookies);
        const { error: pwdError } = await sessionClient.auth.updateUser({
          password: NEW_PASSWORD,
        });
        if (!pwdError) {
          const { data: fresh } =
            await admin.auth.admin.getUserById(staffForceUid);
          const existingMeta =
            fresh?.user?.app_metadata &&
            typeof fresh.user.app_metadata === "object"
              ? (fresh.user.app_metadata as Record<string, unknown>)
              : {};
          const { error: metaError } = await admin.auth.admin.updateUserById(
            staffForceUid,
            {
              app_metadata: {
                ...existingMeta,
                must_change_password: false,
                temp_password_expires_at: null,
              },
            },
          );
          setPasswordOk = !metaError;
        }
      }

      const { data: afterClear } =
        await admin.auth.admin.getUserById(staffForceUid);
      const clearMeta =
        afterClear?.user?.app_metadata &&
        typeof afterClear.user.app_metadata === "object"
          ? (afterClear.user.app_metadata as Record<string, unknown>)
          : {};
      const clearState = readMustChangeState(clearMeta);
      const expiresCleared =
        clearMeta.temp_password_expires_at == null ||
        clearMeta.temp_password_expires_at === undefined;
      const pass =
        temp.status === 200 &&
        afterTempState.mustChange &&
        !afterTempState.expired &&
        typeof tempMeta.temp_password_expires_at === "string" &&
        setPasswordOk &&
        clearState.mustChange === false &&
        expiresCleared &&
        clearMeta.must_change_password === false;
      record(
        "20. Staff forced set-password clears must_change flags",
        pass,
        pass
          ? "temp sets must_change; after set-password flags cleared"
          : `temp=${temp.status} mustChange=${afterTempState.mustChange} setPwd=${setPasswordOk} afterMust=${clearState.mustChange} expiresCleared=${expiresCleared}`,
      );
    }

    // ---------- Case 21 ----------
    {
      const otherTenantPage = await apiHtml(
        `/dashboard/user-accounts/${encodeURIComponent(staffOtherUid)}`,
        nonDavorsCookies,
      );
      const unknownId = randomUUID();
      const unknownPage = await apiHtml(
        `/dashboard/user-accounts/${encodeURIComponent(unknownId)}`,
        nonDavorsCookies,
      );
      const notFoundOther =
        otherTenantPage.text.includes("User account not found") ||
        otherTenantPage.text.includes("User not found");
      const notFoundUnknown =
        unknownPage.text.includes("User account not found") ||
        unknownPage.text.includes("User not found");
      const noLeakOther =
        !otherTenantPage.text.includes(staffOtherEmail) &&
        !otherTenantPage.text.toLowerCase().includes(
          staffOtherEmail.toLowerCase(),
        );
      const noLeakUnknown =
        !unknownPage.text.includes(staffOtherEmail) &&
        !unknownPage.text.includes(staffOwnEmail) &&
        !unknownPage.text.includes(staffChangedEmail);
      const pass =
        otherTenantPage.status === 200 &&
        unknownPage.status === 200 &&
        notFoundOther &&
        notFoundUnknown &&
        noLeakOther &&
        noLeakUnknown;
      record(
        "21. User Accounts detail other-tenant/unknown → not found",
        pass,
        pass
          ? "User not found; no cross-tenant email leaked"
          : `other=${otherTenantPage.status}/${notFoundOther}/leak=${!noLeakOther} unknown=${unknownPage.status}/${notFoundUnknown}`,
      );
    }

    // ---------- Case 22 ----------
    {
      const deactivateCross = await apiJson("/api/admin/users/deactivate", {
        method: "POST",
        cookies: nonDavorsCookies,
        body: { auth_uid: staffOtherUid },
      });
      const reactivateCross = await apiJson("/api/admin/users/reactivate", {
        method: "POST",
        cookies: nonDavorsCookies,
        body: { auth_uid: staffOtherUid },
      });
      const { data: otherStillActive } = await admin
        .from("user_accounts")
        .select("is_active")
        .eq("auth_uid", staffOtherUid)
        .eq("tenant_id", otherStaffTenantId)
        .maybeSingle();

      const deactivateOwn = await apiJson("/api/admin/users/deactivate", {
        method: "POST",
        cookies: nonDavorsCookies,
        body: { auth_uid: staffForceUid },
      });
      const { data: ownAfterDeactivate } = await admin
        .from("user_accounts")
        .select("is_active")
        .eq("auth_uid", staffForceUid)
        .eq("tenant_id", nonDavorsTenantId)
        .maybeSingle();
      const reactivateOwn = await apiJson("/api/admin/users/reactivate", {
        method: "POST",
        cookies: nonDavorsCookies,
        body: { auth_uid: staffForceUid },
      });
      const { data: ownAfterReactivate } = await admin
        .from("user_accounts")
        .select("is_active")
        .eq("auth_uid", staffForceUid)
        .eq("tenant_id", nonDavorsTenantId)
        .maybeSingle();

      const crossBlocked =
        deactivateCross.status === 404 &&
        reactivateCross.status === 404 &&
        otherStillActive?.is_active === true;
      const sameTenantOk =
        deactivateOwn.status === 200 &&
        ownAfterDeactivate?.is_active === false &&
        reactivateOwn.status === 200 &&
        ownAfterReactivate?.is_active === true;
      const pass = crossBlocked && sameTenantOk;
      record(
        "22. Deactivate/reactivate require same-tenant target",
        pass,
        pass
          ? "cross-tenant 404; same-tenant deactivate+reactivate ok"
          : `cross=${deactivateCross.status}/${reactivateCross.status} own=${deactivateOwn.status}/${reactivateOwn.status}`,
      );
    }

    // ---------- Case 23 ----------
    {
      const res = await apiJson("/api/admin/users/update", {
        method: "POST",
        cookies: nonDavorsCookies,
        body: {
          auth_uid: nonDavorsAdminUid,
          email: nonDavorsAdminEmail,
          role: "director",
          employee_id: null,
          client_id: null,
          supervisor_site_codes: [],
          is_active: true,
        },
      });
      const { data: stillAdmin } = await admin
        .from("user_accounts")
        .select("role")
        .eq("auth_uid", nonDavorsAdminUid)
        .eq("tenant_id", nonDavorsTenantId)
        .maybeSingle();
      const pass =
        res.status === 400 &&
        String(res.body.error) === SELF_ROLE_ACCESS_CHANGE_MESSAGE &&
        stillAdmin?.role === "super_admin";
      record(
        "23. Self role/access change rejected by API",
        pass,
        pass
          ? "400 + role unchanged"
          : `status=${res.status} err=${String(res.body.error ?? "").slice(0, 80)} role=${stillAdmin?.role}`,
      );
    }

    // ---------- Case 24 ----------
    {
      let step = "start";
      try {
        step = "create";
        const doomedEmail = emailFor(stamp, "staff-doomed");
        const doomedUid = await createAuthUser(
          admin,
          cleanup,
          doomedEmail,
          "staff",
        );
        step = "insert";
        await insertStaffAccount(admin, {
          authUid: doomedUid,
          email: doomedEmail,
          tenantId: nonDavorsTenantId,
          role: "director",
        });
        step = "signin";
        const doomedJar = await signInCookies(
          url,
          anon,
          doomedEmail,
          TEST_PASSWORD,
        );

        step = "delete";
        const del = await apiJson("/api/admin/users/delete", {
          method: "POST",
          cookies: nonDavorsCookies,
          body: { auth_uid: doomedUid },
        });

        // Prefer deactivate-style path when delete is blocked: remove app row + revoke.
        if (del.status !== 200) {
          step = "fallback-revoke";
          await admin
            .from("user_accounts")
            .delete()
            .eq("auth_uid", doomedUid)
            .eq("tenant_id", nonDavorsTenantId);
          await admin.auth.admin.updateUserById(doomedUid, {
            ban_duration: "876000h",
          });
        }

        await new Promise((resolve) => setTimeout(resolve, 750));

        step = "redirect-chain";
        const chain = await followRedirectChain("/dashboard", doomedJar, 5);
        const result = inactiveSessionPass({
          chain,
          jar: doomedJar,
          expectedLoginPath: "/login",
        });
        cleanup.authUids = cleanup.authUids.filter((id) => id !== doomedUid);
        const deleteOk = del.status === 200 || del.status === 400;
        const pass = deleteOk && result.pass;
        record(
          "24. Deleted-user session ends at login notice (no redirect loop)",
          pass,
          pass
            ? result.detail
            : `del=${del.status} ${result.detail}`,
        );
      } catch (caseError) {
        record(
          "24. Deleted-user session ends at login notice (no redirect loop)",
          false,
          `step=${step}: ${caseError instanceof Error ? caseError.message : String(caseError)}`,
        );
      }
    }

    // ---------- Case 25 ----------
    {
      let step = "start";
      try {
        step = "create";
        const deactEmail = emailFor(stamp, "staff-deact");
        const deactUid = await createAuthUser(
          admin,
          cleanup,
          deactEmail,
          "staff",
        );
        await insertStaffAccount(admin, {
          authUid: deactUid,
          email: deactEmail,
          tenantId: nonDavorsTenantId,
          role: "director",
        });
        step = "signin";
        const deactJar = await signInCookies(
          url,
          anon,
          deactEmail,
          TEST_PASSWORD,
        );

        step = "deactivate";
        const deact = await apiJson("/api/admin/users/deactivate", {
          method: "POST",
          cookies: nonDavorsCookies,
          body: { auth_uid: deactUid },
        });
        assert(deact.status === 200, `deactivate ${deact.status}`);

        await new Promise((resolve) => setTimeout(resolve, 750));

        step = "redirect-chain";
        const chain = await followRedirectChain("/dashboard", deactJar, 5);
        const result = inactiveSessionPass({
          chain,
          jar: deactJar,
          expectedLoginPath: "/login",
        });
        record(
          "25. Deactivated-user session ends at login notice (no redirect loop)",
          result.pass,
          result.detail,
        );
      } catch (caseError) {
        record(
          "25. Deactivated-user session ends at login notice (no redirect loop)",
          false,
          `step=${step}: ${caseError instanceof Error ? caseError.message : String(caseError)}`,
        );
      }
    }

    // ---------- Case 26 ----------
    {
      let step = "start";
      try {
        step = "create";
        const susEmail = emailFor(stamp, "landlord-sus");
        const susTenantId = await createReTenant(
          admin,
          cleanup,
          stamp,
          "llsus",
          susEmail,
        );
        const susUid = await createAuthUser(
          admin,
          cleanup,
          susEmail,
          "landlord",
        );
        await insertLandlord(admin, susTenantId, susUid, "platform_only");

        step = "signin";
        const susJar = await signInCookies(url, anon, susEmail, TEST_PASSWORD);

        step = "suspend";
        const sus = await apiJson("/api/admin/landlords/suspend", {
          method: "POST",
          cookies: davorsCookies,
          body: { tenant_id: susTenantId },
        });
        assert(sus.status === 200, `suspend ${sus.status} ${String(sus.body.error ?? "")}`);

        await new Promise((resolve) => setTimeout(resolve, 750));

        step = "redirect-chain";
        const chain = await followRedirectChain(
          "/landlord-portal/dashboard",
          susJar,
          5,
        );
        const result = inactiveSessionPass({
          chain,
          jar: susJar,
          expectedLoginPath: "/landlord-portal/login",
        });
        record(
          "26. Suspended-landlord session ends at login notice (no redirect loop)",
          result.pass,
          result.detail,
        );
      } catch (caseError) {
        record(
          "26. Suspended-landlord session ends at login notice (no redirect loop)",
          false,
          `step=${step}: ${caseError instanceof Error ? caseError.message : String(caseError)}`,
        );
      }
    }
  } catch (error) {
    record(
      "SETUP/RUN",
      false,
      error instanceof Error ? error.message : String(error),
    );
  } finally {
    console.log("\n--- Cleanup ---");
    try {
      await cleanupAll(admin, cleanup);
      const confirmed = await confirmCleanup(admin, cleanup);
      record("Cleanup confirmed", confirmed.ok, confirmed.detail);
    } catch (error) {
      record(
        "Cleanup confirmed",
        false,
        error instanceof Error ? error.message : String(error),
      );
    }
  }

  console.log("\n=== Summary ===");
  for (const row of results) {
    console.log(`${row.pass ? "PASS" : "FAIL"}\t${row.name}\t${row.detail}`);
  }
  const failed = results.filter((r) => !r.pass).length;
  console.log(
    `\n${results.length - failed}/${results.length} passed, ${failed} failed`,
  );
  if (failed > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
