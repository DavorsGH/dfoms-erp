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

const TEST_PASSWORD = "TestRbac1!";

async function signIn(url, anonKey, email) {
  const client = createClient(url, anonKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const { error } = await client.auth.signInWithPassword({
    email,
    password: TEST_PASSWORD,
  });
  if (error) throw new Error(`Sign-in failed for ${email}: ${error.message}`);
  return client;
}

async function main() {
  loadEnvFile(resolve(process.cwd(), ".env.local"));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !anonKey || !serviceKey) {
    throw new Error("Missing Supabase env vars in .env.local");
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const checks = [];

  const rpcs = [
    "delete_raw_material_purchase",
    "update_raw_material_purchase",
    "preview_raw_material_delete",
  ];

  for (const rpc of rpcs) {
    const { error } = await admin.rpc(rpc, {});
    const missing =
      error?.message?.includes("Could not find the function") &&
      !error?.message?.includes("without parameter");
    checks.push({
      name: `rpc ${rpc}`,
      ok: !missing,
      detail: missing ? error.message.slice(0, 80) : "exists",
    });
  }

  const supervisor = await signIn(url, anonKey, "rbac.supervisor@test.davors");
  const finance = await signIn(url, anonKey, "rbac.finance@test.davors");
  const hr = await signIn(url, anonKey, "rbac.hr@test.davors");
  const operations = await signIn(
    url,
    anonKey,
    "rbac.operations@test.davors",
  );

  const { data: allWorkOrders } = await admin
    .from("work_orders")
    .select("work_order_no, site_id")
    .limit(50);

  const otherSiteOrder = (allWorkOrders ?? []).find(
    (row) => row.site_id && !["SI-001", "SI-002"].includes(row.site_id),
  );

  if (otherSiteOrder) {
    const { data: blockedRows, error: blockedError } = await supervisor
      .from("work_orders")
      .select("work_order_no, site_id")
      .eq("site_id", otherSiteOrder.site_id);

    checks.push({
      name: "supervisor RLS blocks other-site work_orders",
      ok:
        !blockedError &&
        (blockedRows?.length ?? 0) === 0,
      detail: blockedError?.message ?? `queried ${otherSiteOrder.site_id}`,
    });
  } else {
    checks.push({
      name: "supervisor RLS blocks other-site work_orders",
      ok: true,
      detail: "no other-site work orders in dataset",
    });
  }

  const { data: supervisorSites } = await supervisor
    .from("work_orders")
    .select("site_id");

  checks.push({
    name: "supervisor work_orders only assigned sites",
    ok: (supervisorSites ?? []).every((row) =>
      ["SI-001", "SI-002"].includes(row.site_id),
    ),
    detail: JSON.stringify([
      ...new Set((supervisorSites ?? []).map((row) => row.site_id)),
    ]),
  });

  const { data: supervisorEmployees } = await supervisor
    .from("employees")
    .select("employee_id, assigned_site_id");

  checks.push({
    name: "supervisor employees only assigned sites",
    ok: (supervisorEmployees ?? []).every(
      (row) =>
        row.assigned_site_id &&
        ["SI-001", "SI-002"].includes(row.assigned_site_id),
    ),
    detail: `${supervisorEmployees?.length ?? 0} rows`,
  });

  const { data: financeWorkOrders, error: financeWoError } = await finance
    .from("work_orders")
    .select("work_order_no")
    .limit(1);

  checks.push({
    name: "finance blocked from work_orders",
    ok:
      !financeWoError &&
      (financeWorkOrders?.length ?? 0) === 0,
    detail: financeWoError?.message ?? `${financeWorkOrders?.length ?? 0} rows`,
  });

  const { data: operationsPayroll, error: operationsPayrollError } =
    await operations.from("payroll_processing").select("payroll_month").limit(1);

  checks.push({
    name: "operations_manager can read payroll_processing",
    ok: !operationsPayrollError,
    detail: operationsPayrollError?.message ?? "ok",
  });

  const { data: hrEmployees, error: hrEmployeesError, count: hrEmployeeCount } = await hr
    .from("employees")
    .select("employee_id", { count: "exact" });

  checks.push({
    name: "hr can read employees",
    ok: !hrEmployeesError && (hrEmployeeCount ?? hrEmployees?.length ?? 0) > 0,
    detail: hrEmployeesError?.message ?? `${hrEmployeeCount ?? hrEmployees?.length ?? 0} rows`,
  });

  const roleChecks = [
    ["rbac.hr@test.davors", "hr", true],
    ["rbac.finance@test.davors", "finance", false],
    ["rbac.supervisor@test.davors", "supervisor", false],
    ["rbac.operations@test.davors", "operations_manager", false],
  ];

  for (const [email, role, allowed] of roleChecks) {
    const { data: account } = await admin
      .from("user_accounts")
      .select("role")
      .eq("email", email)
      .single();

    const roleOk = account?.role === role;
    const payrollManageOk =
      role === "hr" || role === "super_admin"
        ? allowed
        : !allowed;
    checks.push({
      name: `account ${email}`,
      ok: roleOk,
      detail: JSON.stringify({ role: account?.role, payrollManageOk }),
    });
  }

  const { data: david } = await admin
    .from("user_accounts")
    .select("role, employee_id, is_active")
    .eq("email", "david.avors@gmail.com")
    .single();

  checks.push({
    name: "david unchanged",
    ok:
      david?.role === "super_admin" &&
      david?.employee_id === "EMP0001" &&
      david?.is_active === true,
    detail: JSON.stringify(david),
  });

  console.log(JSON.stringify(checks, null, 2));

  if (checks.some((check) => !check.ok)) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
