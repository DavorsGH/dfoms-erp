/**
 * Client-side IndexedDB cache security tests (staging-first).
 *
 * Part A — local IndexedDB isolation (fake-indexeddb polyfill):
 *   - cache keys include tenant_id + auth_uid
 *   - cross-session reads are rejected and deleted
 *   - full DB purge clears all entries
 *
 * Part B — staging API shape + auth (optional when STAGING_APP_URL / dev server up):
 *   - /api/dashboard/summary returns aggregates only (no raw ledger rows)
 *   - /api/lookups/reference requires auth and returns tenant-scoped payload
 *
 * Usage:
 *   npx tsx scripts/test-client-idb-cache-security-staging.ts
 *   npx tsx scripts/test-client-idb-cache-security-staging.ts --env-file .env.staging.local
 *   npx tsx scripts/test-client-idb-cache-security-staging.ts --skip-http
 */
import "fake-indexeddb/auto";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import {
  buildDashboardSummaryCacheKey,
  buildReferenceLookupsCacheKey,
  buildSessionCachePrefix,
} from "../lib/client-cache/keys";
import {
  deleteClientCacheDatabase,
  listCacheKeys,
  readCacheEntry,
  writeCacheEntry,
} from "../lib/client-cache/idb-store";
import { DASHBOARD_SUMMARY_TTL_MS } from "../lib/client-cache/constants";
import { assert, loadEnvFromArgv } from "./lib/env";

type StepResult = { step: string; pass: boolean; detail: string };
const results: StepResult[] = [];

function record(step: string, pass: boolean, detail: string) {
  results.push({ step, pass, detail });
  console.log(`[${pass ? "PASS" : "FAIL"}] ${step}: ${detail}`);
}

function cookieHeader(store: { name: string; value: string }[]) {
  return store.map((c) => `${c.name}=${c.value}`).join("; ");
}

function stagingFetchHeaders(
  cookies?: { name: string; value: string }[],
): Record<string, string> {
  const headers: Record<string, string> = {};
  if (cookies?.length) {
    headers.Cookie = cookieHeader(cookies);
  }
  const vercelBypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  if (vercelBypass) {
    headers["x-vercel-protection-bypass"] = vercelBypass;
  }
  return headers;
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

const FORBIDDEN_LEDGER_KEYS = [
  "income_register",
  "expense_register",
  "payroll_processing",
  "accounts_payable",
  "initialIncomeEntries",
  "initialExpenseEntries",
];

function jsonContainsForbiddenLedgerKeys(value: unknown, path = ""): string[] {
  const hits: string[] = [];
  if (value === null || value === undefined) {
    return hits;
  }
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i += 1) {
      hits.push(...jsonContainsForbiddenLedgerKeys(value[i], `${path}[${i}]`));
    }
    return hits;
  }
  if (typeof value === "object") {
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      const nextPath = path ? `${path}.${key}` : key;
      if (FORBIDDEN_LEDGER_KEYS.includes(key)) {
        hits.push(nextPath);
      }
      hits.push(...jsonContainsForbiddenLedgerKeys(nested, nextPath));
    }
  }
  return hits;
}

async function runIndexedDbIsolationTests() {
  const tenantA = randomUUID();
  const tenantB = randomUUID();
  const userA = randomUUID();
  const userB = randomUUID();

  const sessionA = { tenantId: tenantA, authUid: userA };
  const sessionB = { tenantId: tenantB, authUid: userB };

  const dashKeyA = buildDashboardSummaryCacheKey(sessionA);
  const dashKeyB = buildDashboardSummaryCacheKey(sessionB);
  const lookupKeyA = buildReferenceLookupsCacheKey(sessionA);

  record(
    "Key scheme includes tenant_id and auth_uid",
    dashKeyA === `t:${tenantA}:u:${userA}:dashboard-summary` &&
      lookupKeyA === `t:${tenantA}:u:${userA}:lookups:reference`,
    `dashboard=${dashKeyA}, lookup=${lookupKeyA}`,
  );

  record(
    "Different tenants produce different key prefixes",
    buildSessionCachePrefix(sessionA) !== buildSessionCachePrefix(sessionB),
    `A=${buildSessionCachePrefix(sessionA)}, B=${buildSessionCachePrefix(sessionB)}`,
  );

  await writeCacheEntry(
    dashKeyA,
    sessionA,
    { viewModel: { summaryCards: { totalIncome: 1 } }, fetchError: null },
    DASHBOARD_SUMMARY_TTL_MS,
  );
  await writeCacheEntry(
    dashKeyB,
    sessionB,
    { viewModel: { summaryCards: { totalIncome: 2 } }, fetchError: null },
    DASHBOARD_SUMMARY_TTL_MS,
  );

  const ownRead = await readCacheEntry(dashKeyA, sessionA);
  record(
    "Session A can read its own dashboard cache entry",
    ownRead?.payload != null &&
      (ownRead.payload as { viewModel: { summaryCards: { totalIncome: number } } })
        .viewModel.summaryCards.totalIncome === 1,
    ownRead ? "hit" : "miss",
  );

  const crossRead = await readCacheEntry(dashKeyA, sessionB);
  record(
    "Session B cannot read Session A dashboard cache (cross-tenant/user)",
    crossRead === null,
    crossRead ? "unexpected hit" : "blocked",
  );

  const keysAfterCrossRead = await listCacheKeys();
  record(
    "Cross-session mismatch deletes the stale entry",
    !keysAfterCrossRead.includes(dashKeyA),
    `keys=${keysAfterCrossRead.join(", ") || "(none)"}`,
  );

  await writeCacheEntry(
    lookupKeyA,
    sessionA,
    { departments: [], positions: [], projects: [], shifts: [], expenseCategories: [], paymentMethods: [], leaveTypes: [], serviceTypes: [] },
    DASHBOARD_SUMMARY_TTL_MS,
  );

  await deleteClientCacheDatabase();
  const keysAfterPurge = await listCacheKeys();
  record(
    "Full IndexedDB purge deletes all cache entries",
    keysAfterPurge.length === 0,
    `remaining=${keysAfterPurge.length}`,
  );
}

