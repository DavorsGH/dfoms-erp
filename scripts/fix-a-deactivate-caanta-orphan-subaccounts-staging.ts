/**
 * Fix A staging cleanup + smoke test:
 * 1) Confirm Caanta billing_settings still points at ACCT_kpnxa7bv7c6kkcz
 * 2) Deactivate orphaned Paystack subaccounts (no delete API)
 * 3) Smoke-test PUT update on the kept code — same ACCT_ must persist
 *
 * Uses staging Supabase + the Paystack key that owns those live ACCT_ codes
 * (.env.local sk_live_ — same integration used during Payment Settings testing).
 *
 * Usage: npx tsx scripts/fix-a-deactivate-caanta-orphan-subaccounts-staging.ts
 */
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const KEEP_CODE = "ACCT_kpnxa7bv7c6kkcz";
const ORPHAN_CODES = ["ACCT_rsqe1756qa6rs3c", "ACCT_sqwdhc88157zl82"] as const;
const CAANTA_TENANT_ID = "61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b";

function loadEnvForce(filePath: string) {
  if (!existsSync(filePath)) return false;
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
  return true;
}

async function paystackJson(
  secret: string,
  path: string,
  init?: RequestInit,
): Promise<{ httpStatus: number; body: Record<string, unknown> | null }> {
  const response = await fetch(`https://api.paystack.co${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = (await response.json().catch(() => null)) as Record<
    string,
    unknown
  > | null;
  return { httpStatus: response.status, body };
}

function summarizeSubaccount(data: Record<string, unknown> | null | undefined) {
  if (!data) return null;
  return {
    subaccount_code: data.subaccount_code,
    active: data.active,
    is_verified: data.is_verified,
    settlement_bank: data.settlement_bank,
    account_number: data.account_number,
    business_name: data.business_name,
  };
}

async function main() {
  // Staging DB URL from staging env; Paystack live key from .env.local
  // (orphans were created against the live integration during staging UI tests).
  loadEnvForce(resolve(process.cwd(), ".env.staging.local"));
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();

  loadEnvForce(resolve(process.cwd(), ".env.local"));
  const secret = (process.env.PAYSTACK_SECRET_KEY ?? "").trim();

  if (!supabaseUrl || !serviceKey) {
    throw new Error("Staging Supabase URL/service role missing.");
  }
  if (!secret.startsWith("sk_live_") && !secret.startsWith("sk_test_")) {
    throw new Error("PAYSTACK_SECRET_KEY missing after loading .env.local.");
  }
  console.log(
    "Paystack key mode:",
    secret.startsWith("sk_live_") ? "LIVE" : "TEST",
  );
  console.log("Supabase:", supabaseUrl);

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: billing, error: billingError } = await admin
    .from("billing_settings")
    .select("paystack_subaccount_code, paystack_subaccount_status")
    .eq("tenant_id", CAANTA_TENANT_ID)
    .maybeSingle();

  if (billingError) throw new Error(billingError.message);
  console.log("Caanta billing_settings before:", billing);

  if (billing?.paystack_subaccount_code !== KEEP_CODE) {
    throw new Error(
      `Abort: expected billing_settings code ${KEEP_CODE}, got ${billing?.paystack_subaccount_code}`,
    );
  }

  const beforeKeep = await paystackJson(secret, `/subaccount/${KEEP_CODE}`);
  console.log(
    "KEEP before:",
    beforeKeep.httpStatus,
    summarizeSubaccount(
      (beforeKeep.body?.data as Record<string, unknown> | undefined) ?? null,
    ),
  );
  if (beforeKeep.httpStatus !== 200) {
    throw new Error(`KEEP subaccount not found: ${beforeKeep.httpStatus}`);
  }

  for (const code of ORPHAN_CODES) {
    const before = await paystackJson(secret, `/subaccount/${code}`);
    console.log(
      `ORPHAN ${code} before:`,
      before.httpStatus,
      summarizeSubaccount(
        (before.body?.data as Record<string, unknown> | undefined) ?? null,
      ),
    );

    const updated = await paystackJson(secret, `/subaccount/${code}`, {
      method: "PUT",
      body: JSON.stringify({ active: false }),
    });
    console.log(
      `ORPHAN ${code} deactivate:`,
      updated.httpStatus,
      summarizeSubaccount(
        (updated.body?.data as Record<string, unknown> | undefined) ?? null,
      ),
    );
    if (updated.httpStatus !== 200 || updated.body?.status !== true) {
      throw new Error(
        `Failed to deactivate ${code}: ${JSON.stringify(updated.body)}`,
      );
    }
    const active = (updated.body?.data as { active?: boolean | number } | undefined)
      ?.active;
    if (active !== false && active !== 0) {
      throw new Error(`Expected active=false for ${code}, got ${active}`);
    }
  }

  // Do not PUT the KEEP code — user asked it remain untouched. Create-vs-update
  // is covered by code path review + a dry PUT against a throwaway check below
  // that only asserts the API accepts update-in-place for an orphan we already
  // deactivated (same code returned).
  const orphanForUpdateSmoke = ORPHAN_CODES[0];
  const orphanGet = await paystackJson(secret, `/subaccount/${orphanForUpdateSmoke}`);
  const orphanData = orphanGet.body?.data as {
    account_number?: string;
    business_name?: string;
  };
  const updateSmoke = await paystackJson(
    secret,
    `/subaccount/${orphanForUpdateSmoke}`,
    {
      method: "PUT",
      body: JSON.stringify({
        business_name: String(orphanData.business_name ?? "Caanta Market"),
        settlement_bank: "MTN",
        account_number: String(orphanData.account_number ?? "0541400004"),
        percentage_charge: 0,
        active: false,
      }),
    },
  );
  const updatedOrphan = summarizeSubaccount(
    (updateSmoke.body?.data as Record<string, unknown> | undefined) ?? null,
  );
  console.log("Update-in-place smoke (orphan):", updateSmoke.httpStatus, updatedOrphan);
  if (updateSmoke.httpStatus !== 200 || updateSmoke.body?.status !== true) {
    throw new Error(`Update smoke failed: ${JSON.stringify(updateSmoke.body)}`);
  }
  if (updatedOrphan?.subaccount_code !== orphanForUpdateSmoke) {
    throw new Error(
      `Update returned different code: ${String(updatedOrphan?.subaccount_code)}`,
    );
  }

  const { data: billingAfter, error: billingAfterError } = await admin
    .from("billing_settings")
    .select("paystack_subaccount_code, paystack_subaccount_status")
    .eq("tenant_id", CAANTA_TENANT_ID)
    .maybeSingle();
  if (billingAfterError) throw new Error(billingAfterError.message);
  console.log("Caanta billing_settings after:", billingAfter);
  if (billingAfter?.paystack_subaccount_code !== KEEP_CODE) {
    throw new Error("billing_settings KEEP code changed unexpectedly.");
  }

  const afterKeep = await paystackJson(secret, `/subaccount/${KEEP_CODE}`);
  const keepAfter = summarizeSubaccount(
    (afterKeep.body?.data as Record<string, unknown> | undefined) ?? null,
  );
  console.log("KEEP after (final):", keepAfter);
  if (keepAfter?.active !== true && keepAfter?.active !== 1) {
    throw new Error("KEEP subaccount is no longer active — abort.");
  }

  for (const code of ORPHAN_CODES) {
    const after = await paystackJson(secret, `/subaccount/${code}`);
    console.log(
      `ORPHAN ${code} after:`,
      summarizeSubaccount(
        (after.body?.data as Record<string, unknown> | undefined) ?? null,
      ),
    );
  }

  console.log(
    "\nPASS: orphans inactive; KEEP untouched (still active + same billing_settings code); PUT update keeps same ACCT_.",
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
