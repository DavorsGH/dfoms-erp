import { resolve } from "node:path";
import { loadEnvFile, resolveDatabaseUrl } from "./resolve-database-url.mjs";

async function main() {
  loadEnvFile(resolve(process.cwd(), ".env.local"));
  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: resolveDatabaseUrl() });
  await client.connect();

  try {
    const created = await client.query(`
      SELECT tablename, indexname
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname LIKE 'idx_%'
        AND indexdef LIKE '%USING btree%'
        AND (
          indexname IN (
            'idx_employees_assigned_site_id',
            'idx_employees_contract_project',
            'idx_roster_history_employee_id',
            'idx_sites_client_id',
            'idx_sites_project_id',
            'idx_user_accounts_employee_id',
            'idx_user_accounts_client_id',
            'idx_work_orders_site_id',
            'idx_work_orders_client_id',
            'idx_inspection_summary_site_id',
            'idx_inspection_summary_client_id',
            'idx_failed_inspections_site_id',
            'idx_failed_inspections_client_id',
            'idx_complaint_register_site_id',
            'idx_complaint_register_client_id',
            'idx_incident_register_site_id',
            'idx_incident_register_client_id',
            'idx_corrective_actions_client_id',
            'idx_roster_config_client_id',
            'idx_equipment_register_assigned_site',
            'idx_consumables_client_site',
            'idx_income_register_client_id',
            'idx_income_register_product_id',
            'idx_payroll_processing_employee_id',
            'idx_payroll_history_employee_id',
            'idx_overtime_register_employee_id',
            'idx_loan_register_employee_id',
            'idx_leave_management_employee_id',
            'idx_employee_leave_balances_employee_id',
            'idx_employee_employment_history_employee_id',
            'idx_disciplinary_records_employee_id',
            'idx_exit_management_employee_id',
            'idx_asset_register_employee_id',
            'idx_approvers_employee_id',
            'idx_internal_consumption_product_id',
            'idx_internal_consumption_site_id',
            'idx_stock_movements_product_id',
            'idx_stock_movements_reference_id',
            'idx_production_batches_finished_product_id',
            'idx_raw_material_purchases_material_id'
          )
        )
      ORDER BY tablename, indexname
    `);

    await client.query("SET enable_seqscan = off");
    const forced = await client.query(`
      EXPLAIN (ANALYZE, FORMAT TEXT)
      SELECT e.employee_id, e.full_name, e.assigned_site_id
      FROM employees e
      WHERE e.assigned_site_id = ANY(ARRAY['SI-001','SI-002']::text[])
      ORDER BY e.full_name
    `);
    await client.query("SET enable_seqscan = on");

    const employeeCount = await client.query(
      `SELECT COUNT(*)::int AS count FROM employees`,
    );

    console.log(
      JSON.stringify(
        {
          indexesCreated: created.rows.length,
          indexes: created.rows,
          employeeRowCount: employeeCount.rows[0].count,
          forcedIndexPlan: forced.rows.map((r) => r["QUERY PLAN"]),
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
