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

async function main() {
  loadEnvFile(resolve(process.cwd(), ".env.local"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) throw new Error("Missing Supabase service role env");

  const searchName = process.argv[2] ?? "Paul Adonu";
  const { default: pg } = await import("pg");
  const { resolveDatabaseUrl } = await import("./resolve-database-url.mjs");
  const sql = new pg.Client({ connectionString: resolveDatabaseUrl() });
  await sql.connect();
  const lookup = await sql.query(
    `
    SELECT ua.auth_uid, ua.email, ua.employee_id, ua.client_id, ua.is_active,
           COALESCE(e.full_name, c.client_name, ua.email) AS display_name
    FROM user_accounts ua
    LEFT JOIN employees e ON e.employee_id = ua.employee_id
    LEFT JOIN clients c ON c.client_id = ua.client_id
    WHERE e.full_name ILIKE $1 OR ua.email ILIKE $1
    ORDER BY display_name
    LIMIT 5
  `,
    [`%${searchName}%`],
  );
  await sql.end();

  console.log("Matching accounts:", JSON.stringify(lookup.rows, null, 2));

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const targetRow = lookup.rows[0];
  if (!targetRow) {
    console.log("No matching account found.");
    return;
  }

  const { data: accounts, error } = await admin
    .from("user_accounts")
    .select("auth_uid, email, employee_id, client_id, is_active")
    .eq("auth_uid", targetRow.auth_uid);
  if (error) throw error;

  const target = accounts?.[0];
  if (!target) {
    throw new Error("Target account row missing after lookup");
  }

  const employeeId = target.employee_id;
  let employeeBefore = null;
  if (employeeId) {
    const { data } = await admin
      .from("employees")
      .select("employee_id, full_name, staff_id")
      .eq("employee_id", employeeId)
      .maybeSingle();
    employeeBefore = data;
  }

  const { data: authUsers } = await admin.auth.admin.listUsers();
  const authBefore = authUsers.users.find((user) => user.id === target.auth_uid);

  console.log("Employee before delete:", employeeBefore);
  console.log("Auth user before delete:", authBefore ? authBefore.email : null);

  const [
    { count: supervisorSites },
    { count: approverConfig },
    { count: pendingApprovals },
    { count: allApprovals },
  ] = await Promise.all([
    admin
      .from("user_account_supervisor_sites")
      .select("site_code", { count: "exact", head: true })
      .eq("auth_uid", target.auth_uid),
    admin
      .from("leave_approver_config")
      .select("id", { count: "exact", head: true })
      .eq("approver_user_account_id", target.auth_uid),
    admin
      .from("leave_requests")
      .select("id", { count: "exact", head: true })
      .eq("approver_user_account_id", target.auth_uid)
      .eq("status", "Pending"),
    admin
      .from("leave_requests")
      .select("id", { count: "exact", head: true })
      .eq("approver_user_account_id", target.auth_uid),
  ]);

  console.log("Dependencies:", {
    supervisorSites: supervisorSites ?? 0,
    approverConfig: approverConfig ?? 0,
    pendingApprovals: pendingApprovals ?? 0,
    allApprovals: allApprovals ?? 0,
  });

  await admin
    .from("user_account_supervisor_sites")
    .delete()
    .eq("auth_uid", target.auth_uid);

  if ((approverConfig ?? 0) > 0) {
    await admin
      .from("leave_approver_config")
      .delete()
      .eq("approver_user_account_id", target.auth_uid);
  }

  const { error: accountDeleteError } = await admin
    .from("user_accounts")
    .delete()
    .eq("auth_uid", target.auth_uid);
  if (accountDeleteError) throw accountDeleteError;

  const { error: authDeleteError } = await admin.auth.admin.deleteUser(
    target.auth_uid,
  );
  if (authDeleteError) throw authDeleteError;

  const { data: accountAfter } = await admin
    .from("user_accounts")
    .select("auth_uid")
    .eq("auth_uid", target.auth_uid)
    .maybeSingle();

  let employeeAfter = null;
  if (employeeId) {
    const { data } = await admin
      .from("employees")
      .select("employee_id, full_name, staff_id")
      .eq("employee_id", employeeId)
      .maybeSingle();
    employeeAfter = data;
  }

  const { data: authUsersAfter } = await admin.auth.admin.listUsers();
  const authAfter = authUsersAfter.users.find(
    (user) => user.id === target.auth_uid,
  );

  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const signInClient = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error: loginError } = await signInClient.auth.signInWithPassword({
    email: target.email,
    password: "TestRbac1!",
  });

  console.log(
    JSON.stringify(
      {
        deletedAuthUid: target.auth_uid,
        accountStillExists: Boolean(accountAfter),
        employeeBefore,
        employeeAfter,
        employeePreserved:
          JSON.stringify(employeeBefore) === JSON.stringify(employeeAfter),
        authUserStillExists: Boolean(authAfter),
        loginStillWorks: !loginError,
        loginError: loginError?.message ?? null,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
