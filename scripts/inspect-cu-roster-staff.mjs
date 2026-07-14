import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile, resolveDatabaseUrl } from "./resolve-database-url.mjs";

async function main() {
  loadEnvFile(resolve(process.cwd(), ".env.local"));
  const databaseUrl = resolveDatabaseUrl();
  if (!databaseUrl) throw new Error("DATABASE_URL missing");

  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const cuSites = await client.query(`
      SELECT site_code, site_name, required_staff, project_id
      FROM sites
      WHERE client_id = 'CL-001'
      ORDER BY site_name
    `);

    const rosterStaff = await client.query(`
      SELECT e.employee_id, e.full_name, e.contract_project, e.assigned_site_id, e.employment_status
      FROM employees e
      WHERE e.employment_status = 'Active'
        AND e.contract_project IS NOT NULL
      ORDER BY e.full_name
    `);

    const visibleViaAssignedSite = await client.query(`
      SELECT count(*)::int AS count
      FROM employees e
      WHERE e.employment_status = 'Active'
        AND e.assigned_site_id IN (
          SELECT site_code FROM sites WHERE client_id = 'CL-001'
        )
    `);

    const visibleViaContractProject = await client.query(`
      SELECT count(*)::int AS count
      FROM employees e
      WHERE e.employment_status = 'Active'
        AND EXISTS (
          SELECT 1
          FROM sites s
          LEFT JOIN projects p ON p.id = s.project_id
          WHERE s.client_id = 'CL-001'
            AND e.contract_project IS NOT NULL
            AND (
              e.contract_project = p.project_code
              OR EXISTS (
                SELECT 1
                FROM projects pr
                WHERE pr.project_code = e.contract_project
                  AND pr.required_staff IS NOT NULL
                  AND lower(trim(pr.project_name)) = lower(trim(s.site_name))
              )
            )
        )
    `);

    console.log("CU sites:", JSON.stringify(cuSites.rows, null, 2));
    console.log("Active roster staff sample:", JSON.stringify(rosterStaff.rows.slice(0, 8), null, 2));
    console.log("Visible via assigned_site_id:", visibleViaAssignedSite.rows[0]);
    console.log("Visible via contract_project:", visibleViaContractProject.rows[0]);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
