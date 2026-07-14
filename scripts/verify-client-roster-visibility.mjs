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
    const clientUser = await client.query(`
      SELECT auth_uid FROM user_accounts WHERE client_id = 'CL-001' AND role = 'client' LIMIT 1
    `);
    const authUid = clientUser.rows[0]?.auth_uid;
    if (!authUid) throw new Error("No CL-001 client user found");

    await client.query(`SELECT set_config('request.jwt.claim.sub', $1, true)`, [
      authUid,
    ]);
    await client.query(`SET LOCAL ROLE authenticated`);

    const projects = await client.query(`
      SELECT project_code, project_name, required_staff
      FROM projects
      WHERE project_code IN ('PRJ01','PRJ09','PRJ10','PRJ11','PRJ12')
      ORDER BY project_code
    `);

    const employees = await client.query(`
      SELECT count(*)::int AS count
      FROM employees
      WHERE employment_status = 'Active'
        AND assigned_site_id IN (SELECT site_code FROM sites WHERE client_id = 'CL-001')
    `);

    console.log(
      JSON.stringify(
        {
          visibleProjects: projects.rows,
          visibleEmployeeCount: employees.rows[0]?.count,
        },
        null,
        2,
      ),
    );
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
