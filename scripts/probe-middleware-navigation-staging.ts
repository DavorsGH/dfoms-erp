/**
 * Middleware + dashboard layout navigation perf probe (staging).
 *
 * Measures:
 * 1. Legacy middleware DB path (pre–Fix 2 simulation against live Supabase)
 * 2. Optimized middleware DB path (current resolveMiddlewarePersona logic)
 * 3. Optional live HTTP probe against a running app (middleware perf headers)
 *
 * Usage:
 *   npx tsx scripts/probe-middleware-navigation-staging.ts
 *   npx tsx scripts/probe-middleware-navigation-staging.ts --live http://localhost:3000
 *
 * Requires .env.staging.local with staging Supabase keys + CRON_SECRET (for signed context).
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { createServerClient } from "@supabase/ssr";
import { resolveMiddlewarePersona } from "../lib/middleware-persona";
import {
  signAuthContext,
  verifyAuthContext,
} from "../lib/middleware-auth-context";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const DAVORS_TENANT_ID = "00000001-0000-4000-8000-000000000001";

type TimedCounts = {
  ms: number;
  authCalls: number;
  dbCalls: number;
};

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

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Pre–Fix 2 middleware Supabase work for staff /dashboard navigation. */
async function simulateLegacyMiddlewarePath(
  supabase: SupabaseClient,
  authUid: string,
): Promise<TimedCounts> {
  const startedAt = Date.now();
  let authCalls = 0;
  let dbCalls = 0;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  authCalls += 1;
  if (!user) {
    throw new Error("Not authenticated for legacy simulation");
  }

  await supabase
    .from("user_accounts")
    .select("is_active")
    .eq("auth_uid", authUid)
    .maybeSingle();
  dbCalls += 1;

  await Promise.all([
    supabase
      .from("lessees")
      .select("lessee_id")
      .eq("auth_user_id", authUid)
      .maybeSingle(),
    supabase
      .from("landlords")
      .select("tenant_id")
      .eq("auth_user_id", authUid)
      .maybeSingle(),
  ]);
  dbCalls += 2;

  return {
    ms: Date.now() - startedAt,
    authCalls,
    dbCalls,
  };
}

/** Fix 2 middleware Supabase work for staff /dashboard navigation. */
async function simulateOptimizedMiddlewarePath(
  supabase: SupabaseClient,
  authUid: string,
): Promise<TimedCounts> {
  const startedAt = Date.now();
  let authCalls = 0;
  let dbCalls = 0;

  const {
    data: { user },
  } = await supabase.auth.getUser();
  authCalls += 1;
  if (!user) {
    throw new Error("Not authenticated for optimized simulation");
  }

  const { data: accountRow } = await supabase
    .from("user_accounts")
    .select("is_active, tenant_id, role, employee_id, client_id")
    .eq("auth_uid", authUid)
    .maybeSingle();
  dbCalls += 1;

  const persona = await resolveMiddlewarePersona({
    supabase,
    user,
    pathname: "/dashboard/finance",
    accountRow: accountRow ?? null,
  });
  dbCalls += persona.extraDbCalls;

  return {
    ms: Date.now() - startedAt,
    authCalls,
    dbCalls,
  };
}

/** Pre–Fix 2 layout auth/account lookups. */
async function simulateLegacyLayoutAuthPath(
  supabase: SupabaseClient,
  authUid: string,
): Promise<TimedCounts> {
  const startedAt = Date.now();
  let authCalls = 0;
  let dbCalls = 0;

  await supabase.auth.getUser();
  authCalls += 1;

  await supabase
    .from("user_accounts")
    .select("role, employee_id, client_id, tenant_id")
    .eq("auth_uid", authUid)
    .maybeSingle();
  dbCalls += 1;

  return {
    ms: Date.now() - startedAt,
    authCalls,
    dbCalls,
  };
}

function buildCookieHeader(
  cookieStore: { name: string; value: string }[],
): string {
  return cookieStore.map((c) => `${c.name}=${c.value}`).join("; ");
}

async function liveHttpProbe(
  appUrl: string,
  cookieHeader: string,
  path: string,
): Promise<{
  status: number;
  location: string | null;
  totalMs: number;
  middlewareMs: string | null;
  middlewareAuthCalls: string | null;
  middlewareDbCalls: string | null;
  middlewareSkippedDb: string | null;
}> {
  const startedAt = Date.now();
  const response = await fetch(new URL(path, appUrl), {
    headers: {
      Cookie: cookieHeader,
      "x-dfoms-perf-probe": "1",
    },
    redirect: "manual",
  });
  const totalMs = Date.now() - startedAt;

  return {
    status: response.status,
    location: response.headers.get("location"),
    totalMs,
    middlewareMs: response.headers.get("x-dfoms-perf-middleware-ms"),
    middlewareAuthCalls: response.headers.get("x-dfoms-perf-middleware-auth-calls"),
    middlewareDbCalls: response.headers.get("x-dfoms-perf-middleware-db-calls"),
    middlewareSkippedDb: response.headers.get("x-dfoms-perf-middleware-skipped-db"),
  };
}

