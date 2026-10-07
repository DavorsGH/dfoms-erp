import { config } from "dotenv";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

config({ path: resolve(process.cwd(), ".env.staging.local") });

const DAVORS = "00000001-0000-4000-8000-000000000001";

async function main() {
  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
  const stamp = Date.now();
  const email = `r1.cleanup.${stamp}@test.davors`;
  const password = `R1Cln-${stamp}!Aa9`;
  const { data: u, error: cu } = await admin.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (cu || !u.user) throw cu ?? new Error("createUser");
  await admin.from("user_accounts").insert({
    auth_uid: u.user.id,
    email,
    tenant_id: DAVORS,
    role: "super_admin",
    is_active: true,
  });
  const client = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { auth: { persistSession: false } },
  );
  await client.auth.signInWithPassword({ email, password });

  const { data: rows } = await admin
    .from("raw_material_stock_adjustments")
    .select("id, reason")
    .eq("tenant_id", DAVORS)
    .or("reason.ilike.%R1 HTTP%,reason.ilike.%R1 batch test%");

  for (const row of rows ?? []) {
    const { error } = await client
      .from("raw_material_stock_adjustments")
      .delete()
      .eq("id", row.id);
    console.log(row.reason, error?.message ?? "OK");
  }

  await admin.from("user_accounts").delete().eq("auth_uid", u.user!.id);
  await admin.auth.admin.deleteUser(u.user!.id);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
