/**
 * Production census: password compliance vs active password nudges.
 * Usage: npx tsx scripts/_census-password-nudges-production.ts --env-file .env.local.backup
 */
import { createClient } from "@supabase/supabase-js";
import { assert, loadEnvFromArgv } from "./lib/env";
import { getPasswordPolicyRolloutDate } from "../utils/password-policy";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";

async function main() {
  loadEnvFromArgv(process.argv);
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  assert(url.includes(PRODUCTION_REF), "Refusing non-production");

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const rollout = getPasswordPolicyRolloutDate();
  console.log("Rollout cutoff:", rollout.toISOString());

  const { data: secRows, error } = await admin
    .from("user_auth_security")
    .select("auth_uid, password_updated_at");

  if (error) {
    console.error("user_auth_security error:", error.message);
    process.exit(1);
  }

  let compliant = 0;
  let nonCompliant = 0;
  const nonCompliantUids: string[] = [];

  for (const row of secRows ?? []) {
    const updatedMs = new Date(row.password_updated_at).getTime();
    if (updatedMs >= rollout.getTime()) {
      compliant += 1;
    } else {
      nonCompliant += 1;
      nonCompliantUids.push(row.auth_uid);
    }
  }

  console.log(`Total user_auth_security rows: ${secRows?.length ?? 0}`);
  console.log(`Compliant: ${compliant}, Non-compliant: ${nonCompliant}`);

  const { count: unreadPwNudges } = await admin
    .from("employee_notifications")
    .select("id", { count: "exact", head: true })
    .eq("title", "Update your password")
    .is("read_at", null);

  console.log(`Platform-wide unread staff password nudges: ${unreadPwNudges ?? 0}`);

  if (nonCompliantUids.length > 0) {
    const sample = nonCompliantUids.slice(0, 5);
    const { data: sampleAccounts } = await admin
      .from("user_accounts")
      .select("auth_uid, email, tenant_id, is_active")
      .in("auth_uid", sample);

    console.log("\nSample non-compliant users:", sampleAccounts);
  }

  const { data: table219 } = await admin
    .from("security_notification_dismissals")
    .select("auth_uid")
    .limit(1);
  console.log(
    "\nMigration 219 (security_notification_dismissals) on production:",
    table219 !== null ? "YES (table exists)" : "NO",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
