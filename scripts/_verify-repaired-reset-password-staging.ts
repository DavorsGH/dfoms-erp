/** Verify reset-password path for repaired orphan accounts. */
import { createClient } from "@supabase/supabase-js";
import { loadEnvFromArgv } from "./lib/env";

async function main() {
  loadEnvFromArgv(["--env-file", ".env.staging.local"]);
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  for (const email of ["giftyavors@gmail.com", "info@central.edu.gh"]) {
    const { data: acct } = await admin
      .from("user_accounts")
      .select("auth_uid")
      .ilike("email", email)
      .maybeSingle();
    if (!acct) {
      console.log(email, "NO user_accounts row");
      continue;
    }

    const { data: authUser, error: getErr } = await admin.auth.admin.getUserById(
      acct.auth_uid,
    );
    const { error: updErr } = await admin.auth.admin.updateUserById(
      acct.auth_uid,
      { password: "RepairVerify-Reset9Qx!" },
    );

    console.log(email, {
      auth_uid: acct.auth_uid,
      getUserById: getErr?.message ?? "OK",
      resetPassword: updErr?.message ?? "OK",
      auth_email: authUser?.user?.email ?? null,
    });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
