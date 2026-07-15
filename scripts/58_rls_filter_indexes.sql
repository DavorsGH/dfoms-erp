-- Script 58: Indexes on RLS-filtered / FK lookup columns
-- Low-risk speedup for supervisor/client scoped queries and inventory joins.

BEGIN;

-- ---------------------------------------------------------------------------
-- Core RLS scoping paths
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_employees_assigned_site_id
  ON employees (assigned_site_id);

CREATE INDEX IF NOT EXISTS idx_employees_contract_project
  ON employees (contract_project);

CREATE INDEX IF NOT EXISTS idx_roster_history_employee_id
  ON roster_history (employee_id);

CREATE INDEX IF NOT EXISTS idx_sites_client_id
  ON sites (client_id);

CREATE INDEX IF NOT EXISTS idx_sites_project_id
  ON sites (project_id);

CREATE INDEX IF NOT EXISTS idx_user_accounts_employee_id
  ON user_accounts (employee_id);

CREATE INDEX IF NOT EXISTS idx_user_accounts_client_id
  ON user_accounts (client_id);

-- auth_uid already leads PK on user_accounts and user_account_supervisor_sites
-- site_code already indexed on user_account_supervisor_sites

-- ---------------------------------------------------------------------------
-- Operations tables filtered by site_id / client_id (can_access_operations_site)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_work_orders_site_id
  ON work_orders (site_id);

CREATE INDEX IF NOT EXISTS idx_work_orders_client_id
  ON work_orders (client_id);

CREATE INDEX IF NOT EXISTS idx_inspection_summary_site_id
  ON inspection_summary (site_id);

CREATE INDEX IF NOT EXISTS idx_inspection_summary_client_id
  ON inspection_summary (client_id);

CREATE INDEX IF NOT EXISTS idx_failed_inspections_site_id
  ON failed_inspections (site_id);

CREATE INDEX IF NOT EXISTS idx_failed_inspections_client_id
  ON failed_inspections (client_id);

CREATE INDEX IF NOT EXISTS idx_complaint_register_site_id
  ON complaint_register (site_id);

CREATE INDEX IF NOT EXISTS idx_complaint_register_client_id
  ON complaint_register (client_id);

CREATE INDEX IF NOT EXISTS idx_incident_register_site_id
  ON incident_register (site_id);

CREATE INDEX IF NOT EXISTS idx_incident_register_client_id
  ON incident_register (client_id);

CREATE INDEX IF NOT EXISTS idx_corrective_actions_client_id
  ON corrective_actions (client_id);

CREATE INDEX IF NOT EXISTS idx_roster_config_client_id
  ON roster_config (client_id);

CREATE INDEX IF NOT EXISTS idx_equipment_register_assigned_site
  ON equipment_register (assigned_site);

CREATE INDEX IF NOT EXISTS idx_consumables_client_site
  ON consumables (client_site);

-- ---------------------------------------------------------------------------
-- Finance / income filtered columns
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_income_register_client_id
  ON income_register (client_id);

CREATE INDEX IF NOT EXISTS idx_income_register_product_id
  ON income_register (product_id);

-- ---------------------------------------------------------------------------
-- HR / self-service employee_id lookups (often used with RLS employee scoping)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_payroll_processing_employee_id
  ON payroll_processing (employee_id);

CREATE INDEX IF NOT EXISTS idx_payroll_history_employee_id
  ON payroll_history (employee_id);

CREATE INDEX IF NOT EXISTS idx_overtime_register_employee_id
  ON overtime_register (employee_id);

CREATE INDEX IF NOT EXISTS idx_loan_register_employee_id
  ON loan_register (employee_id);

CREATE INDEX IF NOT EXISTS idx_leave_management_employee_id
  ON leave_management (employee_id);

CREATE INDEX IF NOT EXISTS idx_employee_leave_balances_employee_id
  ON employee_leave_balances (employee_id);

CREATE INDEX IF NOT EXISTS idx_employee_employment_history_employee_id
  ON employee_employment_history (employee_id);

CREATE INDEX IF NOT EXISTS idx_disciplinary_records_employee_id
  ON disciplinary_records (employee_id);

CREATE INDEX IF NOT EXISTS idx_exit_management_employee_id
  ON exit_management (employee_id);

CREATE INDEX IF NOT EXISTS idx_asset_register_employee_id
  ON asset_register (employee_id);

CREATE INDEX IF NOT EXISTS idx_approvers_employee_id
  ON approvers (employee_id);

-- leave_requests.employee_id already has idx_leave_requests_employee_id
-- attendance_register.staff_id already leads idx_attendance_staff_date

-- ---------------------------------------------------------------------------
-- Inventory FK columns (no RLS yet, but heavily filtered in UI/cascade deletes)
-- ---------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_internal_consumption_product_id
  ON internal_consumption (product_id);

CREATE INDEX IF NOT EXISTS idx_internal_consumption_site_id
  ON internal_consumption (site_id);

CREATE INDEX IF NOT EXISTS idx_stock_movements_product_id
  ON stock_movements (product_id);

CREATE INDEX IF NOT EXISTS idx_stock_movements_reference_id
  ON stock_movements (reference_id);

CREATE INDEX IF NOT EXISTS idx_production_batches_finished_product_id
  ON production_batches (finished_product_id);

CREATE INDEX IF NOT EXISTS idx_raw_material_purchases_material_id
  ON raw_material_purchases (material_id);

NOTIFY pgrst, 'reload schema';

COMMIT;
