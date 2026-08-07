/**
 * Inspect (and optionally clean) Supabase Auth MFA factors on production.
 *
 * Usage:
 *   npx tsx scripts/inspect-user-mfa-factors-production.ts david.avors@gmail.com
 *   npx tsx scripts/inspect-user-mfa-factors-production.ts david.avors@gmail.com --delete-unverified
 */
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadEnvForce } from "./lib/env";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const TOTP_FRIENDLY_NAME = "Authenticator app";

async function findUserIdByEmail(
  admin: ReturnType<typeof createClient<any>>,
  email: string,
): Promise<string | null> {
  let page = 1;
  const perPage = 200;
  while (true) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage });
    if (error) throw error;
    const match = data.users.find(
      (u) => u.email?.toLowerCase() === email.toLowerCase(),
    );
    if (match) return match.id;
    if (data.users.length < perPage) break;
    page += 1;
  }
  return null;
}

async function main() {
  const email = process.argv[2];
  const deleteUnverified = process.argv.includes("--delete-unverified");
  if (!email) {
    throw new Error(
      "Usage: npx tsx scripts/inspect-user-mfa-factors-production.ts <email> [--delete-unverified]",
    );
  }

  loadEnvForce(resolve(process.cwd(), ".env.local.backup"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url.includes(PRODUCTION_REF)) {
    throw new Error("Refusing: .env.local.backup is not production");
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const userId = await findUserIdByEmail(admin, email);
  if (!userId) throw new Error(`User not found: ${email}`);

  const { data: settings } = await admin
    .from("user_mfa_settings")
    .select("method, totp_enrolled_at, updated_at")
    .eq("auth_uid", userId)
    .maybeSingle();

  const { data: factorsData, error: factorsError } =
    await admin.auth.admin.mfa.listFactors({ userId });
  if (factorsError) throw factorsError;

  const factors = factorsData?.factors ?? [];
  console.log(
    JSON.stringify(
      {
        email,
        authUid: userId,
        user_mfa_settings: settings ?? null,
        factors: factors.map((f) => ({
          id: f.id,
          friendly_name: f.friendly_name,
          factor_type: f.factor_type,
          status: f.status,
          created_at: f.created_at,
          updated_at: f.updated_at,
        })),
      },
      null,
      2,
    ),
  );

  if (!deleteUnverified) return;

  const stale = factors.filter(
    (f) =>
      f.factor_type === "totp" &&
      f.status === "unverified" &&
      f.friendly_name === TOTP_FRIENDLY_NAME,
  );

  if (stale.length === 0) {
    console.log("No stale unverified TOTP factors to delete.");
    return;
  }

  for (const factor of stale) {
    const { data, error } = await admin.auth.admin.mfa.deleteFactor({
      id: factor.id,
      userId,
    });
    if (error) throw error;
    console.log("Deleted stale factor:", {
      id: factor.id,
      deleted: data?.id ?? factor.id,
      friendly_name: factor.friendly_name,
      status: factor.status,
      created_at: factor.created_at,
    });
  }

  const { data: after, error: afterError } =
    await admin.auth.admin.mfa.listFactors({ userId });
  if (afterError) throw afterError;
  console.log(
    "After cleanup:",
    JSON.stringify(
      (after?.factors ?? []).map((f) => ({
        id: f.id,
        friendly_name: f.friendly_name,
        status: f.status,
      })),
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
