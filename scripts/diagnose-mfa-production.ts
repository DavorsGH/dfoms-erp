/**
 * Production MFA diagnostic: user_mfa_settings + auth factors + mismatch scan.
 * Usage: npx tsx scripts/diagnose-mfa-production.ts [email...]
 */
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { connectPg } from "./lib/pg-connect";
import { loadEnvForce } from "./lib/env";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const DEFAULT_EMAILS = ["david.avors@gmail.com", "info@caanta.com"];

async function findUserIdByEmail(
  admin: ReturnType<typeof createClient<any>>,
  email: string,
): Promise<{ id: string; email: string } | null> {
  let page = 1;
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) throw error;
    const match = data.users.find(
      (u) => u.email?.toLowerCase() === email.toLowerCase(),
    );
    if (match?.email) return { id: match.id, email: match.email };
    if (data.users.length < 200) break;
    page += 1;
  }
  return null;
}

async function inspectUser(
  admin: ReturnType<typeof createClient<any>>,
  pg: Awaited<ReturnType<typeof connectPg>>["client"],
  email: string,
) {
  const user = await findUserIdByEmail(admin, email);
  if (!user) {
    console.log(`\n=== ${email} === NOT FOUND`);
    return null;
  }

  const { rows: settingsRows } = await pg.query(
    `SELECT auth_uid, method, sms_phone_e164, sms_phone_verified_at, totp_enrolled_at, updated_at
     FROM public.user_mfa_settings WHERE auth_uid = $1`,
    [user.id],
  );

  const { data: factorsData, error: factorsError } =
    await admin.auth.admin.mfa.listFactors({ userId: user.id });
  if (factorsError) throw factorsError;

  const factors = factorsData?.factors ?? [];
  const verifiedTotp = factors.filter(
    (f) => f.factor_type === "totp" && f.status === "verified",
  );
  const unverifiedTotp = factors.filter(
    (f) => f.factor_type === "totp" && f.status === "unverified",
  );

  const settings = settingsRows[0] ?? null;
  const mismatch: string[] = [];
  if (settings?.method === "totp" && verifiedTotp.length === 0) {
    mismatch.push("DB method=totp but no verified TOTP factor in Auth");
  }
  if (settings?.method === "none" && verifiedTotp.length > 0) {
    mismatch.push("DB method=none but verified TOTP factor exists in Auth");
  }
  if (settings?.method === "sms" && !settings?.sms_phone_e164) {
    mismatch.push("DB method=sms but sms_phone_e164 is null");
  }
  if (settings?.method === "none" && unverifiedTotp.length > 0) {
    mismatch.push("DB method=none but unverified TOTP factor(s) block re-enroll");
  }
  if (verifiedTotp.length > 0 && settings?.method !== "totp") {
    mismatch.push(
      `verified TOTP in Auth but DB method=${settings?.method ?? "missing"}`,
    );
  }

  console.log(`\n=== ${email} (${user.id}) ===`);
  console.log(
    JSON.stringify(
      {
        user_mfa_settings: settings,
        auth_factors: factors.map((f) => ({
          id: f.id,
          friendly_name: f.friendly_name,
          factor_type: f.factor_type,
          status: f.status,
          created_at: f.created_at,
          updated_at: f.updated_at,
        })),
        mismatch,
      },
      null,
      2,
    ),
  );

  return { user, settings, factors, mismatch };
}

async function scanMismatches(
  admin: ReturnType<typeof createClient<any>>,
  pg: Awaited<ReturnType<typeof connectPg>>["client"],
) {
  const { rows: allSettings } = await pg.query(
    `SELECT auth_uid, method, sms_phone_e164, totp_enrolled_at
     FROM public.user_mfa_settings
     WHERE method <> 'none'
     ORDER BY updated_at DESC`,
  );

  type SettingsRow = {
    auth_uid: string;
    method: string;
    sms_phone_e164: string | null;
    totp_enrolled_at: string | null;
  };

  const broken: Array<{
    auth_uid: string;
    method: string;
    issue: string;
  }> = [];

  for (const row of allSettings as SettingsRow[]) {
    const { data, error } = await admin.auth.admin.mfa.listFactors({
      userId: row.auth_uid,
    });
    if (error) continue;
    const factors = data?.factors ?? [];
    const verifiedTotp = factors.filter(
      (f) => f.factor_type === "totp" && f.status === "verified",
    );
    if (row.method === "totp" && verifiedTotp.length === 0) {
      broken.push({
        auth_uid: row.auth_uid,
        method: row.method,
        issue: "method=totp, no verified Auth TOTP factor",
      });
    }
    if (row.method === "sms" && !row.sms_phone_e164) {
      broken.push({
        auth_uid: row.auth_uid,
        method: row.method,
        issue: "method=sms, sms_phone_e164 null",
      });
    }
  }

  // Users with verified TOTP in Auth but method none/missing
  let page = 1;
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) throw error;
    for (const u of data.users) {
      const { data: fd } = await admin.auth.admin.mfa.listFactors({
        userId: u.id,
      });
      const verifiedTotp =
        fd?.factors?.filter(
          (f) => f.factor_type === "totp" && f.status === "verified",
        ) ?? [];
      const unverifiedTotp =
        fd?.factors?.filter(
          (f) => f.factor_type === "totp" && f.status === "unverified",
        ) ?? [];
      if (verifiedTotp.length === 0 && unverifiedTotp.length === 0) continue;

      const setting = (allSettings as SettingsRow[]).find(
        (s) => s.auth_uid === u.id,
      );
      if (
        verifiedTotp.length > 0 &&
        (!setting || setting.method !== "totp")
      ) {
        broken.push({
          auth_uid: u.id,
          method: setting?.method ?? "(no row)",
          issue: `verified TOTP in Auth for ${u.email}, DB not totp`,
        });
      }
      if (unverifiedTotp.length > 0 && (!setting || setting.method === "none")) {
        broken.push({
          auth_uid: u.id,
          method: setting?.method ?? "(no row)",
          issue: `stale unverified TOTP for ${u.email}`,
        });
      }
    }
    if (data.users.length < 200) break;
    page += 1;
  }

  console.log("\n=== MISMATCH SCAN (production) ===");
  console.log(
    JSON.stringify(
      {
        enrolled_settings_count: allSettings.length,
        broken_count: broken.length,
        broken,
      },
      null,
      2,
    ),
  );
}

async function main() {
  const argvEmails = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  const emails = argvEmails.length > 0 ? argvEmails : DEFAULT_EMAILS;

  loadEnvForce(resolve(process.cwd(), ".env.local.backup"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url.includes(PRODUCTION_REF)) {
    throw new Error("Refusing: not production env");
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { client: pg } = await connectPg({
    envFiles: [".env.local.backup"],
    requiredProjectRef: PRODUCTION_REF,
  });

  try {
    console.log("MFA_ENFORCEMENT (local runner):", process.env.MFA_ENFORCEMENT ?? "(unset)");
    for (const email of emails) {
      await inspectUser(admin, pg, email);
    }
    await scanMismatches(admin, pg);
  } finally {
    await pg.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
