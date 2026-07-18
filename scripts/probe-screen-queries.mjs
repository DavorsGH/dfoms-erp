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

async function probe(label, fn) {
  const { data, error } = await fn();
  if (error) {
    console.log(`FAIL ${label}: ${error.message}`);
    return false;
  }
  console.log(`OK  ${label} (${Array.isArray(data) ? data.length : 1} row(s))`);
  return true;
}

async function main() {
  loadEnvFile(resolve(process.cwd(), ".env.local"));
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  const checks = [];

  checks.push(
    await probe("Duty Roster page queries", async () =>
      supabase
        .from("projects")
        .select(
          "project_code, project_name, required_staff, site_id, site:sites!site_id(site_code, site_name, client_id)",
        )
        .not("required_staff", "is", null),
    ),
  );

  checks.push(
    await probe("Income Register page queries", async () =>
      supabase
        .from("income_register")
        .select("*, client:clients!client_id(client_id, client_name)")
        .order("date", { ascending: false })
        .limit(5),
    ),
  );

  checks.push(
    await probe("Monthly Client Service Report queries", async () =>
      Promise.all([
        supabase.from("customers").select("client_id, client_name").order("client_name"),
        supabase.from("roster_config").select("id, client_id, cycle_start_date, cycle_length_days"),
      ]).then(([clients, configs]) => {
        if (clients.error) return { data: null, error: clients.error };
        if (configs.error) return { data: null, error: configs.error };
        return { data: { clients: clients.data, configs: configs.data }, error: null };
      }),
    ),
  );

  checks.push(
    await probe("Projects admin page queries", async () =>
      supabase
        .from("projects")
        .select(
          "project_code, project_name, required_staff, site_id, site:sites!site_id(site_code, site_name, client_id, client:clients!client_id(client_id, client_name))",
        )
        .order("project_code"),
    ),
  );

  checks.push(
    await probe("Roster Settings page queries", async () =>
      Promise.all([
        supabase.from("customers").select("client_id, client_name").order("client_name"),
        supabase
          .from("roster_config")
          .select("id, client_id, cycle_start_date, cycle_length_days, morning_time, afternoon_time, supervisor_time"),
        supabase
          .from("projects")
          .select("project_code, project_name, site_id")
          .not("required_staff", "is", null),
      ]).then(([clients, configs, projects]) => {
        const error = clients.error ?? configs.error ?? projects.error;
        if (error) return { data: null, error };
        return {
          data: {
            clients: clients.data?.length,
            configs: configs.data?.length,
            projects: projects.data?.length,
          },
          error: null,
        };
      }),
    ),
  );

  const passed = checks.filter(Boolean).length;
  console.log(`\n${passed}/${checks.length} screen query probes passed`);
  process.exit(passed === checks.length ? 0 : 1);
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
