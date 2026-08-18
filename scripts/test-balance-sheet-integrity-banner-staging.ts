/**
 * Staging: tenant isolation + banner data path for balance-sheet-integrity status.
 *
 *   npx tsx scripts/test-balance-sheet-integrity-banner-staging.ts --env-file .env.staging.local
 */
import { execFileSync } from "node:child_process";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { assert, loadEnvFromArgv } from "./lib/env";
import {
  buildTenantBalanceSheetIntegrityStatusFromMetadata,
} from "../utils/tenant-balance-sheet-integrity-status-core";
import { BS_INTEGRITY_EVENT_NAME } from "../utils/balance-sheet-integrity-constants";

const STAGING_APP_URL = (
  process.env.STAGING_APP_URL ??
  "https://dfoms-erp-git-staging-davorsghs-projects.vercel.app"
).replace(/\/$/, "");

const DAVORS = "00000001-0000-4000-8000-000000000001";
const CAANTA = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";
const PASSWORD = "BsBanner-Iso-7Kx9!";
const stamp = Date.now().toString(36);

async function fetchStatusForTenant(admin: SupabaseClient, tenantId: string) {
  const { data, error } = await admin
    .from("system_event_log")
    .select("status, metadata, created_at")
    .eq("event_name", BS_INTEGRITY_EVENT_NAME)
    .filter("metadata->>kind", "eq", "tenant")
    .filter("metadata->>tenantId", "eq", tenantId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  assert(!error, error?.message ?? "system_event_log query failed");
  if (!data) {
    return buildTenantBalanceSheetIntegrityStatusFromMetadata({
      metadata: null,
      createdAt: null,
      cronStatus: null,
    });
  }
  return buildTenantBalanceSheetIntegrityStatusFromMetadata({
    metadata: (data.metadata as Record<string, unknown> | null) ?? null,
    createdAt: data.created_at,
    cronStatus: data.status as "success" | "warning" | "failure",
  });
}

function resolveBypassSecret(): string {
  const existing = process.env.VERCEL_AUTOMATION_BYPASS_SECRET?.trim();
  if (existing) return existing;

  const raw = execFileSync(
    "npx",
    ["vercel", "project", "protection", "dfoms-erp", "--json"],
    { encoding: "utf8", shell: process.platform === "win32" },
  );
  const project = JSON.parse(raw.slice(raw.indexOf("{"))) as {
    protectionBypass?: Record<string, unknown>;
  };
  const secrets = Object.keys(project.protectionBypass ?? {});
  assert(secrets.length > 0, "No Vercel automation bypass secret");
  return secrets[0];
}

async function sessionCookie(
  admin: SupabaseClient,
  anon: SupabaseClient,
  email: string,
) {
  const { data: linkData, error } = await admin.auth.admin.generateLink({
    type: "magiclink",
    email,
    options: { redirectTo: `${STAGING_APP_URL}/dashboard` },
  });
  assert(!error && linkData?.properties?.hashed_token, error?.message ?? "generateLink failed");

  const { data: verifyData, error: verifyError } = await anon.auth.verifyOtp({
    token_hash: linkData.properties.hashed_token,
    type: "magiclink",
  });
  assert(!verifyError && verifyData.session, verifyError?.message ?? "verifyOtp failed");

  const projectRef = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split(
    ".",
  )[0];
  const cookieName = `sb-${projectRef}-auth-token`;
  const cookieValue = encodeURIComponent(
    JSON.stringify({
      access_token: verifyData.session.access_token,
      refresh_token: verifyData.session.refresh_token,
      expires_at: verifyData.session.expires_at,
      expires_in: verifyData.session.expires_in,
      token_type: "bearer",
      user: verifyData.session.user,
    }),
  );
  return `${cookieName}=${cookieValue}`;
}

async function fetchStatusRoute(
  cookieHeader: string,
  bypass: string,
  extraQuery = "",
) {
  const url = `${STAGING_APP_URL}/api/dashboard/balance-sheet-integrity-status${extraQuery}`;
  const resp = await fetch(url, {
    headers: {
      Cookie: cookieHeader,
      "x-vercel-protection-bypass": bypass,
    },
  });
  const body = (await resp.json().catch(() => null)) as Record<string, unknown> | null;
  return { status: resp.status, body };
}

async function createSuperAdmin(
  admin: SupabaseClient,
  tenantId: string,
  email: string,
) {
  const { data: authData, error: authError } = await admin.auth.admin.createUser({
    email,
    password: PASSWORD,
    email_confirm: true,
  });
  assert(!authError && authData.user, authError?.message ?? "auth create failed");
  const authUid = authData.user!.id;

  const { error: insertError } = await admin.from("user_accounts").insert({
    auth_uid: authUid,
    email,
    role: "super_admin",
    is_active: true,
    tenant_id: tenantId,
  });
  assert(!insertError, insertError?.message ?? "user_accounts insert failed");
  return authUid;
}

async function cleanupUser(admin: SupabaseClient, authUid: string) {
  await admin.from("user_accounts").delete().eq("auth_uid", authUid);
  await admin.auth.admin.deleteUser(authUid);
}

async function main() {
  loadEnvFromArgv(process.argv.slice(2));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ??
    "";
  assert(url.includes("wieflwbfdmjtsdnwbfii"), "Refusing non-staging Supabase");
  assert(serviceKey && anonKey.length > 20, "Missing staging keys");

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const anon = createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  console.log("=== Balance Sheet integrity banner — staging tests ===\n");

  const parsed = buildTenantBalanceSheetIntegrityStatusFromMetadata({
    metadata: {
      kind: "tenant",
      tenantId: CAANTA,
      fiscalYear: 2026,
      imbalances: [
        { monthIndex: 7, monthLabel: "Aug 2026", diff: -700 },
        { monthIndex: 6, monthLabel: "Jul 2026", diff: 331.25 },
      ],
      maxAbsDiff: 700,
    },
    createdAt: new Date().toISOString(),
    cronStatus: "failure",
  });
  assert(parsed.imbalancedMonthCount === 2, "metadata parser count");
  assert(parsed.worstMonthLabel === "Aug 2026", "metadata parser worst month");
  assert(parsed.worstDiff === 700, "metadata parser worst diff");
  console.log("PASS — metadata parser (balanced + imbalanced payloads)");

  const balanced = buildTenantBalanceSheetIntegrityStatusFromMetadata({
    metadata: {
      kind: "tenant",
      tenantId: DAVORS,
      fiscalYear: 2026,
      imbalances: [],
      maxAbsDiff: 0,
    },
    createdAt: new Date().toISOString(),
    cronStatus: "success",
  });
  assert(balanced.imbalancedMonthCount === 0, "balanced tenant count");
  assert(balanced.worstDiff === 0, "balanced tenant worst diff");
  console.log("PASS — successful/balanced cron row maps to clean state");

  const davorsStatus = await fetchStatusForTenant(admin, DAVORS);
  const caantaStatus = await fetchStatusForTenant(admin, CAANTA);
  console.log(
    `INFO — helper Davors: count=${davorsStatus.imbalancedMonthCount}, hasCron=${davorsStatus.hasCronResult}`,
  );
  console.log(
    `INFO — helper Caanta: count=${caantaStatus.imbalancedMonthCount}, worst=${caantaStatus.worstDiff}, month=${caantaStatus.worstMonthLabel ?? "n/a"}`,
  );

  const davorsEmail = `bs.banner.davors.${stamp}@test.davors`;
  const caantaEmail = `bs.banner.caanta.${stamp}@test.davors`;
  let davorsUid: string | null = null;
  let caantaUid: string | null = null;

  try {
    davorsUid = await createSuperAdmin(admin, DAVORS, davorsEmail);
    caantaUid = await createSuperAdmin(admin, CAANTA, caantaEmail);

    const bypass = resolveBypassSecret();
    const davorsCookie = await sessionCookie(admin, anon, davorsEmail);
    const caantaCookie = await sessionCookie(admin, anon, caantaEmail);

    const davorsRoute = await fetchStatusRoute(davorsCookie, bypass);
    assert(davorsRoute.status === 200, `Davors route HTTP ${davorsRoute.status}`);
    const caantaRoute = await fetchStatusRoute(caantaCookie, bypass);
    assert(caantaRoute.status === 200, `Caanta route HTTP ${caantaRoute.status}`);

    const davorsBody = davorsRoute.body as {
      imbalancedMonthCount: number;
      imbalances: unknown[];
    };
    const caantaBody = caantaRoute.body as {
      imbalancedMonthCount: number;
      imbalances: unknown[];
    };

    assert(
      davorsBody.imbalancedMonthCount === davorsStatus.imbalancedMonthCount,
      "Davors route must match helper for session tenant",
    );
    assert(
      caantaBody.imbalancedMonthCount === caantaStatus.imbalancedMonthCount,
      "Caanta route must match helper for session tenant",
    );
    console.log("PASS — API route returns session tenant cron snapshot");

    const spoofAttempt = await fetchStatusRoute(
      davorsCookie,
      bypass,
      `?tenantId=${CAANTA}`,
    );
    assert(spoofAttempt.status === 200, "spoof query should still 200");
    const spoofBody = spoofAttempt.body as { imbalancedMonthCount: number };
    assert(
      spoofBody.imbalancedMonthCount === davorsStatus.imbalancedMonthCount,
      "Client-supplied tenantId query must be ignored — Davors session saw Caanta data",
    );
    console.log("PASS — tenant isolation: query tenantId spoof ignored");

    assert(
      JSON.stringify(davorsBody) !== JSON.stringify(caantaBody) ||
        davorsStatus.imbalancedMonthCount === caantaStatus.imbalancedMonthCount,
      "Cross-tenant payload leak when tenants differ",
    );
    if (davorsStatus.imbalancedMonthCount !== caantaStatus.imbalancedMonthCount) {
      console.log("PASS — Davors and Caanta routes return different tenant snapshots");
    } else {
      console.log(
        "SKIP — both tenants currently share same imbalance count in cron metadata",
      );
    }

    const unauth = await fetch(`${STAGING_APP_URL}/api/dashboard/balance-sheet-integrity-status`, {
      headers: { "x-vercel-protection-bypass": bypass },
    });
    assert(unauth.status === 401, `Unauthenticated must 401, got ${unauth.status}`);
    console.log("PASS — unauthenticated request rejected");
  } finally {
    if (davorsUid) await cleanupUser(admin, davorsUid);
    if (caantaUid) await cleanupUser(admin, caantaUid);
  }

  console.log("\nAll banner staging checks passed.");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
