import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadEnvFile(filePath) {
  const contents = readFileSync(filePath, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

const USER_ACCOUNT_SELECT =
  "auth_uid, employee_id, email, role, is_active, client_id, employees(full_name), clients(client_name), user_account_supervisor_sites(site_code)";

async function main() {
  loadEnvFile(resolve(process.cwd(), ".env.local"));

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const checks = [];

  const { data: roles, error: rolesError } = await admin
    .from("roles")
    .select("code, label")
    .order("sort_order");

  checks.push({
    name: "roles table",
    ok: !rolesError && (roles?.length ?? 0) === 7,
    detail: rolesError?.message ?? `${roles?.length ?? 0} roles`,
  });

  const { error: clientIdError } = await admin
    .from("user_accounts")
    .select("client_id")
    .limit(1);

  checks.push({
    name: "user_accounts.client_id",
    ok: !clientIdError,
    detail: clientIdError?.message ?? "present",
  });

  const { error: supervisorSitesError } = await admin
    .from("user_account_supervisor_sites")
    .select("site_code")
    .limit(1);

  checks.push({
    name: "user_account_supervisor_sites",
    ok: !supervisorSitesError,
    detail: supervisorSitesError?.message ?? "present",
  });

  const { data: david, error: davidError } = await admin
    .from("user_accounts")
    .select("email, role, employee_id, is_active")
    .eq("email", "david.avors@gmail.com")
    .single();

  checks.push({
    name: "david unchanged",
    ok:
      !davidError &&
      david?.role === "super_admin" &&
      david?.employee_id === "EMP0001" &&
      david?.is_active === true,
    detail: davidError?.message ?? JSON.stringify(david),
  });

  const { data: testUsers, error: testUsersError } = await admin
    .from("user_accounts")
    .select(USER_ACCOUNT_SELECT)
    .like("email", "rbac.%@test.davors");

  checks.push({
    name: "rbac test users",
    ok: !testUsersError && (testUsers?.length ?? 0) === 7,
    detail: testUsersError?.message ?? `${testUsers?.length ?? 0} users`,
  });

  if (testUsers?.length) {
    for (const user of testUsers) {
      const sites = Array.isArray(user.user_account_supervisor_sites)
        ? user.user_account_supervisor_sites
        : user.user_account_supervisor_sites
          ? [user.user_account_supervisor_sites]
          : [];

      checks.push({
        name: `user ${user.email}`,
        ok: Boolean(user.role),
        detail: JSON.stringify({
          role: user.role,
          employee_id: user.employee_id,
          client_id: user.client_id,
          sites: sites.map((site) => site.site_code),
        }),
      });
    }
  }

  console.log(JSON.stringify(checks, null, 2));

  const failed = checks.filter((check) => !check.ok);
  if (failed.length > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
