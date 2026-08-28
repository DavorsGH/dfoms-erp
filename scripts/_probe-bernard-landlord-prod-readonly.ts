/**
 * READ-ONLY: Bernard landlord row shape + auth on production.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const TENANT = "23b3e0c4-1f4c-4f6c-8e6d-21ae212b6d31";

function loadEnvForce(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    process.env[t.slice(0, i).trim()] = v;
  }
}

async function main() {
  loadEnvForce(resolve(process.cwd(), ".env.local.backup"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ?? "";
  const ref = new URL(url).hostname.split(".")[0];
  if (ref !== PRODUCTION_REF) throw new Error(`not prod ${ref}`);

  const admin = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: landlords, error } = await admin
    .from("landlords")
    .select("*")
    .eq("tenant_id", TENANT);
  console.log("error:", error?.message ?? null);
  console.log("count:", landlords?.length ?? 0);
  for (const row of landlords ?? []) {
    const keys = Object.keys(row);
    console.log("keys:", keys.join(", "));
    console.log("row summary:", {
      tenant_id: row.tenant_id,
      email: row.email,
      auth_user_id: row.auth_user_id,
      landlord_type: row.landlord_type,
      approval_status: row.approval_status,
      name: row.name ?? row.full_name ?? row.contact_name ?? null,
    });
    if (row.auth_user_id) {
      const { data } = await admin.auth.admin.getUserById(
        String(row.auth_user_id),
      );
      console.log("auth:", {
        id: data.user?.id,
        email: data.user?.email,
        portal: data.user?.user_metadata?.portal,
        last_sign_in_at: data.user?.last_sign_in_at,
      });
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
