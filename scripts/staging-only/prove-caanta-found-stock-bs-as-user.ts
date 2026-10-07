/**
 * Caanta staging: HTTP found_stock (same API as UI) + Facilities-scoped BS check.
 *
 * npx tsx scripts/staging-only/prove-caanta-found-stock-bs-as-user.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { fetchBalanceSheetPageData } from "../../app/dashboard/finance/balance-sheet-page-data";
import {
  buildStandardBalanceSheetReport,
  getBalanceSheetMonthCheck,
} from "../../lib/finance/balance-sheet-standard-report";
import { getBalanceSheetAmountForMonth } from "../../app/dashboard/finance/balance-sheet-utils";

config({ path: resolve(process.cwd(), ".env.staging.local") });

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const CAANTA = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";
const FY = 2026;
const OCT = 9;
const APP_URL = (process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "");

async function sessionCookie(client: SupabaseClient): Promise<string> {
  const { data } = await client.auth.getSession();
  const session = data.session;
  if (!session) throw new Error("No session");
  const cookieProject = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL!).hostname.split(
    ".",
  )[0];
  return `sb-${cookieProject}-auth-token=${encodeURIComponent(
    JSON.stringify({
      access_token: session.access_token,
      refresh_token: session.refresh_token,
      expires_at: session.expires_at,
      expires_in: session.expires_in,
      token_type: "bearer",
      user: session.user,
    }),
  )}`;
}

async function setActiveBusinessUnit(cookie: string, businessUnitId: string) {
  const res = await fetch(`${APP_URL}/api/account/active-business-unit`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({ selection: "unit", business_unit_id: businessUnitId }),
  });
  if (!res.ok) {
    const payload = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(payload.error ?? `active-business-unit ${res.status}`);
  }
}

function printBs(report: ReturnType<typeof buildStandardBalanceSheetReport>, label: string) {
  const check = getBalanceSheetMonthCheck(report, OCT);
  console.log(`\n=== ${label} Oct 2026 BS check ===`);
  console.log(
    `diff=${check.difference} assets=${check.totalAssets} L+E=${check.totalLiabilitiesAndEquity} balanced=${check.isBalanced}`,
  );
  for (const key of [
    "inventory",
    "retained-earnings",
    "inventory-opening-equity",
    "inventory-adjustment-opening-equity",
  ] as const) {
    const row = report.rows.find((r) => r.key === key);
    if (row) {
      console.log(`${key}: ${getBalanceSheetAmountForMonth(row, OCT)}`);
    }
  }
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  if (!url.includes(STAGING_REF)) {
    throw new Error("Staging only");
  }

  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const { data: bu } = await admin
    .from("business_units")
    .select("id, name")
    .eq("tenant_id", CAANTA)
    .limit(1)
    .maybeSingle();
  const { data: fp } = await admin
    .from("finished_products")
    .select("id, product_code")
    .eq("tenant_id", CAANTA)
    .limit(1)
    .maybeSingle();

  if (!bu?.id || !fp?.id) {
    throw new Error("Caanta needs at least one BU and finished product on staging");
  }

  const stamp = Date.now();
  const email = `found-stock-bs.${stamp}@test.davors`;
  const password = `FsBs-${stamp}!Aa9`;
  const { data: userData, error: userErr } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { portal: "staff" },
  });
  if (userErr || !userData.user) throw userErr ?? new Error("createUser");

  await admin.from("user_accounts").insert({
    auth_uid: userData.user.id,
    email,
    tenant_id: CAANTA,
    role: "super_admin",
    is_active: true,
  });

  const client = createClient(url, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!, {
    auth: { persistSession: false },
  });
  const { error: signErr } = await client.auth.signInWithPassword({ email, password });
  if (signErr) throw signErr;

  const buId = bu.id;
  const beforeData = await fetchBalanceSheetPageData(admin, CAANTA, {
    activeBusinessUnitId: buId,
    viewAllBusinessUnits: false,
  });
  const beforeReport = buildStandardBalanceSheetReport(beforeData, CAANTA, FY);
  printBs(beforeReport, "BEFORE found_stock");

  const cookie = await sessionCookie(client);
  await setActiveBusinessUnit(cookie, buId);

  const qty = 5;
  const cost = 0.79;
  const res = await fetch(`${APP_URL}/api/inventory/finished-product-adjustments`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Cookie: cookie },
    body: JSON.stringify({
      product_id: fp.id,
      adjustment_type: "found_stock",
      quantity_delta: qty,
      cost_per_unit: cost,
      reason: `Caanta found stock BS proof ${stamp}`,
    }),
  });
  const payload = (await res.json().catch(() => ({}))) as {
    error?: string;
    adjustment?: { id?: string };
  };
  if (!res.ok) {
    throw new Error(payload.error ?? String(res.status));
  }
  console.log(`\nCreated adjustment ${payload.adjustment?.id ?? "?"}`);

  const afterData = await fetchBalanceSheetPageData(admin, CAANTA, {
    activeBusinessUnitId: buId,
    viewAllBusinessUnits: false,
  });
  const afterReport = buildStandardBalanceSheetReport(afterData, CAANTA, FY);
  printBs(afterReport, "AFTER found_stock");

  const afterCheck = getBalanceSheetMonthCheck(afterReport, OCT);
  const invDelta =
    getBalanceSheetAmountForMonth(
      afterReport.rows.find((r) => r.key === "inventory")!,
      OCT,
    ) -
    getBalanceSheetAmountForMonth(
      beforeReport.rows.find((r) => r.key === "inventory")!,
      OCT,
    );
  const expected = Math.round(qty * cost * 100) / 100;
  console.log(`\nInventory line delta: ${invDelta} (expected +${expected})`);

  if (!afterCheck.isBalanced) {
    console.error(`FAIL: out of balance by ${afterCheck.difference}`);
    process.exit(1);
  }
  if (Math.abs(invDelta - expected) > 0.02) {
    console.error(`FAIL: inventory did not increase by ${expected}`);
    process.exit(1);
  }
  console.log("\nPASS: found_stock balances Oct BS on Caanta.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
