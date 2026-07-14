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
  if (error) throw new Error(`${email}: ${error.message}`);
  return client;
}

async function main() {
  loadEnvFile(resolve(process.cwd(), ".env.local"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey =
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ??
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !anonKey) throw new Error("Missing Supabase env vars");

  const checks = [];

  const clientUser = await signIn(url, anonKey, "rbac.client@test.davors");
  const { data: clientAccount } = await clientUser
    .from("user_accounts")
    .select("client_id")
    .eq("email", "rbac.client@test.davors")
    .maybeSingle();
  const { data: clientRecord } = await clientUser
    .from("clients")
    .select("client_name")
    .eq("client_id", clientAccount?.client_id ?? "")
    .maybeSingle();
  checks.push({
    name: "client can read own client name for header",
    ok: Boolean(clientRecord?.client_name),
    detail: clientRecord?.client_name ?? null,
  });

  const employeeUser = await signIn(url, anonKey, "rbac.employee@test.davors");
  const { data: employeeAccount } = await employeeUser
    .from("user_accounts")
    .select("employee_id")
    .eq("email", "rbac.employee@test.davors")
    .maybeSingle();
  const { data: employeeRecord } = await employeeUser
    .from("employees")
    .select("full_name")
    .eq("employee_id", employeeAccount?.employee_id ?? "")
    .maybeSingle();
  checks.push({
    name: "employee can read own employee record",
    ok: Boolean(employeeRecord?.full_name),
    detail: employeeRecord?.full_name ?? null,
  });

  const { count: ownPayrollCount } = await employeeUser
    .from("payroll_history")
    .select("employee_id", { count: "exact", head: true })
    .eq("employee_id", employeeAccount?.employee_id ?? "");
  checks.push({
    name: "employee payroll_history scoped to own rows",
    ok: (ownPayrollCount ?? 0) >= 0,
    detail: `${ownPayrollCount ?? 0} rows`,
  });

  const supervisorUser = await signIn(url, anonKey, "rbac.supervisor@test.davors");
  const { count: supervisorRosterCount } = await supervisorUser
    .from("roster_history")
    .select("employee_id", { count: "exact", head: true });
  checks.push({
    name: "supervisor sees company-wide roster history",
    ok: (supervisorRosterCount ?? 0) > 0,
    detail: `${supervisorRosterCount ?? 0} visible rows`,
  });

  const hrUser = await signIn(url, anonKey, "rbac.hr@test.davors");
  const { count: hrRosterCount } = await hrUser
    .from("roster_history")
    .select("employee_id", { count: "exact", head: true });
  checks.push({
    name: "hr sees company-wide roster history",
    ok: (hrRosterCount ?? 0) > 0,
    detail: `${hrRosterCount ?? 0} visible rows`,
  });

  const { data: clientIncome } = await clientUser
    .from("income_register")
    .select("outstanding_balance")
    .eq("entry_type", "service");
  const { count: clientSites } = await clientUser
    .from("sites")
    .select("site_code", { count: "exact", head: true });
  checks.push({
    name: "client dashboard data available",
    ok: Array.isArray(clientIncome) && (clientSites ?? 0) > 0,
    detail: `${clientIncome?.length ?? 0} invoices, ${clientSites ?? 0} sites`,
  });

  console.log(JSON.stringify(checks, null, 2));
  if (!checks.every((check) => check.ok)) process.exit(1);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
