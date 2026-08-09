/**
 * One-off: verify tenant-logos signed-url rejects cross-tenant staff access on staging.
 * Usage: node scripts/verify-tenant-logos-signed-url-isolation-staging.mjs
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";

const DAVORS = "00000001-0000-4000-8000-000000000001";
const CAANTA = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";
const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const STAGING_APP_URL =
  process.env.STAGING_APP_URL ??
  "https://dfoms-erp-git-staging-davorsghs-projects.vercel.app";
const PASSWORD = `SignedUrlIso-${Date.now().toString(36)}!Aa8`;

function loadEnvForce(filePath) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    process.env[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim();
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function buildCookieHeaderFromStore(cookieStore) {
  return cookieStore.map(({ name, value }) => `${name}=${value}`).join("; ");
}

loadEnvForce(resolve(process.cwd(), ".env.staging.local"));

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const anon =
  process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
  "";

assert(url.includes(STAGING_REF), `Refusing non-staging Supabase URL: ${url}`);
assert(serviceKey && anon, "Missing staging Supabase keys");

const admin = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const stamp = Date.now().toString(36);
const email = `signed-url-iso.${stamp}@test.davors`;
let authUid = null;

async function cleanup() {
  if (authUid) {
    await admin.from("user_accounts").delete().eq("auth_uid", authUid);
    await admin.auth.admin.deleteUser(authUid);
  }
}

try {
  const { data: davorsTenant, error: tenantError } = await admin
    .from("tenants")
    .select("id, logo_url")
    .eq("id", DAVORS)
    .maybeSingle();
  assert(!tenantError && davorsTenant, tenantError?.message ?? "Davors tenant missing");

  function normalizeTenantLogosPath(value) {
    const trimmed = String(value ?? "").trim();
    if (!trimmed) return "";
    const publicPrefix = "/storage/v1/object/public/tenant-logos/";
    const signedPrefix = "/storage/v1/object/sign/tenant-logos/";
    for (const prefix of [publicPrefix, signedPrefix]) {
      const idx = trimmed.indexOf(prefix);
      if (idx >= 0) {
        const rest = trimmed.slice(idx + prefix.length);
        const queryIdx = rest.indexOf("?");
        return decodeURIComponent(
          queryIdx >= 0 ? rest.slice(0, queryIdx) : rest,
        );
      }
    }
    if (/^[0-9a-f-]{36}\//i.test(trimmed)) return trimmed;
    return "";
  }

  async function findObjectPathForTenant(tenantId) {
    const candidates = [];

    const { data: tenantRow } = await admin
      .from("tenants")
      .select("logo_url")
      .eq("id", tenantId)
      .maybeSingle();
    candidates.push(normalizeTenantLogosPath(tenantRow?.logo_url));

    const { data: landlordRows } = await admin
      .from("landlords")
      .select("logo_url")
      .eq("tenant_id", tenantId)
      .not("logo_url", "is", null)
      .limit(5);
    for (const row of landlordRows ?? []) {
      candidates.push(normalizeTenantLogosPath(row.logo_url));
    }

    const { data: listed, error: listError } = await admin.storage
      .from("tenant-logos")
      .list(tenantId, { limit: 1 });
    if (!listError && listed?.[0]?.name) {
      candidates.push(`${tenantId}/${listed[0].name}`);
    }

    return candidates.find((path) => path.startsWith(`${tenantId}/`)) ?? "";
  }

  let davorsObjectPath = normalizeTenantLogosPath(davorsTenant.logo_url);
  if (!davorsObjectPath.startsWith(`${DAVORS}/`)) {
    davorsObjectPath = await findObjectPathForTenant(DAVORS);
  }

  // Auth is enforced before storage lookup; a well-formed path is enough if DB/storage has none.
  if (!davorsObjectPath.startsWith(`${DAVORS}/`)) {
    davorsObjectPath = `${DAVORS}/workspace/logo/isolation-probe.jpg`;
    console.log(
      "Note: no Davors tenant-logos object found in staging DB/storage; using synthetic path for auth probe.",
    );
  }

  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  assert(!authError && authData.user, authError?.message ?? "auth user create failed");
  authUid = authData.user.id;

  const { error: accountError } = await admin.from("user_accounts").insert({
    auth_uid: authUid,
    email,
    role: "finance",
    is_active: true,
    tenant_id: CAANTA,
  });
  assert(!accountError, accountError?.message ?? "user_accounts insert failed");

  const { data: caantaAccount } = await admin
    .from("user_accounts")
    .select("tenant_id, role")
    .eq("auth_uid", authUid)
    .single();

  console.log("=== Setup ===");
  console.log("Staging app:", STAGING_APP_URL);
  console.log("Actor email:", email);
  console.log("Actor tenant_id:", caantaAccount?.tenant_id);
  console.log("Actor role:", caantaAccount?.role);
  console.log("Target object path (Davors):", davorsObjectPath);

  const cookieStore = [];
  const actorClient = createServerClient(url, anon, {
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

  const { error: signInError } = await actorClient.auth.signInWithPassword({
    email,
    password: PASSWORD,
  });
  assert(!signInError, signInError?.message ?? "sign-in failed");
  assert(cookieStore.length > 0, "Expected Supabase auth cookies after sign-in");

  const cookieHeader = buildCookieHeaderFromStore(cookieStore);
  console.log("Auth cookies:", cookieStore.map((c) => c.name).join(", "));

  const fetchHeaders = { Cookie: cookieHeader };
  const vercelBypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  if (vercelBypass) {
    fetchHeaders["x-vercel-protection-bypass"] = vercelBypass;
  }

  const apiUrl = new URL("/api/storage/tenant-logos/signed-url", STAGING_APP_URL);
  apiUrl.searchParams.set("reference", davorsObjectPath);

  console.log("\n=== Cross-tenant request ===");
  console.log("GET", apiUrl.toString());

  const response = await fetch(apiUrl, {
    method: "GET",
    headers: fetchHeaders,
    redirect: "manual",
  });

  const bodyText = await response.text();
  let bodyJson = null;
  try {
    bodyJson = JSON.parse(bodyText);
  } catch {
    bodyJson = bodyText;
  }

  console.log("HTTP status:", response.status, response.statusText);
  const location = response.headers.get("location");
  if (location) {
    console.log("Location:", location);
  }
  console.log("Response body:", typeof bodyJson === "string" ? bodyJson : JSON.stringify(bodyJson));

  if (response.status === 302 || response.status === 307) {
    console.error(
      "\nNOTE: Got a redirect instead of 401/403. If Location points at /login, auth cookies did not reach the app.",
      "If Location points at vercel.com/sso-api, the deployment is behind Vercel Deployment Protection — set VERCEL_AUTOMATION_BYPASS_SECRET or use STAGING_APP_URL=http://localhost:3000 with npm run dev.",
    );
  }

  assert(
    response.status === 401 || response.status === 403,
    `Expected 401/403 for cross-tenant access, got ${response.status}`,
  );
  assert(
    !bodyText.includes("signedUrl"),
    "Response must not include a signedUrl for cross-tenant access",
  );

  console.log("\nPASS: cross-tenant signed-url request was rejected.");
} finally {
  await cleanup();
}
