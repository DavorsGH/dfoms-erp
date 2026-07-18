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

  const { data: projects, error: projectsError } = await supabase
    .from("projects")
    .select("project_code, project_name, site_id, required_staff")
    .order("project_code");

  if (projectsError) {
    throw new Error(`projects: ${projectsError.message}`);
  }

  const { data: sites, error: sitesError } = await supabase
    .from("sites")
    .select("*")
    .order("site_code");

  if (sitesError) {
    throw new Error(`sites: ${sitesError.message}`);
  }

  const { data: clients, error: clientsError } = await supabase
    .from("customers")
    .select("client_id, client_name")
    .order("client_name");

  if (clientsError) {
    throw new Error(`clients: ${clientsError.message}`);
  }

  console.log("=== CLIENTS ===");
  console.table(clients);

  console.log("\n=== PROJECTS (all rows, including site_id) ===");
  console.table(
    projects.map((p) => ({
      project_code: p.project_code,
      project_name: p.project_name,
      site_id: p.site_id,
      required_staff: p.required_staff,
    })),
  );

  const withSite = projects.filter((p) => p.site_id);
  const withoutSite = projects.filter((p) => !p.site_id);
  console.log(`\nProjects with site_id set: ${withSite.length}`);
  console.log(`Projects with site_id NULL: ${withoutSite.length}`);

  console.log("\n=== SITES (full table) ===");
  console.table(sites);

  console.log("\n=== SITE_ID -> PROJECT mapping (from projects.site_id) ===");
  const siteToProjects = new Map();
  for (const p of withSite) {
    const list = siteToProjects.get(p.site_id) ?? [];
    list.push({
      project_code: p.project_code,
      project_name: p.project_name,
      required_staff: p.required_staff,
    });
    siteToProjects.set(p.site_id, list);
  }
  for (const [siteCode, projs] of [...siteToProjects.entries()].sort()) {
    console.log(`\n${siteCode}:`);
    for (const p of projs) {
      console.log(
        `  - ${p.project_code} | ${p.project_name} | required_staff=${p.required_staff}`,
      );
    }
  }

  const orphanSites = sites.filter((s) => !siteToProjects.has(s.site_code));
  if (orphanSites.length) {
    console.log("\n=== SITES with NO project pointing at them (via projects.site_id) ===");
    console.table(orphanSites);
  }
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
