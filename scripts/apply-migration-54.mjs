import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile, resolveDatabaseUrl } from "./resolve-database-url.mjs";

const LEGACY_CODES = ["PRJ03", "PRJ06", "PRJ23"];

async function capturePayrollRows(client) {
  const processing = await client.query(`
    SELECT id, payroll_month, employee_id, project_contract, gross_pay, net_pay, status
    FROM payroll_processing
    WHERE employee_id = 'EMP0002'
      AND payroll_month IN ('2026-02-01', '2026-06-01', '2026-08-01')
    ORDER BY payroll_month
  `);

  const history = await client.query(`
    SELECT id, payroll_month, employee_id, project_contract, gross_pay, net_pay, locked
    FROM payroll_history
    WHERE employee_id = 'EMP0002'
      AND payroll_month = '2026-07-01'
  `);

  return {
    payroll_processing: processing.rows,
    payroll_history: history.rows,
  };
}

async function countLegacyReferences(client, codes) {
  const checks = {};
  for (const code of codes) {
    const [employees, sites, attendance, processing, history, projects] =
      await Promise.all([
        client.query(
          `SELECT COUNT(*)::int AS count FROM employees WHERE contract_project = $1`,
          [code],
        ),
        client.query(
          `
          SELECT COUNT(*)::int AS count
          FROM sites s
          JOIN projects p ON p.id = s.project_id
          WHERE p.project_code = $1
        `,
          [code],
        ),
        client.query(
          `SELECT COUNT(*)::int AS count FROM attendance_register WHERE project_assignment = $1`,
          [code],
        ),
        client.query(
          `SELECT COUNT(*)::int AS count FROM payroll_processing WHERE project_contract = $1`,
          [code],
        ),
        client.query(
          `SELECT COUNT(*)::int AS count FROM payroll_history WHERE project_contract = $1`,
          [code],
        ),
        client.query(
          `SELECT COUNT(*)::int AS count FROM projects WHERE project_code = $1`,
          [code],
        ),
      ]);

    checks[code] = {
      employees: employees.rows[0].count,
      sites: sites.rows[0].count,
      attendance: attendance.rows[0].count,
      payroll_processing: processing.rows[0].count,
      payroll_history: history.rows[0].count,
      projects: projects.rows[0].count,
    };
  }
  return checks;
}

async function main() {
  loadEnvFile(resolve(process.cwd(), ".env.local"));
  const databaseUrl = resolveDatabaseUrl();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required in .env.local to apply migrations.");
  }

  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const beforePayroll = await capturePayrollRows(client);
    const beforeRefs = await countLegacyReferences(client, LEGACY_CODES);
    const beforeServiceTypes = await client.query(
      `SELECT name FROM service_types ORDER BY name`,
    );
    const beforeProjectCount = await client.query(
      `SELECT COUNT(*)::int AS count FROM projects`,
    );

    console.log("=== BEFORE ===");
    console.log(
      JSON.stringify(
        {
          projectCount: beforeProjectCount.rows[0].count,
          serviceTypes: beforeServiceTypes.rows.map((row) => row.name),
          payrollRows: beforePayroll,
          legacyReferences: beforeRefs,
        },
        null,
        2,
      ),
    );

    const sql = readFileSync(
      resolve(process.cwd(), "scripts", "54_legacy_project_cleanup.sql"),
      "utf8",
    );

    console.log("\nApplying 54_legacy_project_cleanup.sql...");
    await client.query(sql);
    console.log("Applied 54_legacy_project_cleanup.sql");

    const afterPayroll = await capturePayrollRows(client);
    const afterRefs = await countLegacyReferences(client, LEGACY_CODES);
    const afterServiceTypes = await client.query(
      `SELECT name FROM service_types ORDER BY name`,
    );
    const afterProjects = await client.query(
      `SELECT project_code, project_name FROM projects ORDER BY project_code`,
    );

    const positions = await client.query(`SELECT * FROM positions ORDER BY 1`);
    const employeePositions = await client.query(`
      SELECT DISTINCT position
      FROM employees
      WHERE position IS NOT NULL AND TRIM(position) <> ''
      ORDER BY position
    `);

    console.log("\n=== AFTER ===");
    console.log(
      JSON.stringify(
        {
          projectCount: afterProjects.rows.length,
          projects: afterProjects.rows,
          serviceTypes: afterServiceTypes.rows.map((row) => row.name),
          payrollRows: afterPayroll,
          legacyReferences: afterRefs,
          positionsTable: positions.rows,
          distinctEmployeePositions: employeePositions.rows.map(
            (row) => row.position,
          ),
        },
        null,
        2,
      ),
    );

    console.log("\n=== PAYROLL BEFORE/AFTER (EMP0002) ===");
    for (const beforeRow of beforePayroll.payroll_processing) {
      const afterRow = afterPayroll.payroll_processing.find(
        (row) => row.id === beforeRow.id,
      );
      console.log(
        JSON.stringify(
          {
            source: "payroll_processing",
            id: beforeRow.id,
            payroll_month: beforeRow.payroll_month,
            before: beforeRow,
            after: afterRow,
            amountsUnchanged:
              afterRow &&
              beforeRow.gross_pay === afterRow.gross_pay &&
              beforeRow.net_pay === afterRow.net_pay,
            projectContractChanged:
              beforeRow.project_contract !== afterRow?.project_contract,
          },
          null,
          2,
        ),
      );
    }

    for (const beforeRow of beforePayroll.payroll_history) {
      const afterRow = afterPayroll.payroll_history.find(
        (row) => row.id === beforeRow.id,
      );
      console.log(
        JSON.stringify(
          {
            source: "payroll_history",
            id: beforeRow.id,
            payroll_month: beforeRow.payroll_month,
            before: beforeRow,
            after: afterRow,
            amountsUnchanged:
              afterRow &&
              beforeRow.gross_pay === afterRow.gross_pay &&
              beforeRow.net_pay === afterRow.net_pay,
            projectContractChanged:
              beforeRow.project_contract !== afterRow?.project_contract,
          },
          null,
          2,
        ),
      );
    }

    const ok =
      afterProjects.rows.length === 7 &&
      afterServiceTypes.rows.some((row) => row.name === "Home Cleaning") &&
      afterServiceTypes.rows.some((row) => row.name === "Landscaping") &&
      LEGACY_CODES.every((code) =>
        Object.values(afterRefs[code]).every((count) => count === 0),
      ) &&
      afterPayroll.payroll_processing.every((row) => row.project_contract === "PRJ01") &&
      afterPayroll.payroll_history.every((row) => row.project_contract === "PRJ01");

    console.log(`\nVerification: ${ok ? "PASS" : "FAIL"}`);
    if (!ok) {
      process.exit(1);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