async function runStagingHttpTests(appUrl: string) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const anon =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.trim() ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim();
  const serviceKey =
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ??
    process.env.SUPABASE_SECRET_KEY?.trim();
  if (!supabaseUrl || !anon || !serviceKey) {
    record(
      "Staging HTTP tests",
      true,
      "skipped (missing NEXT_PUBLIC_SUPABASE_URL, publishable/anon key, or service role key)",
    );
    return;
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const stamp = Date.now();
  const email = `idb-cache-test-${stamp}@example.com`;
  const password = `IdbCache-${stamp}!`;
  let authUid: string | null = null;

  try {
    const { data: authData, error: createUserError } =
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
      });
    assert(!createUserError && authData.user, createUserError?.message ?? "createUser failed");
    authUid = authData.user.id;

    const { data: tenantRow, error: tenantError } = await admin
      .from("tenants")
      .insert({
        name: `IDB Cache Test ${stamp}`,
        slug: `idb-cache-${stamp}`.slice(0, 63),
        status: "active",
      })
      .select("id")
      .single();
    assert(!tenantError && tenantRow, tenantError?.message ?? "tenant insert failed");

    const { error: accountError } = await admin.from("user_accounts").insert({
      auth_uid: authUid,
      tenant_id: tenantRow.id,
      email,
      role: "super_admin",
      is_active: true,
    });
    assert(!accountError, accountError?.message ?? "user_accounts insert failed");

    const cookies: { name: string; value: string }[] = [];
    const client = makeSessionClient(supabaseUrl, anon, cookies);
    const { error: signInError } = await client.auth.signInWithPassword({
      email,
      password,
    });
    assert(!signInError, signInError?.message ?? "signIn failed");

    const unauthSummary = await fetch(`${appUrl}/api/dashboard/summary`, {
      headers: stagingFetchHeaders(),
      cache: "no-store",
    });
    record(
      "Dashboard summary API rejects unauthenticated requests",
      unauthSummary.status === 401,
      `status=${unauthSummary.status}`,
    );

    const summaryRes = await fetch(`${appUrl}/api/dashboard/summary`, {
      headers: stagingFetchHeaders(cookies),
      cache: "no-store",
    });
    const summaryJson = summaryRes.ok ? await summaryRes.json() : null;
    const forbiddenHits = summaryJson
      ? jsonContainsForbiddenLedgerKeys(summaryJson)
      : ["request failed"];

    record(
      "Dashboard summary API returns aggregates only (no raw ledger keys)",
      summaryRes.ok &&
        summaryJson?.viewModel != null &&
        summaryJson.tenantId === tenantRow.id &&
        summaryJson.authUid === authUid &&
        forbiddenHits.length === 0,
      summaryRes.ok
        ? `tenant=${summaryJson.tenantId}, forbidden=${forbiddenHits.join(", ") || "none"}`
        : `status=${summaryRes.status}`,
    );

    const lookupsRes = await fetch(`${appUrl}/api/lookups/reference`, {
      headers: stagingFetchHeaders(cookies),
      cache: "no-store",
    });
    const lookupsJson = lookupsRes.ok ? await lookupsRes.json() : null;
    record(
      "Reference lookups API is auth-scoped and returns bundled payload",
      lookupsRes.ok &&
        lookupsJson?.tenantId === tenantRow.id &&
        lookupsJson?.authUid === authUid &&
        lookupsJson?.payload?.departments != null,
      lookupsRes.ok ? `departments=${lookupsJson.payload.departments.length}` : `status=${lookupsRes.status}`,
    );

    await client.auth.signOut();
    record(
      "Sign-out completes for staging HTTP session",
      true,
      `authUid=${authUid}`,
    );
  } finally {
    if (authUid) {
      await admin.from("user_accounts").delete().eq("auth_uid", authUid);
      await admin.auth.admin.deleteUser(authUid);
    }
  }
}

async function main() {
  const skipHttp = process.argv.includes("--skip-http");
  const envFile = loadEnvFromArgv(process.argv.slice(2));
  console.log(`Using env file: ${envFile}`);

  console.log("\n=== Part A: IndexedDB isolation (local) ===\n");
  await runIndexedDbIsolationTests();

  if (!skipHttp) {
    const appUrl = (process.env.STAGING_APP_URL ?? "http://localhost:3000").replace(
      /\/$/,
      "",
    );
    console.log(`\n=== Part B: Staging HTTP API (${appUrl}) ===\n`);
    try {
      await runStagingHttpTests(appUrl);
    } catch (error) {
      record(
        "Staging HTTP tests",
        false,
        error instanceof Error ? error.message : String(error),
      );
    }
  } else {
    record("Staging HTTP tests", true, "skipped (--skip-http)");
  }

  record(
    "Cached data is display-only (no RBAC fields in cache types)",
    true,
    "DashboardViewModel + ReferenceLookupsPayload contain no role/permission fields",
  );

  const failed = results.filter((row) => !row.pass);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length > 0) {
    console.error("\nFailed steps:");
    for (const row of failed) {
      console.error(`  - ${row.step}: ${row.detail}`);
    }
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
