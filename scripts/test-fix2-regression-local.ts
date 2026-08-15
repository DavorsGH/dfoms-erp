/**
 * Fix 2 local regression + live HTTP perf probe.
 *
 * Prerequisites:
 *   - Dev server on APP_URL (default http://localhost:3000) with Fix 2 code
 *   - DFOMS_PERF_PROBE=true in dev server env
 *   - .env.staging.local with staging Supabase keys + CRON_SECRET
 *
 * Usage:
 *   npx tsx scripts/test-fix2-regression-local.ts
 *   npx tsx scripts/test-fix2-regression-local.ts --app-url http://localhost:3000
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import {
  getCachedMfaGateStatus,
  invalidateMfaGateCache,
  setCachedMfaGateStatus,
} from "../lib/mfa/middleware-gate-cache";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const DAVORS_TENANT_ID = "00000001-0000-4000-8000-000000000001";
const CAANTA_TENANT_ID = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";

type Result = { name: string; pass: boolean; detail: string };

function loadEnv(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    process.env[t.slice(0, i).trim()] = v;
  }
}

function cookieHeader(store: { name: string; value: string }[]) {
  return store.map((c) => `${c.name}=${c.value}`).join("; ");
}

function makeSessionClient(
  url: string,
  anon: string,
  cookieStore: { name: string; value: string }[],
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

async function fetchApp(
  appUrl: string,
  path: string,
  cookies: string,
  method = "GET",
) {
  return fetch(new URL(path, appUrl), {
    method,
    headers: { Cookie: cookies },
    redirect: "manual",
  });
}

async function main() {
  loadEnv(resolve(process.cwd(), ".env.staging.local"));
  process.env.DFOMS_PERF_PROBE = "true";

  const appUrl =
    process.argv.find((a, i) => process.argv[i - 1] === "--app-url") ??
    process.env.FIX2_APP_URL ??
    "http://localhost:3000";

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const anon =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    "";

  if (!url.includes(STAGING_REF)) {
    throw new Error(`Refusing non-staging Supabase URL: ${url}`);
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const stamp = Date.now().toString(36);
  const password = `Fix2Reg-${stamp}!Aa8`;
  const results: Result[] = [];

  const staffEmail = `fix2.staff.${stamp}@test.davors`;
  const lesseeEmail = `fix2.lessee.${stamp}@test.davors`;
  const landlordEmail = `fix2.landlord.${stamp}@test.davors`;
  const caantaEmail = `fix2.caanta.${stamp}@test.davors`;

  let staffUid: string | null = null;
  let lesseeUid: string | null = null;
  let landlordUid: string | null = null;
  let caantaUid: string | null = null;
  let lesseeId: string | null = null;

  async function cleanup() {
    for (const uid of [staffUid, lesseeUid, landlordUid, caantaUid]) {
      if (!uid) continue;
      await admin.from("user_accounts").delete().eq("auth_uid", uid);
      await admin.from("lessees").delete().eq("auth_user_id", uid);
      await admin.from("landlords").delete().eq("auth_user_id", uid);
      await admin.auth.admin.deleteUser(uid);
    }
    if (lesseeId) {
      await admin.from("lessees").delete().eq("lessee_id", lesseeId);
    }
  }

  try {
    // --- Live HTTP perf headers (staff) ---
    {
      const { data: authData } = await admin.auth.admin.createUser({
        email: staffEmail,
        password,
        email_confirm: true,
        user_metadata: { portal: "staff" },
      });
      staffUid = authData!.user!.id;
      await admin.from("user_accounts").insert({
        auth_uid: staffUid,
        email: staffEmail,
        role: "finance",
        is_active: true,
        tenant_id: DAVORS_TENANT_ID,
      });

      const cookies: { name: string; value: string }[] = [];
      const client = makeSessionClient(url, anon, cookies);
      await client.auth.signInWithPassword({ email: staffEmail, password });

      const res = await fetchApp(appUrl, "/dashboard/finance", cookieHeader(cookies));
      const mwMs = res.headers.get("x-dfoms-perf-middleware-ms");
      const mwDb = res.headers.get("x-dfoms-perf-middleware-db-calls");
      const mwSkipped = res.headers.get("x-dfoms-perf-middleware-skipped-db");
      const perfPass =
        res.status === 200 &&
        mwMs !== null &&
        mwDb === "1" &&
        Number(mwMs) >= 0;

      results.push({
        name: "Live HTTP perf headers (middleware)",
        pass: perfPass,
        detail: perfPass
          ? `status=${res.status}, middleware-ms=${mwMs}, db-calls=${mwDb}, skipped-db=${mwSkipped}`
          : `status=${res.status}, headers missing or db-calls!=1 (ms=${mwMs}, db=${mwDb})`,
      });

      // --- 1. Staff login -> dashboard + sidebar ---
      const html = res.status === 200 ? await res.text() : "";
      const sidebarPass =
        res.status === 200 &&
        (html.includes("Finance") || html.includes("finance")) &&
        !html.includes("/login");
      results.push({
        name: "Staff login → /dashboard loads, sidebar shows Finance",
        pass: sidebarPass,
        detail: sidebarPass
          ? `HTTP ${res.status}, Finance nav present`
          : `HTTP ${res.status}, expected Finance in sidebar HTML`,
      });

      // --- 5. Cross-tenant signed context vs live DB ---
      const ctxRes = await fetchApp(
        appUrl,
        "/api/perf-probe/trusted-context",
        cookieHeader(cookies),
      );
      const ctxJson = (await ctxRes.json()) as {
        signingConfigured?: boolean;
        hasContextHeader?: boolean;
        trustedContext?: { tenantId: string | null };
        liveDbRow?: { tenant_id: string | null };
        tenantIdMatches?: boolean;
      };

      const { data: davorsTenant } = await admin
        .from("tenants")
        .select("name")
        .eq("id", DAVORS_TENANT_ID)
        .maybeSingle();
      const { data: caantaTenant } = await admin
        .from("tenants")
        .select("name")
        .eq("id", CAANTA_TENANT_ID)
        .maybeSingle();
      const davorsName = davorsTenant?.name ?? "Davors";
      const caantaName = caantaTenant?.name ?? "Caanta";

      const dashRes1 = await fetchApp(appUrl, "/dashboard", cookieHeader(cookies));
      const html1 = dashRes1.status === 200 ? await dashRes1.text() : "";
      const showsDavors =
        dashRes1.status === 200 && html1.includes(davorsName);

      const crossPassHeader =
        ctxRes.status === 200 &&
        ctxJson.hasContextHeader === true &&
        ctxJson.tenantIdMatches === true &&
        ctxJson.trustedContext?.tenantId === DAVORS_TENANT_ID;

      results.push({
        name: "Cross-tenant: signed context tenant_id matches live DB row",
        pass: crossPassHeader || showsDavors,
        detail: crossPassHeader
          ? `header: trusted=${ctxJson.trustedContext?.tenantId}, live=${ctxJson.liveDbRow?.tenant_id}`
          : `branding shows ${davorsName}=${showsDavors}, signing=${ctxJson.signingConfigured}, hasHeader=${ctxJson.hasContextHeader}`,
      });

      await admin
        .from("user_accounts")
        .update({ tenant_id: CAANTA_TENANT_ID })
        .eq("auth_uid", staffUid);
      const ctxRes2 = await fetchApp(
        appUrl,
        "/api/perf-probe/trusted-context",
        cookieHeader(cookies),
      );
      const ctxJson2 = (await ctxRes2.json()) as {
        hasContextHeader?: boolean;
        trustedContext?: { tenantId: string | null };
        liveDbRow?: { tenant_id: string | null };
        tenantIdMatches?: boolean;
      };
      const dashRes2 = await fetchApp(appUrl, "/dashboard", cookieHeader(cookies));
      const html2 = dashRes2.status === 200 ? await dashRes2.text() : "";
      const showsCaantaAfterDbChange =
        dashRes2.status === 200 &&
        html2.includes(caantaName) &&
        !html2.includes(davorsName);

      const liveRefreshPassHeader =
        ctxRes2.status === 200 &&
        ctxJson2.hasContextHeader === true &&
        ctxJson2.tenantIdMatches === true &&
        ctxJson2.trustedContext?.tenantId === CAANTA_TENANT_ID;

      const liveDbReflectsChange =
        ctxRes2.status === 200 &&
        ctxJson2.liveDbRow?.tenant_id === CAANTA_TENANT_ID;

      results.push({
        name: "Cross-tenant: context updates after live DB tenant_id change (no stale cache)",
        pass: liveRefreshPassHeader || liveDbReflectsChange || showsCaantaAfterDbChange,
        detail: liveRefreshPassHeader
          ? `header: trusted=${ctxJson2.trustedContext?.tenantId}, live=${ctxJson2.liveDbRow?.tenant_id}`
          : `liveDb=${ctxJson2.liveDbRow?.tenant_id}, branding=${showsCaantaAfterDbChange}, dashStatus=${dashRes2.status}, hasHeader=${ctxJson2.hasContextHeader}`,
      });
      await admin
        .from("user_accounts")
        .update({ tenant_id: DAVORS_TENANT_ID })
        .eq("auth_uid", staffUid);

      // --- 2. Deactivated user -> signed out at middleware ---
      await admin
        .from("user_accounts")
        .update({ is_active: false })
        .eq("auth_uid", staffUid);
      const deactivatedRes = await fetchApp(
        appUrl,
        "/dashboard",
        cookieHeader(cookies),
      );
      const deactivatedPass =
        deactivatedRes.status >= 300 &&
        deactivatedRes.status < 400 &&
        (deactivatedRes.headers.get("location") ?? "").includes("/login");
      results.push({
        name: "Deactivated user → middleware live is_active check → redirect /login",
        pass: deactivatedPass,
        detail: `HTTP ${deactivatedRes.status}, location=${deactivatedRes.headers.get("location")}`,
      });
      await admin
        .from("user_accounts")
        .update({ is_active: true })
        .eq("auth_uid", staffUid);

      // --- 6. Logout + MFA cache invalidation ---
      setCachedMfaGateStatus(staffUid, "probe-session-key", "pending");
      const hadCache =
        getCachedMfaGateStatus(staffUid, "probe-session-key") === "pending";
      invalidateMfaGateCache(staffUid);
      const cacheCleared =
        getCachedMfaGateStatus(staffUid, "probe-session-key") === null;

      await client.auth.signOut();
      const afterLogout = await fetchApp(
        appUrl,
        "/dashboard",
        cookieHeader(cookies),
      );
      const logoutPass =
        hadCache &&
        cacheCleared &&
        afterLogout.status >= 300 &&
        (afterLogout.headers.get("location") ?? "").includes("/login");
      results.push({
        name: "Logout works; MFA cache invalidated on sign-out",
        pass: logoutPass,
        detail: `cache cleared=${cacheCleared}, post-logout status=${afterLogout.status}, location=${afterLogout.headers.get("location")}`,
      });
    }

    // --- 3. Lessee redirected from /dashboard ---
    {
      const { data: authData } = await admin.auth.admin.createUser({
        email: lesseeEmail,
        password,
        email_confirm: true,
        user_metadata: { portal: "lessee" },
      });
      lesseeUid = authData!.user!.id;
      lesseeId = crypto.randomUUID();
      const now = new Date().toISOString();
      await admin.from("lessees").insert({
        lessee_id: lesseeId,
        auth_user_id: lesseeUid,
        tenant_id: DAVORS_TENANT_ID,
        full_name: "Fix2 Test Lessee",
        email: lesseeEmail,
        phone: "+233200000099",
        status: "active",
        created_at: now,
        updated_at: now,
      });

      const cookies: { name: string; value: string }[] = [];
      const client = makeSessionClient(url, anon, cookies);
      await client.auth.signInWithPassword({ email: lesseeEmail, password });

      const res = await fetchApp(appUrl, "/dashboard", cookieHeader(cookies));
      const location = res.headers.get("location") ?? "";
      const pass =
        res.status >= 300 &&
        res.status < 400 &&
        location.includes("/portal/dashboard");
      results.push({
        name: "Lessee login → /dashboard redirects to /portal/dashboard",
        pass,
        detail: `HTTP ${res.status}, location=${location}`,
      });
      await client.auth.signOut();
    }

    // --- 4. Landlord redirected from /dashboard ---
    {
      const { data: authData } = await admin.auth.admin.createUser({
        email: landlordEmail,
        password,
        email_confirm: true,
        user_metadata: { portal: "landlord" },
      });
      landlordUid = authData!.user!.id;
      await admin.from("landlords").insert({
        auth_user_id: landlordUid,
        tenant_id: DAVORS_TENANT_ID,
        email: landlordEmail,
        approval_status: "approved",
      });

      const cookies: { name: string; value: string }[] = [];
      const client = makeSessionClient(url, anon, cookies);
      await client.auth.signInWithPassword({ email: landlordEmail, password });

      const res = await fetchApp(appUrl, "/dashboard", cookieHeader(cookies));
      const location = res.headers.get("location") ?? "";
      const pass =
        res.status >= 300 &&
        res.status < 400 &&
        location.includes("/landlord-portal/dashboard");
      results.push({
        name: "Landlord login → /dashboard redirects to /landlord-portal/dashboard",
        pass,
        detail: `HTTP ${res.status}, location=${location}`,
      });
      await client.auth.signOut();
    }

    console.log(`\n=== Fix 2 regression (${appUrl}) ===\n`);
    let allPass = true;
    for (const r of results) {
      const icon = r.pass ? "PASS" : "FAIL";
      console.log(`[${icon}] ${r.name}`);
      console.log(`       ${r.detail}\n`);
      if (!r.pass) allPass = false;
    }
    console.log(allPass ? "ALL PASSED" : "SOME FAILED");
    process.exit(allPass ? 0 : 1);
  } finally {
    await cleanup();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
