/**
 * Probe staff invite failure for avorsjason@gmail.com on staging (no server-only imports).
 */
import { createClient } from "@supabase/supabase-js";
import { loadEnvFromArgv } from "./lib/env";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const EMAIL = "avorsjason@gmail.com";

async function main() {
  loadEnvFromArgv(process.argv.slice(2));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url.includes(STAGING_REF)) {
    throw new Error("Refusing: not staging");
  }

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false },
  });

  const [{ data: staff }, { data: lessee }, { data: invites }] =
    await Promise.all([
      admin.from("user_accounts").select("*").ilike("email", EMAIL),
      admin.from("lessees").select("*").ilike("email", EMAIL),
      admin
        .from("staff_portal_invites")
        .select("*")
        .ilike("email", EMAIL)
        .order("created_at", { ascending: false }),
    ]);
  console.log("user_accounts:", JSON.stringify(staff, null, 2));
  console.log("lessees:", JSON.stringify(lessee, null, 2));
  console.log("invites:", JSON.stringify(invites, null, 2));

  const { data: accounts } = await admin
    .from("user_accounts")
    .select("auth_uid, email, role, client_id, tenant_id, is_active, employees(full_name), clients:customers!user_accounts_client_id_fkey(client_name)")
    .order("email");

  console.log("\nAll user_accounts on staging:");
  for (const row of accounts ?? []) {
    console.log(
      `- ${row.email} | ${row.role} | active=${row.is_active} | tenant=${row.tenant_id}`,
    );
  }

  const { data: testAccounts } = await admin
    .from("user_accounts")
    .select("auth_uid, email, role, tenant_id, is_active")
    .or(
      "email.ilike.%staff-invite-%,email.ilike.%@example.com,email.ilike.%iso-rls-%",
    );
  console.log("\nLikely test accounts:", JSON.stringify(testAccounts, null, 2));

  console.log("\nRESEND_API_KEY set:", Boolean(process.env.RESEND_API_KEY?.trim()));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
