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

async function createTestUser(admin, spec) {
  const existing = await admin
    .from("user_accounts")
    .select("auth_uid")
    .eq("email", spec.email)
    .maybeSingle();

  if (existing.data) {
    return { email: spec.email, status: "already_exists" };
  }

  const { data: authData, error: authError } =
    await admin.auth.admin.createUser({
      email: spec.email,
      password: spec.password,
      email_confirm: true,
    });

  if (authError || !authData.user) {
    throw new Error(`${spec.email}: ${authError?.message ?? "auth create failed"}`);
  }

  const { error: insertError } = await admin.from("user_accounts").insert({
    auth_uid: authData.user.id,
    email: spec.email,
    role: spec.role,
    employee_id: spec.employee_id ?? null,
    client_id: spec.client_id ?? null,
    is_active: true,
  });

  if (insertError) {
    await admin.auth.admin.deleteUser(authData.user.id);
    throw new Error(`${spec.email}: ${insertError.message}`);
  }

  if (spec.supervisor_site_codes?.length) {
    const { error: siteError } = await admin
      .from("user_account_supervisor_sites")
      .insert(
        spec.supervisor_site_codes.map((site_code) => ({
          auth_uid: authData.user.id,
          site_code,
        })),
      );

    if (siteError) {
      throw new Error(`${spec.email}: ${siteError.message}`);
    }
  }

  return { email: spec.email, status: "created", auth_uid: authData.user.id };
}

async function main() {
  loadEnvFile(resolve(process.cwd(), ".env.local"));

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );

  const [
    { data: employees },
    { data: clients },
    { data: sites },
    { data: accounts },
  ] = await Promise.all([
    admin.from("employees").select("employee_id, full_name").order("employee_id"),
    admin.from("clients").select("client_id, client_name").order("client_id"),
    admin.from("sites").select("site_code, site_name").order("site_code").limit(3),
    admin.from("user_accounts").select("employee_id, client_id, email"),
  ]);

  const usedEmployeeIds = new Set(
    (accounts ?? [])
      .map((account) => account.employee_id)
      .filter(Boolean),
  );
  const usedClientIds = new Set(
    (accounts ?? [])
      .map((account) => account.client_id)
      .filter(Boolean),
  );

  const availableEmployees = (employees ?? []).filter(
    (employee) => !usedEmployeeIds.has(employee.employee_id),
  );
  const availableClient = (clients ?? []).find(
    (client) => !usedClientIds.has(client.client_id),
  );
  const siteCodes = (sites ?? []).slice(0, 2).map((site) => site.site_code);

  if (availableEmployees.length < 5) {
    throw new Error(
      `Need at least 5 unassigned employees for RBAC test users; found ${availableEmployees.length}`,
    );
  }

  if (!availableClient) {
    throw new Error("Need at least one client without a user account");
  }

  if (siteCodes.length < 1) {
    throw new Error("Need at least one site for supervisor test user");
  }

  const password = "TestRbac1!";
  const specs = [
    {
      email: "rbac.admin@test.davors",
      role: "super_admin",
      employee_id: availableEmployees[0].employee_id,
    },
    {
      email: "rbac.finance@test.davors",
      role: "finance",
      employee_id: availableEmployees[1].employee_id,
    },
    {
      email: "rbac.hr@test.davors",
      role: "hr",
      employee_id: availableEmployees[2].employee_id,
    },
    {
      email: "rbac.operations@test.davors",
      role: "operations_manager",
      employee_id: availableEmployees[3].employee_id,
    },
    {
      email: "rbac.supervisor@test.davors",
      role: "supervisor",
      employee_id: availableEmployees[4].employee_id,
      supervisor_site_codes: siteCodes,
    },
    {
      email: "rbac.employee@test.davors",
      role: "employee",
      employee_id: availableEmployees[5]?.employee_id ?? availableEmployees[0].employee_id,
    },
    {
      email: "rbac.client@test.davors",
      role: "client",
      client_id: availableClient.client_id,
    },
  ];

  const results = [];
  for (const spec of specs) {
    results.push(await createTestUser(admin, { ...spec, password }));
  }

  console.log(JSON.stringify(results, null, 2));
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
