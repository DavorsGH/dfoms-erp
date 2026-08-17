import { loadEnvFromArgv } from "./lib/env";
import { createClient } from "@supabase/supabase-js";
import { DAVORS_TENANT_ID } from "../utils/tenant-signup";

async function main() {
  loadEnvFromArgv(["--env-file", ".env.local.backup"]);

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false } },
  );

  const { data, error } = await admin
    .from("landlords")
    .select(
      "approval_status, tenant_id, landlord_type, auth_user_id, created_at, tenants!inner(name, email, product_line, created_at)",
    )
    .eq("tenants.product_line", "real_estate_only")
    .neq("tenant_id", DAVORS_TENANT_ID);

  if (error) throw error;

  const byStatus = new Map<string, number>();
  for (const row of data ?? []) {
    const s = row.approval_status ?? "null";
    byStatus.set(s, (byStatus.get(s) ?? 0) + 1);
  }
  console.log("approval_status counts:", Object.fromEntries(byStatus));

  const pending = (data ?? []).filter((r) => r.approval_status === "pending");
  console.log("pending rows:", pending.length);
  for (const row of pending) {
    const t = row.tenants as {
      name?: string;
      email?: string | null;
      created_at?: string;
    };
    console.log(
      JSON.stringify({
        name: t?.name,
        email: t?.email,
        tenant_id: row.tenant_id,
        type: row.landlord_type,
        auth: row.auth_user_id ? "linked" : "none",
        pending_since: row.created_at ?? t?.created_at,
      }),
    );
  }

  const rejected = (data ?? []).filter((r) => r.approval_status === "rejected");
  console.log("rejected rows (excluded from backfill):", rejected.length);
  for (const row of rejected) {
    const t = row.tenants as { name?: string; email?: string | null };
    console.log(
      JSON.stringify({
        name: t?.name,
        email: t?.email,
        tenant_id: row.tenant_id,
      }),
    );
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
