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
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  const { data: sites, error: sitesError } = await supabase
    .from("sites")
    .select(
      "site_code, site_name, client_id, required_staff, project_id, project:projects!project_id(id, project_code, project_name)",
    )
    .order("site_code");

  if (sitesError) throw new Error(sitesError.message);

  const { data: projects, error: projectsError } = await supabase
    .from("projects")
    .select("id, project_code, project_name, required_staff")
    .order("project_code");

  if (projectsError) throw new Error(projectsError.message);

  console.log("=== SITES AFTER SCRIPT 37 ===");
  console.table(
    sites.map((s) => ({
      site_code: s.site_code,
      site_name: s.site_name,
      client_id: s.client_id,
      required_staff: s.required_staff,
      project_code: s.project?.project_code ?? null,
      project_id: s.project_id,
    })),
  );

  const missingProject = sites.filter((s) => !s.project_id);
  const cuSites = sites.filter((s) => s.client_id === "CL-001");
  console.log(`\nTotal sites: ${sites.length}`);
  console.log(`Central University sites: ${cuSites.length}`);
  console.log(`Sites missing project_id: ${missingProject.length}`);

  console.log("\n=== PROJECTS (post-migration, no site_id) ===");
  console.table(projects);

  const legacyCodes = [
    "PRJ02",
    "PRJ03",
    "PRJ04",
    "PRJ05",
    "PRJ06",
    "PRJ07",
    "PRJ23",
  ];
  console.log("\n=== REFERENCE CHECK: PRJ02-07, PRJ23 ===");
  for (const code of legacyCodes) {
    const { count: empCount } = await supabase
      .from("employees")
      .select("*", { count: "exact", head: true })
      .eq("contract_project", code);
    const { count: woCount } = await supabase
      .from("work_orders")
      .select("*", { count: "exact", head: true })
      .eq("contract_project", code);
    const row = projects.find((p) => p.project_code === code);
    console.log(
      `${code} | ${row?.project_name ?? "missing"} | employees=${empCount ?? 0} | work_orders.contract_project=${woCount ?? 0}`,
    );
  }

  const { data: empPRJ23 } = await supabase
    .from("employees")
    .select("staff_id, full_name, contract_project")
    .eq("contract_project", "PRJ23");
  if (empPRJ23?.length) {
    console.log("\nPRJ23 employees:", empPRJ23);
  }
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
