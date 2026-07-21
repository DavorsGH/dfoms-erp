import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { resolveDatabaseUrl } from "./resolve-database-url.mjs";

function loadEnvForce(filePath) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    process.env[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim();
  }
}

loadEnvForce(resolve(process.cwd(), ".env.local.backup"));

const { default: pg } = await import("pg");
const client = new pg.Client({
  connectionString: resolveDatabaseUrl(),
  ssl: { rejectUnauthorized: false },
});
await client.connect();

const checks = [
  {
    name: "1. composite_fk_count",
    sql: `
      SELECT count(*)::int AS composite_fk_count
      FROM pg_constraint
      WHERE conname IN (
        'attendance_register_staff_id_fkey',
        'complaint_register_site_id_fkey', 'complaint_register_client_id_fkey',
        'consumables_client_site_fkey', 'corrective_actions_client_id_fkey',
        'crm_sales_customer_id_fkey', 'crm_subscriptions_customer_id_fkey',
        'employees_assigned_site_id_fkey', 'equipment_register_assigned_site_fkey',
        'failed_inspections_site_id_fkey', 'failed_inspections_client_id_fkey',
        'incident_register_site_id_fkey', 'incident_register_client_id_fkey',
        'income_register_client_id_fkey', 'inspection_summary_site_id_fkey',
        'inspection_summary_client_id_fkey', 'internal_consumption_site_id_fkey',
        'roster_config_client_id_fkey', 'sites_client_id_fkey',
        'user_account_supervisor_sites_site_code_fkey', 'user_accounts_client_id_fkey',
        'work_orders_site_id_fkey', 'work_orders_client_id_fkey'
      )
      AND array_length(conkey, 1) = 2
    `,
  },
  {
    name: "2. ON DELETE clauses",
    sql: `
      SELECT conname, pg_get_constraintdef(oid) AS definition
      FROM pg_constraint
      WHERE conname IN (
        'user_account_supervisor_sites_site_code_fkey',
        'user_accounts_client_id_fkey'
      )
      ORDER BY conname
    `,
  },
  {
    name: "3. trigger",
    sql: `
      SELECT tgname, tgrelid::regclass AS table_name
      FROM pg_trigger
      WHERE tgname = 'trg_clear_user_accounts_client_id'
    `,
  },
  {
    name: "4. attendance_register orphans",
    sql: `
      SELECT count(*)::int AS orphan_count
      FROM attendance_register ar
      LEFT JOIN employees e
        ON ar.tenant_id = e.tenant_id AND ar.staff_id = e.staff_id
      WHERE e.staff_id IS NULL
    `,
  },
];

