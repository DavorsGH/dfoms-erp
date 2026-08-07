/**
 * MFA portal-flow matrix checks (staging) — lessee + landlord schema/helpers.
 * Usage: npx tsx scripts/test-mfa-portal-flow-staging.ts
 */
import { createClient } from "@supabase/supabase-js";
import { resolve } from "node:path";
import { loadEnvForce } from "./lib/env";

loadEnvForce(resolve(process.cwd(), ".env.staging.local"));

function toGhanaE164(value: string): string | null {
  const digits = value.replace(/[\s\-()]/g, "").replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("233") && digits.length >= 12) return `+${digits}`;
  if (digits.startsWith("0") && digits.length === 10) return `+233${digits.slice(1)}`;
  return digits.length >= 10 ? `+${digits}` : null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function resolveSmsPhoneForPersona(admin: any, authUid: string, persona: "lessee" | "landlord"): Promise<{ phoneE164: string | null; source: string }> {
  if (persona === "lessee") {
    const { data: lessee } = await admin
      .from("lessees")
      .select("phone")
      .eq("auth_user_id", authUid)
      .maybeSingle();
    const row = lessee as { phone?: string | null } | null;
    return {
      phoneE164: row?.phone ? toGhanaE164(row.phone) : null,
      source: "lessees.phone",
    };
  }

  const { data: landlord } = await admin
    .from("landlords")
    .select("notification_phone, tenant_id")
    .eq("auth_user_id", authUid)
    .maybeSingle();

  const landlordRow = landlord as {
    notification_phone?: string | null;
    tenant_id?: string | null;
  } | null;

  let tenantPhone: string | null = null;
  if (landlordRow?.tenant_id) {
    const { data: tenant } = await admin
      .from("tenants")
      .select("phone")
      .eq("id", landlordRow.tenant_id)
      .maybeSingle();
    const tenantRow = tenant as { phone?: string | null } | null;
    tenantPhone = typeof tenantRow?.phone === "string" ? tenantRow.phone : null;
  }

  const raw = landlordRow?.notification_phone ?? tenantPhone;
  return {
    phoneE164: raw ? toGhanaE164(raw) : null,
    source: "landlords.notification_phone",
  };
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url.includes("wieflwbfdmjtsdnwbfii")) {
    throw new Error("Refusing: not staging Supabase URL");
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  console.log("Portal MFA routes:");
  console.log("  lessee: /portal/login/mfa");
  console.log("  landlord: /landlord-portal/login/mfa");

  const { data: lessee } = await admin
    .from("lessees")
    .select("auth_user_id, phone")
    .not("auth_user_id", "is", null)
    .limit(1)
    .maybeSingle();

  if (lessee?.auth_user_id) {
    const resolved = await resolveSmsPhoneForPersona(
      admin,
      lessee.auth_user_id,
      "lessee",
    );
    console.log("\nLessee phone resolution sample:");
    console.log("  auth_user_id:", lessee.auth_user_id);
    console.log("  lessees.phone:", lessee.phone);
    console.log("  resolved:", resolved);
  } else {
    console.log("\nNo lessee with auth_user_id on staging — phone resolution skipped");
  }

  const { data: landlord } = await admin
    .from("landlords")
    .select("auth_user_id, notification_phone, tenant_id")
    .not("auth_user_id", "is", null)
    .limit(1)
    .maybeSingle();

  if (landlord?.auth_user_id) {
    const resolved = await resolveSmsPhoneForPersona(
      admin,
      landlord.auth_user_id,
      "landlord",
    );
    console.log("\nLandlord phone resolution sample:");
    console.log("  auth_user_id:", landlord.auth_user_id);
    console.log("  notification_phone:", landlord.notification_phone);
    console.log("  resolved:", resolved);
  } else {
    console.log("\nNo landlord with auth_user_id on staging — phone resolution skipped");
  }

  for (const table of [
    "user_mfa_settings",
    "login_sms_otp_challenges",
    "login_mfa_sessions",
  ]) {
    const { error } = await admin.from(table).select("*").limit(0);
    console.log(`Schema ${table}:`, error ? `FAIL ${error.message}` : "OK");
  }

  console.log("\nPortal matrix script completed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
