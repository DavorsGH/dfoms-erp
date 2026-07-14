import { resolve } from "node:path";
import { loadEnvFile, resolveDatabaseUrl } from "./resolve-database-url.mjs";

async function main() {
  loadEnvFile(resolve(process.cwd(), ".env.local"));
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: resolveDatabaseUrl() });
  await client.connect();

  const cols = await client.query(`
    SELECT table_name, column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND (column_name ILIKE '%project%' OR column_name ILIKE '%contract%')
    ORDER BY table_name, ordinal_position
  `);

  const fk = await client.query(`
    SELECT tc.table_name, kcu.column_name, ccu.column_name AS foreign_column
    FROM information_schema.table_constraints tc
    JOIN information_schema.key_column_usage kcu
      ON tc.constraint_name = kcu.constraint_name
    JOIN information_schema.constraint_column_usage ccu
      ON ccu.constraint_name = tc.constraint_name
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND ccu.table_name = 'projects'
  `);

  const david = await client.query(`
    SELECT employee_id, staff_id, full_name, position, contract_project
    FROM employees
    WHERE full_name ILIKE '%david%avors%'
       OR position ILIKE '%field%manager%'
  `);

  const payroll = await client.query(`
    SELECT 'processing' AS src, payroll_month::text, employee_id, project_contract, status
    FROM payroll_processing
    WHERE project_contract IN ('PRJ02','PRJ03','PRJ04','PRJ05','PRJ06','PRJ07','PRJ23')
    UNION ALL
    SELECT 'history', payroll_month::text, employee_id, project_contract, locked::text
    FROM payroll_history
    WHERE project_contract IN ('PRJ02','PRJ03','PRJ04','PRJ05','PRJ06','PRJ07','PRJ23')
    ORDER BY 1, 2
  `);

  const missing = await client.query(`
    SELECT unnest(ARRAY['PRJ02','PRJ04','PRJ07']) AS code
    EXCEPT
    SELECT project_code FROM projects
  `);

  const legacyExists = await client.query(`
    SELECT project_code, project_name FROM projects
    WHERE project_code IN ('PRJ02','PRJ03','PRJ04','PRJ05','PRJ06','PRJ07','PRJ23')
    ORDER BY project_code
  `);

  const sitesByProject = await client.query(`
    SELECT p.project_code, COUNT(s.site_code)::int AS site_count
    FROM projects p
    LEFT JOIN sites s ON s.project_id = p.id
    WHERE p.project_code IN ('PRJ02','PRJ03','PRJ04','PRJ05','PRJ06','PRJ07','PRJ23')
    GROUP BY p.project_code
    ORDER BY p.project_code
  `);

  const internalConsumption = await client.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'internal_consumption'
    ORDER BY ordinal_position
  `);

  console.log(
    JSON.stringify(
      {
        legacyRowsStillInProjects: legacyExists.rows,
        codesAlreadyDeleted: missing.rows,
        sitesLinked: sitesByProject.rows,
        fkToProjects: fk.rows,
        projectRelatedColumns: cols.rows,
        davidOrFieldManagerEmployees: david.rows,
        payrollReferences: payroll.rows,
        internalConsumptionColumns: internalConsumption.rows.map(
          (row) => row.column_name,
        ),
      },
      null,
      2,
    ),
  );

  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
