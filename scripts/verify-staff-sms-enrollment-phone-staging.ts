/**
 * Verify staff SMS enrollment phone resolution on staging.
 * Usage: npx tsx scripts/verify-staff-sms-enrollment-phone-staging.ts
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
  if (digits.length === 9) return `+233${digits}`;
  return digits.length >= 10 ? `+${digits}` : null;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url.includes("wieflwbfdmjtsdnwbfii")) {
    throw new Error("Refusing: not staging");
  }

  const admin = createClient(url, key, { auth: { persistSession: false } });

  const { data: accounts } = await admin
    .from("user_accounts")
    .select("auth_uid, employee_id, email")
    .eq("is_active", true)
    .limit(20);

  let withEmployeePhone = 0;
  let manualEntryEligible = 0;

  for (const account of accounts ?? []) {
    let phoneE164: string | null = null;
    if (account.employee_id) {
      const { data: employee } = await admin
        .from("employees")
        .select("phone, momo_number")
        .eq("employee_id", account.employee_id)
        .maybeSingle();
      const raw = employee?.phone?.trim() || employee?.momo_number?.trim() || "";
      phoneE164 = raw ? toGhanaE164(raw) : null;
    }

    const locked = Boolean(phoneE164);
    if (locked) withEmployeePhone += 1;
    else manualEntryEligible += 1;

    console.log(
      `${locked ? "LOCKED" : "MANUAL"} — ${account.email ?? account.auth_uid} — employee_id=${account.employee_id ?? "none"} — phone=${phoneE164 ?? "(enter on MFA page)"}`,
    );
  }

  console.log("\nSummary:");
  console.log("  Staff accounts with employee-linked phone (read-only enroll):", withEmployeePhone);
  console.log("  Staff accounts eligible for manual phone entry:", manualEntryEligible);
  console.log("  Manual override normalization sample:", toGhanaE164("0241234567"));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
