/**
 * Production MFA enrollment census for lockout response.
 * Usage: npx tsx scripts/_census-mfa-production.ts --env-file .env.local.backup
 */
import { createClient } from "@supabase/supabase-js";
import { assert, loadEnvFromArgv } from "./lib/env";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";

async function main() {
  loadEnvFromArgv(process.argv);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  assert(url.includes(PRODUCTION_REF), "Refusing non-production");

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: settings, error } = await admin
    .from("user_mfa_settings")
    .select("auth_uid, method, sms_phone_e164, totp_enrolled_at, sms_phone_verified_at");

  if (error) throw new Error(error.message);

  const counts = { none: 0, totp: 0, sms: 0, other: 0 };
  for (const row of settings ?? []) {
    const m = row.method ?? "none";
    if (m in counts) counts[m as keyof typeof counts] += 1;
    else counts.other += 1;
  }

  console.log("\n=== MFA method counts (user_mfa_settings rows) ===");
  console.log(counts);
  console.log(`Total rows: ${settings?.length ?? 0}`);

  const smsUsers = (settings ?? []).filter((r) => r.method === "sms");
  const totpUsers = (settings ?? []).filter((r) => r.method === "totp");

  const authUids = [...new Set((settings ?? []).map((r) => r.auth_uid))];

  const { data: staffAccounts } = await admin
    .from("user_accounts")
    .select("auth_uid, tenant_id, email, is_active, role")
    .in("auth_uid", authUids.length ? authUids : ["00000000-0000-0000-0000-000000000000"]);

  const { data: tenants } = await admin.from("tenants").select("id, name, slug");
  const tenantName = new Map((tenants ?? []).map((t) => [t.id, t.name ?? t.slug ?? t.id]));

  const staffByUid = new Map(
    (staffAccounts ?? []).map((a) => [a.auth_uid, a]),
  );

  const { data: lessees } = await admin
    .from("lessees")
    .select("auth_user_id, tenant_id, lessee_name")
    .in("auth_user_id", authUids.length ? authUids : ["00000000-0000-0000-0000-000000000000"]);

  const { data: landlords } = await admin
    .from("landlords")
    .select("auth_user_id, tenant_id, landlord_name")
    .in("auth_user_id", authUids.length ? authUids : ["00000000-0000-0000-0000-000000000000"]);

  function personaFor(uid: string): string {
    if (staffByUid.has(uid)) return "staff";
    if ((lessees ?? []).some((l) => l.auth_user_id === uid)) return "lessee";
    if ((landlords ?? []).some((l) => l.auth_user_id === uid)) return "landlord";
    return "unknown";
  }

  function tenantFor(uid: string): string {
    const staff = staffByUid.get(uid);
    if (staff?.tenant_id) return tenantName.get(staff.tenant_id) ?? staff.tenant_id;
    const lessee = (lessees ?? []).find((l) => l.auth_user_id === uid);
    if (lessee?.tenant_id) return tenantName.get(lessee.tenant_id) ?? lessee.tenant_id;
    const landlord = (landlords ?? []).find((l) => l.auth_user_id === uid);
    if (landlord?.tenant_id) return tenantName.get(landlord.tenant_id) ?? landlord.tenant_id;
    return "(no tenant mapping)";
  }

  console.log("\n=== SMS MFA users (LOCKED OUT if Hubtel down) ===");
  for (const row of smsUsers) {
    console.log({
      auth_uid: row.auth_uid,
      persona: personaFor(row.auth_uid),
      tenant: tenantFor(row.auth_uid),
      phone: row.sms_phone_e164,
      sms_phone_verified_at: row.sms_phone_verified_at,
      staff_email: staffByUid.get(row.auth_uid)?.email ?? null,
      staff_active: staffByUid.get(row.auth_uid)?.is_active ?? null,
    });
  }

  console.log("\n=== TOTP MFA users (unaffected) ===");
  for (const row of totpUsers) {
    console.log({
      auth_uid: row.auth_uid,
      persona: personaFor(row.auth_uid),
      tenant: tenantFor(row.auth_uid),
      totp_enrolled_at: row.totp_enrolled_at,
      staff_email: staffByUid.get(row.auth_uid)?.email ?? null,
    });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
