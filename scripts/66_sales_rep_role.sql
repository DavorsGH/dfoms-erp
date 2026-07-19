-- Script 66: Add sales_rep fixed role (enum + reference row + product-sale read RLS).
-- PG 12+: ADD VALUE is transactional; IF NOT EXISTS avoids re-run errors.

ALTER TYPE app_role ADD VALUE IF NOT EXISTS 'sales_rep';

BEGIN;

-- roles PK is composite (tenant_id, code) as of script 59 — insert one row per tenant.
INSERT INTO roles (tenant_id, code, label, sort_order)
  SELECT t.id, 'sales_rep', 'Sales Rep', 8 FROM tenants t
ON CONFLICT (tenant_id, code) DO UPDATE
SET label = EXCLUDED.label,
    sort_order = EXCLUDED.sort_order;

-- Sales reps need product_sale rows for the limited dashboard (not full finance access).
DROP POLICY IF EXISTS income_register_select ON income_register;
CREATE POLICY income_register_select
  ON income_register
  FOR SELECT
  TO authenticated
  USING (
    tenant_matches(tenant_id)
    AND (
      can_access_finance_income_data()
      OR (
        current_user_role() = 'client'::app_role
        AND client_id = current_user_client_id()
        AND entry_type = 'service'::income_entry_type
      )
      OR (
        current_user_role() = 'sales_rep'::app_role
        AND entry_type = 'product_sale'::income_entry_type
      )
    )
  );

NOTIFY pgrst, 'reload schema';

COMMIT;
