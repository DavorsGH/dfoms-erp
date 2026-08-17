/**
 * Probe Davors tenant client invite constraints on staging.
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnvFromArgv } from "./lib/env";

const DAVORS_TENANT = "00000001-0000-4000-8000-000000000001";
const EMAIL = "avorsjason@gmail.com";

async function main() {
  loadEnvFromArgv(process.argv.slice(2));
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const { data: customers } = await admin
    .from("customers")
    .select("client_id, client_name")
    .eq("tenant_id", DAVORS_TENANT)
    .ilike("client_name", "%davors%");
  console.log("Davors customers:", customers);

  for (const c of customers ?? []) {
    const { data: accts } = await admin
      .from("user_accounts")
      .select("auth_uid, email, role, client_id")
      .eq("tenant_id", DAVORS_TENANT)
      .eq("client_id", c.client_id);
    console.log(`Accounts for ${c.client_name} (${c.client_id}):`, accts);
  }

  const { data: emailStaff } = await admin
    .from("user_accounts")
    .select("auth_uid, email, role, tenant_id")
    .ilike("email", EMAIL);
  console.log("\nGlobal staff row for invite email:", emailStaff);

  const { data: deleteDeps } = await admin
    .from("user_accounts")
    .select("auth_uid, email, role, tenant_id, is_active")
    .or(
      "email.ilike.fix2.staff.%,email.ilike.%@test.davors,email.ilike.%@example.com",
    );
  console.log("\nCandidate test accounts:", deleteDeps);

  for (const acct of deleteDeps ?? []) {
    const uid = acct.auth_uid;
    const checks = await Promise.all([
      admin.from("leave_approver_config").select("id").eq("approver_user_account_id", uid).limit(1),
      admin.from("leave_requests").select("id").eq("approver_user_account_id", uid).limit(1),
      admin.from("user_account_supervisor_sites").select("site_code").eq("auth_uid", uid),
    ]);
    console.log(`Deps for ${acct.email}:`, {
      leave_approver: checks[0].data?.length ?? 0,
      leave_requests: checks[1].data?.length ?? 0,
      supervisor_sites: checks[2].data?.length ?? 0,
    });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
