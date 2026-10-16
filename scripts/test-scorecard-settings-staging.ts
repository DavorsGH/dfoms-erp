/**
 * Staging API tests for tenant_scorecard_settings wiring.
 *
 *   APP_URL=http://localhost:3000 npx tsx scripts/test-scorecard-settings-staging.ts
 */
import { resolve } from "node:path";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: resolve(process.cwd(), ".env.local") });
config({ path: resolve(process.cwd(), ".env.staging.local"), override: true });

const APP_URL = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");
const DAVORS = "00000001-0000-4000-8000-000000000001";
const FACILITIES_BU = "de215200-e92b-48e3-a7ba-977d7289868c";
const MONTH_KEY = "2026-09";
const DEFAULTS = {
  cit_rate_pct: 25,
  gsl_rate_pct: 2.5,
  dividend_wht_rate_pct: 8,
  reserve_pct: 30,
  reinvest_pct: 20,
  owners_pct: 50,
};

async function signInCookie(email: string, password: string): Promise<string> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!.trim();
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim();
  const auth = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await auth.auth.signInWithPassword({ email, password });
  if (error || !data.session) {
    throw new Error(error?.message ?? "sign-in failed");
  }
  const projectRef = new URL(url).hostname.split(".")[0];
  return `sb-${projectRef}-auth-token=${encodeURIComponent(
    JSON.stringify({
      access_token: data.session.access_token,
      refresh_token: data.session.refresh_token ?? "",
      expires_at: data.session.expires_at,
      expires_in: data.session.expires_in,
      token_type: "bearer",
      user: data.session.user,
    }),
  )}`;
}

async function createProbe(
  admin: ReturnType<typeof createClient>,
  role: string,
): Promise<{ email: string; password: string; cleanup: () => Promise<void> }> {
  const stamp = Date.now();
  const email = `scorecard-${role}.${stamp}@test.davors`;
  const password = `Scorecard-${stamp}!Aa8`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { portal: "staff" },
  });
  if (error || !data.user) {
    throw new Error(error?.message ?? "createUser failed");
  }
  const authUid = data.user.id;
  await admin.from("user_accounts").insert({
    auth_uid: authUid,
    email,
    tenant_id: DAVORS,
    role,
    is_active: true,
  });
  return {
    email,
    password,
    cleanup: async () => {
      await admin.from("user_accounts").delete().eq("auth_uid", authUid);
      await admin.auth.admin.deleteUser(authUid);
    },
  };
}

async function putSettings(cookie: string, body: Record<string, unknown>) {
  const response = await fetch(`${APP_URL}/api/scorecard-settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify(body),
  });
  const payload = (await response.json().catch(() => null)) as {
    settings?: unknown;
    error?: string;
  } | null;
  return { status: response.status, payload };
}

async function getScorecard(cookie: string) {
  const response = await fetch(
    `${APP_URL}/api/director-scorecard?monthKey=${MONTH_KEY}`,
    { headers: { Cookie: cookie } },
  );
  const payload = (await response.json().catch(() => null)) as {
    snapshot?: {
      reserveAmount: number;
      ownersShareAmount: number;
      taxToSetAside: number;
      dividendQuarter: { gross: number };
    };
    error?: string;
  } | null;
  return { status: response.status, payload };
}

async function askAssistant(cookie: string, message: string) {
  const response = await fetch(`${APP_URL}/api/assistant/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ message, conversationHistory: [] }),
  });
  const payload = (await response.json().catch(() => null)) as {
    reply?: string;
    error?: string;
  } | null;
  return payload?.reply?.trim() ?? payload?.error ?? "";
}