async function main() {
  loadEnv(resolve(process.cwd(), ".env.staging.local"));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const anon =
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    "";

  if (!url.includes(STAGING_REF)) {
    throw new Error(`Refusing non-staging Supabase URL: ${url}`);
  }
  if (!serviceKey || !anon) {
    throw new Error("Missing staging Supabase keys in .env.staging.local");
  }

  process.env.DFOMS_PERF_PROBE = "true";

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const stamp = Date.now().toString(36);
  const email = `mw-perf.${stamp}@test.davors`;
  const password = `MwPerf-${stamp}!Aa8`;
  let authUid: string | null = null;

  async function cleanup() {
    if (!authUid) return;
    await admin.from("user_accounts").delete().eq("auth_uid", authUid);
    await admin.auth.admin.deleteUser(authUid);
  }

  try {
    const { data: authData, error: authError } =
      await admin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { portal: "staff" },
      });
    if (authError || !authData.user) {
      throw new Error(authError?.message ?? "Failed to create probe user");
    }
    authUid = authData.user.id;

    const { error: accountError } = await admin.from("user_accounts").insert({
      auth_uid: authUid,
      email,
      role: "finance",
      is_active: true,
      tenant_id: DAVORS_TENANT_ID,
    });
    if (accountError) {
      throw new Error(accountError.message);
    }

    const cookieStore: { name: string; value: string }[] = [];
    const sessionClient = createServerClient(url, anon, {
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

    const { error: signInError } = await sessionClient.auth.signInWithPassword({
      email,
      password,
    });
    if (signInError) {
      throw new Error(signInError.message);
    }

    console.log("=== Middleware navigation probe (staging Supabase) ===");
    console.log("Probe user:", email);

    const legacyRuns: TimedCounts[] = [];
    const optimizedRuns: TimedCounts[] = [];
    const legacyLayoutRuns: TimedCounts[] = [];

    for (let i = 0; i < 5; i += 1) {
      legacyRuns.push(await simulateLegacyMiddlewarePath(sessionClient, authUid));
      optimizedRuns.push(
        await simulateOptimizedMiddlewarePath(sessionClient, authUid),
      );
      legacyLayoutRuns.push(
        await simulateLegacyLayoutAuthPath(sessionClient, authUid),
      );
      await sleep(100);
    }

    function avg(runs: TimedCounts[]): TimedCounts {
      return {
        ms: Math.round(runs.reduce((s, r) => s + r.ms, 0) / runs.length),
        authCalls: runs[0].authCalls,
        dbCalls: runs[0].dbCalls,
      };
    }

    const legacy = avg(legacyRuns);
    const optimized = avg(optimizedRuns);
    const legacyLayout = avg(legacyLayoutRuns);

    console.log("\n--- In-process Supabase path (5-run avg) ---");
    console.log(
      JSON.stringify(
        {
          legacyMiddleware: legacy,
          optimizedMiddleware: optimized,
          legacyLayoutAuthOnly: legacyLayout,
          optimizedLayoutAuthOnly: {
            ms: 0,
            authCalls: 0,
            dbCalls: 0,
            note: "getUser + user_accounts skipped when signed x-dfoms-auth-context is trusted",
          },
          middlewareDbCallsReduced: legacy.dbCalls - optimized.dbCalls,
          middlewareMsDelta: legacy.ms - optimized.ms,
          layoutAuthDbCallsReduced: legacyLayout.authCalls + legacyLayout.dbCalls,
        },
        null,
        2,
      ),
    );

    const signed = await signAuthContext({
      authUid: authUid!,
      tenantId: DAVORS_TENANT_ID,
      role: "finance",
      employeeId: null,
      clientId: null,
      isActive: true,
      portal: "staff",
      email,
    });
    const verified = signed ? await verifyAuthContext(signed) : null;
    console.log(
      "\n--- Signed middleware → layout context ---",
      JSON.stringify(
        {
          signingConfigured: Boolean(signed),
          verified: Boolean(verified?.authUid === authUid),
        },
        null,
        2,
      ),
    );

    const liveArgIdx = process.argv.indexOf("--live");
    if (liveArgIdx >= 0) {
      const appUrl = process.argv[liveArgIdx + 1];
      if (!appUrl) {
        throw new Error("--live requires a base URL, e.g. http://localhost:3000");
      }

      const cookieHeader = buildCookieHeader(cookieStore);
      const paths = ["/dashboard", "/dashboard/finance"];

      console.log(`\n--- Live HTTP probe (${appUrl}) ---`);
      for (const path of paths) {
        const liveRuns = [];
        for (let i = 0; i < 3; i += 1) {
          liveRuns.push(await liveHttpProbe(appUrl, cookieHeader, path));
          await sleep(150);
        }
        const avgTotalMs = Math.round(
          liveRuns.reduce((s, r) => s + r.totalMs, 0) / liveRuns.length,
        );
        console.log(
          JSON.stringify(
            {
              path,
              avgTotalMs,
              sampleMiddlewareHeaders: liveRuns[liveRuns.length - 1],
            },
            null,
            2,
          ),
        );
      }
    } else {
      console.log(
        "\n(Skipping live HTTP probe — pass --live http://localhost:3000 with dev server + DFOMS_PERF_PROBE=true)",
      );
    }

    console.log("\n=== Expected Fix 2 targets ===");
    console.log(
      "Middleware: 4 calls (1 auth + 3 db) → 2 calls (1 auth + 1 db) for staff /dashboard/*",
    );
    console.log(
      "Layout auth/account: 2 calls → 0 when signed x-dfoms-auth-context header is trusted",
    );
  } finally {
    await cleanup();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
