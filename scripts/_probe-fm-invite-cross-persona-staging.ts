/**
 * Diagnose cross-persona conflict for FM invite email on staging.
 */
import { resolve } from "node:path";
import { config } from "dotenv";
import { createClient } from "@supabase/supabase-js";

config({ path: resolve(process.cwd(), ".env.local") });
config({ path: resolve(process.cwd(), ".env.staging.local") });

const EMAIL = "david.avors@gmail.com";

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!.trim();
  const admin = createClient(url, key, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log("host", new URL(url).hostname);

  const { data: staff } = await admin
    .from("user_accounts")
    .select("auth_uid, email, tenant_id, role, is_active")
    .ilike("email", EMAIL)
    .maybeSingle();

  let tenantName: string | null = null;
  if (staff?.tenant_id) {
    const { data: t } = await admin
      .from("tenants")
      .select("name, email, product_line")
      .eq("id", staff.tenant_id)
      .maybeSingle();
    tenantName = t?.name ?? null;
    console.log("staff_tenant", t);
  }

  const { data: lessee } = await admin
    .from("lessees")
    .select("lessee_id, tenant_id, status, auth_user_id")
    .ilike("email", EMAIL)
    .maybeSingle();

  const { data: fm } = await admin
    .from("facility_managers")
    .select("facility_manager_id, tenant_id, status, auth_user_id")
    .ilike("email", EMAIL);

  console.log(
    JSON.stringify(
      {
        email: EMAIL,
        staff: staff
          ? {
              auth_uid: staff.auth_uid,
              role: staff.role,
              is_active: staff.is_active,
              tenant_id: staff.tenant_id,
              tenant_name: tenantName,
            }
          : null,
        lessee,
        facility_managers: fm,
      },
      null,
      2,
    ),
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