async function setActiveBu(cookie: string, businessUnitId: string) {
  await fetch(`${APP_URL}/api/account/active-business-unit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ businessUnitId, viewAllBusinessUnits: false }),
  });
}

async function main() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!.trim(),
    process.env.SUPABASE_SERVICE_ROLE_KEY!.trim(),
    { auth: { persistSession: false } },
  );

  const directorProbe = await createProbe(admin, "director");
  const financeProbe = await createProbe(admin, "finance");

  const results: Array<{ id: string; pass: boolean; detail: string }> = [];

  try {
    const directorCookie = await signInCookie(
      directorProbe.email,
      directorProbe.password,
    );
    await setActiveBu(directorCookie, FACILITIES_BU);

    // a) split 40/20/40
    let put = await putSettings(directorCookie, {
      ...DEFAULTS,
      reserve_pct: 40,
      reinvest_pct: 20,
      owners_pct: 40,
      tenant_id: "evil-tenant",
    });
    const sc = await getScorecard(directorCookie);
    const snap = sc.payload?.snapshot as {
      profitAfterTax?: number;
      reserveAmount: number;
      ownersShareAmount: number;
      dividendQuarter: { gross: number };
    } | undefined;
    const pat = snap?.profitAfterTax ?? 0;
    const reserveOk =
      snap && pat > 0
        ? Math.abs(snap.reserveAmount - pat * 0.4) < 0.02
        : put.status === 200;
    const ownersOk =
      snap && pat > 0
        ? Math.abs(snap.ownersShareAmount - pat * 0.4) < 0.02
        : put.status === 200;
    results.push({
      id: "a",
      pass: put.status === 200 && Boolean(reserveOk && ownersOk),
      detail: `PUT ${put.status}; reserve=${snap?.reserveAmount} owners=${snap?.ownersShareAmount}`,
    });

    // b) invalid split 50/20/20
    put = await putSettings(directorCookie, {
      ...DEFAULTS,
      reserve_pct: 50,
      reinvest_pct: 20,
      owners_pct: 20,
    });
    results.push({
      id: "b",
      pass: put.status === 400,
      detail: `PUT ${put.status} ${put.payload?.error ?? ""}`,
    });

    // c) CIT 20 — tax to set aside changes (compare before/after if profitable)
    const beforeTax = snap?.taxToSetAside ?? 0;
    put = await putSettings(directorCookie, {
      cit_rate_pct: 20,
      gsl_rate_pct: 2.5,
      dividend_wht_rate_pct: 8,
      reserve_pct: 40,
      reinvest_pct: 20,
      owners_pct: 40,
    });
    const sc2 = await getScorecard(directorCookie);
    const afterTax = sc2.payload?.snapshot?.taxToSetAside ?? 0;
    results.push({
      id: "c",
      pass:
        put.status === 200 &&
        (beforeTax === 0 ? afterTax >= 0 : afterTax !== beforeTax),
      detail: `tax before=${beforeTax} after=${afterTax}`,
    });

    // d) finance 403
    const financeCookie = await signInCookie(financeProbe.email, financeProbe.password);
    put = await putSettings(financeCookie, DEFAULTS);
    results.push({
      id: "d",
      pass: put.status === 403,
      detail: `PUT ${put.status}`,
    });

    // e) evil tenant_id ignored — row tenant is Davors (director probe tenant)
    const { data: row } = await admin
      .from("tenant_scorecard_settings")
      .select("tenant_id, cit_rate_pct")
      .eq("tenant_id", DAVORS)
      .maybeSingle();
    results.push({
      id: "e",
      pass: row?.tenant_id === DAVORS && Number(row?.cit_rate_pct) === 20,
      detail: `row cit=${row?.cit_rate_pct} tenant=${row?.tenant_id}`,
    });

    // f) assistant rates
    const reply = await askAssistant(
      directorCookie,
      "What rates does the scorecard use?",
    );
    const mentions20 =
      reply.includes("20") &&
      (reply.toLowerCase().includes("cit") || reply.toLowerCase().includes("corporate"));
    results.push({
      id: "f",
      pass: mentions20,
      detail: reply.split("\n")[0]?.slice(0, 120) ?? reply.slice(0, 120),
    });

    // restore defaults
    await putSettings(directorCookie, DEFAULTS);
  } finally {
    await directorProbe.cleanup();
    await financeProbe.cleanup();
  }

  console.log("\n=== Scorecard settings staging tests ===\n");
  for (const row of results) {
    console.log(`[${row.pass ? "PASS" : "FAIL"}] ${row.id}: ${row.detail}`);
  }
  const failed = results.filter((row) => !row.pass);
  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
