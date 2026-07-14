import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadEnvFile, resolveDatabaseUrl } from "./resolve-database-url.mjs";
import {
  buildDutyRosterViewModel,
  normalizeDutyRosterEmployee,
  normalizeDutyRosterSite,
} from "../app/dashboard/operations/duty-roster-utils.ts";
import { normalizeProjectEntry } from "../app/dashboard/administration/projects-utils.ts";
import { getRosterConfigForClient } from "../app/dashboard/operations/roster-config-utils.ts";

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
  const databaseUrl = resolveDatabaseUrl();
  if (!url || !anonKey || !databaseUrl) throw new Error("Missing env");

  const client = await signIn(url, anonKey, "rbac.client@test.davors");
  const { data: account } = await client
    .from("user_accounts")
    .select("client_id")
    .maybeSingle();

  const clientId = account?.client_id ?? "CL-001";

  const [
    { data: employees, error: employeesError },
    { data: sites, error: sitesError },
    { data: projects },
    { data: configs },
    { data: history },
    { data: clients },
  ] = await Promise.all([
    client
      .from("employees")
      .select(
        "employee_id, staff_id, full_name, position, shift, contract_project, employment_status",
      ),
    client.from("sites").select("*"),
    client.from("projects").select("*"),
    client.from("roster_config").select("*"),
    client.from("roster_history").select("*"),
    client.from("clients").select("*").eq("client_id", clientId),
  ]);

  console.log(
    JSON.stringify(
      {
        clientId,
        employeesError: employeesError?.message ?? null,
        employeesCount: employees?.length ?? 0,
        sitesError: sitesError?.message ?? null,
        sitesCount: sites?.length ?? 0,
        projectsCount: projects?.length ?? 0,
      },
      null,
      2,
    ),
  );

  const config = getRosterConfigForClient(configs ?? [], clientId);
  const clientRecord = clients?.[0];
  if (config && clientRecord) {
    const vm = buildDutyRosterViewModel({
      clientId,
      clientName: clientRecord.client_name,
      config,
      employees: (employees ?? []).map((e) => normalizeDutyRosterEmployee(e)),
      projects: (projects ?? []).map((p) => normalizeProjectEntry(p)),
      sites: (sites ?? []).map((s) => normalizeDutyRosterSite(s)),
      history: history ?? [],
    });
    console.log(
      "Staffing rows:",
      JSON.stringify(
        vm.rows.map((r) => ({
          facility: r.facilityName,
          required: r.requiredStaff,
          actual: r.totalStaff,
        })),
        null,
        2,
      ),
    );
  }

  const { default: pg } = await import("pg");
  const admin = new pg.Client({ connectionString: databaseUrl });
  await admin.connect();
  const adminEmployees = await admin.query(
    `SELECT count(*)::int AS count FROM employees WHERE employment_status = 'Active' AND contract_project IS NOT NULL`,
  );
  console.log("Admin active roster employees:", adminEmployees.rows[0]);
  await admin.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
