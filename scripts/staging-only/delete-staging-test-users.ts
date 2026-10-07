/**
 * Delete @test.davors staging users (auth + user_accounts).
 *
 * npx tsx scripts/staging-only/delete-staging-test-users.ts
 */
import { config } from "dotenv";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

config({ path: resolve(process.cwd(), ".env.staging.local") });

const STAGING_REF = "wieflwbfdmjtsdnwbfii";

const EMAIL_PATTERNS = [
  "r1-mut.%",
  "r1.adv.%",
  "r1.mat.%",
  "r1.icdel.%",
  "r1.http.%",
  "r1.cleanup.%",
];

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  if (!url.includes(STAGING_REF)) {
    throw new Error("Staging only");
  }
  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  });

  const { data: accounts, error } = await admin
    .from("user_accounts")
    .select("auth_uid, email, tenant_id, role")
    .or(
      EMAIL_PATTERNS.map((p) => `email.ilike.${p}`).join(","),
    );
  if (error) throw error;

  console.log(`Found ${accounts?.length ?? 0} test user_accounts:`);
  for (const row of accounts ?? []) {
    console.log(`  ${row.email} ${row.auth_uid} tenant=${row.tenant_id}`);
  }

  for (const row of accounts ?? []) {
    if (!row.auth_uid) continue;
    await admin
      .from("leave_approver_config")
      .delete()
      .eq("approver_user_account_id", row.auth_uid);
    await admin
      .from("leave_requests")
      .delete()
      .eq("approver_user_account_id", row.auth_uid);
    const { error: delErr } = await admin.auth.admin.deleteUser(row.auth_uid);
    await admin.from("user_accounts").delete().eq("auth_uid", row.auth_uid);
    await admin.from("user_accounts").delete().eq("email", row.email);
    if (delErr?.message?.includes("User not found")) {
      console.log(`Deleted ${row.email}: auth already gone, user_accounts removed`);
    } else {
      console.log(`Deleted ${row.email}:`, delErr?.message ?? "OK");
    }
  }

  const { data: remaining } = await admin
    .from("user_accounts")
    .select("email, auth_uid")
    .or(EMAIL_PATTERNS.map((p) => `email.ilike.${p}`).join(","));
  for (const row of remaining ?? []) {
    await admin.from("user_accounts").delete().eq("auth_uid", row.auth_uid);
  }
  const { data: still } = await admin
    .from("user_accounts")
    .select("email")
    .or(EMAIL_PATTERNS.map((p) => `email.ilike.${p}`).join(","));
  if (still?.length) {
    throw new Error(`${still.length} test users still remain: ${still.map((r) => r.email).join(", ")}`);
  }
  console.log("PASS: no test user_accounts remain for R1 patterns.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