const orphanChecks = [
  ["complaint_register → sites", `SELECT count(*)::int AS orphan_count FROM complaint_register cr LEFT JOIN sites s ON cr.tenant_id = s.tenant_id AND cr.site_id = s.site_code WHERE cr.site_id IS NOT NULL AND s.site_code IS NULL`],
  ["complaint_register → customers", `SELECT count(*)::int AS orphan_count FROM complaint_register cr LEFT JOIN customers c ON cr.tenant_id = c.tenant_id AND cr.client_id = c.client_id WHERE cr.client_id IS NOT NULL AND c.client_id IS NULL`],
  ["consumables → sites", `SELECT count(*)::int AS orphan_count FROM consumables co LEFT JOIN sites s ON co.tenant_id = s.tenant_id AND co.client_site = s.site_code WHERE co.client_site IS NOT NULL AND s.site_code IS NULL`],
  ["corrective_actions → customers", `SELECT count(*)::int AS orphan_count FROM corrective_actions ca LEFT JOIN customers c ON ca.tenant_id = c.tenant_id AND ca.client_id = c.client_id WHERE ca.client_id IS NOT NULL AND c.client_id IS NULL`],
  ["crm_sales → customers", `SELECT count(*)::int AS orphan_count FROM crm_sales cs LEFT JOIN customers c ON cs.tenant_id = c.tenant_id AND cs.customer_id = c.client_id WHERE cs.customer_id IS NOT NULL AND c.client_id IS NULL`],
  ["crm_subscriptions → customers", `SELECT count(*)::int AS orphan_count FROM crm_subscriptions csub LEFT JOIN customers c ON csub.tenant_id = c.tenant_id AND csub.customer_id = c.client_id WHERE csub.customer_id IS NOT NULL AND c.client_id IS NULL`],
  ["employees → sites", `SELECT count(*)::int AS orphan_count FROM employees emp LEFT JOIN sites s ON emp.tenant_id = s.tenant_id AND emp.assigned_site_id = s.site_code WHERE emp.assigned_site_id IS NOT NULL AND s.site_code IS NULL`],
  ["equipment_register → sites", `SELECT count(*)::int AS orphan_count FROM equipment_register eq LEFT JOIN sites s ON eq.tenant_id = s.tenant_id AND eq.assigned_site = s.site_code WHERE eq.assigned_site IS NOT NULL AND s.site_code IS NULL`],
  ["failed_inspections → sites", `SELECT count(*)::int AS orphan_count FROM failed_inspections fi LEFT JOIN sites s ON fi.tenant_id = s.tenant_id AND fi.site_id = s.site_code WHERE fi.site_id IS NOT NULL AND s.site_code IS NULL`],
  ["failed_inspections → customers", `SELECT count(*)::int AS orphan_count FROM failed_inspections fi LEFT JOIN customers c ON fi.tenant_id = c.tenant_id AND fi.client_id = c.client_id WHERE fi.client_id IS NOT NULL AND c.client_id IS NULL`],
  ["incident_register → sites", `SELECT count(*)::int AS orphan_count FROM incident_register ir LEFT JOIN sites s ON ir.tenant_id = s.tenant_id AND ir.site_id = s.site_code WHERE ir.site_id IS NOT NULL AND s.site_code IS NULL`],
  ["incident_register → customers", `SELECT count(*)::int AS orphan_count FROM incident_register ir LEFT JOIN customers c ON ir.tenant_id = c.tenant_id AND ir.client_id = c.client_id WHERE ir.client_id IS NOT NULL AND c.client_id IS NULL`],
  ["income_register → customers", `SELECT count(*)::int AS orphan_count FROM income_register inc LEFT JOIN customers c ON inc.tenant_id = c.tenant_id AND inc.client_id = c.client_id WHERE inc.client_id IS NOT NULL AND c.client_id IS NULL`],
  ["inspection_summary → sites", `SELECT count(*)::int AS orphan_count FROM inspection_summary ins LEFT JOIN sites s ON ins.tenant_id = s.tenant_id AND ins.site_id = s.site_code WHERE ins.site_id IS NOT NULL AND s.site_code IS NULL`],
  ["inspection_summary → customers", `SELECT count(*)::int AS orphan_count FROM inspection_summary ins LEFT JOIN customers c ON ins.tenant_id = c.tenant_id AND ins.client_id = c.client_id WHERE ins.client_id IS NOT NULL AND c.client_id IS NULL`],
  ["internal_consumption → sites", `SELECT count(*)::int AS orphan_count FROM internal_consumption ic LEFT JOIN sites s ON ic.tenant_id = s.tenant_id AND ic.site_id = s.site_code WHERE ic.site_id IS NOT NULL AND s.site_code IS NULL`],
  ["roster_config → customers", `SELECT count(*)::int AS orphan_count FROM roster_config rc LEFT JOIN customers c ON rc.tenant_id = c.tenant_id AND rc.client_id = c.client_id WHERE rc.client_id IS NOT NULL AND c.client_id IS NULL`],
  ["sites → customers", `SELECT count(*)::int AS orphan_count FROM sites s1 LEFT JOIN customers c ON s1.tenant_id = c.tenant_id AND s1.client_id = c.client_id WHERE s1.client_id IS NOT NULL AND c.client_id IS NULL`],
  ["user_account_supervisor_sites → sites", `SELECT count(*)::int AS orphan_count FROM user_account_supervisor_sites uass LEFT JOIN sites s ON uass.tenant_id = s.tenant_id AND uass.site_code = s.site_code WHERE uass.site_code IS NOT NULL AND s.site_code IS NULL`],
  ["user_accounts → customers", `SELECT count(*)::int AS orphan_count FROM user_accounts ua LEFT JOIN customers c ON ua.tenant_id = c.tenant_id AND ua.client_id = c.client_id WHERE ua.client_id IS NOT NULL AND c.client_id IS NULL`],
  ["work_orders → sites", `SELECT count(*)::int AS orphan_count FROM work_orders wo LEFT JOIN sites s ON wo.tenant_id = s.tenant_id AND wo.site_id = s.site_code WHERE wo.site_id IS NOT NULL AND s.site_code IS NULL`],
  ["work_orders → customers", `SELECT count(*)::int AS orphan_count FROM work_orders wo LEFT JOIN customers c ON wo.tenant_id = c.tenant_id AND wo.client_id = c.client_id WHERE wo.client_id IS NOT NULL AND c.client_id IS NULL`],
];

console.log("=== Production post-migration sanity (tvcurcnmasnocwdxzgvz) ===\n");

for (const check of checks) {
  const result = await client.query(check.sql);
  console.log(check.name);
  console.log(JSON.stringify(result.rows, null, 2));
  console.log("");
}

console.log("=== Orphan checks (expect 0 each) ===\n");
for (const [label, sql] of orphanChecks) {
  const result = await client.query(sql);
  const count = result.rows[0].orphan_count;
  console.log(`${label}: ${count}`);
}

await client.end();
