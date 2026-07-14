import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile, resolveDatabaseUrl } from "./resolve-database-url.mjs";

async function main() {
  loadEnvFile(resolve(process.cwd(), ".env.local"));
  const databaseUrl = resolveDatabaseUrl();
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();
  try {
    const projects = await client.query(`
      SELECT project_code, project_name, required_staff, id
      FROM projects
      WHERE project_code IN ('PRJ09','PRJ10','PRJ11','PRJ12')
         OR id = 'd069f523-f8a3-4d43-8a0e-b1f61a1f4758'
    `);
    const counts = await client.query(`
      SELECT s.site_name, s.site_code, e.contract_project, count(*)::int AS staff_count
      FROM sites s
      JOIN employees e ON e.assigned_site_id = s.site_code
      WHERE s.client_id = 'CL-001' AND e.employment_status = 'Active'
      GROUP BY s.site_name, s.site_code, e.contract_project
      ORDER BY s.site_name
    `);
    console.log("projects:", JSON.stringify(projects.rows, null, 2));
    console.log("staff by site:", JSON.stringify(counts.rows, null, 2));
  } finally {
    await client.end();
  }
}
main().catch((e) => { console.error(e); process.exit(1); });
