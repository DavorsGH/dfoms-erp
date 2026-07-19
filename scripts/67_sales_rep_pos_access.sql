-- Script 67: sales_rep POS — read customers + insert product_sale income rows.

BEGIN;

CREATE OR REPLACE FUNCTION can_access_client_record(p_client_id text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT CASE current_user_role()
    WHEN 'super_admin'::app_role THEN true
    WHEN 'finance'::app_role THEN true
    WHEN 'hr'::app_role THEN true
    WHEN 'operations_manager'::app_role THEN true
    WHEN 'supervisor'::app_role THEN true
    WHEN 'sales_rep'::app_role THEN true
    WHEN 'client'::app_role THEN
      p_client_id IS NOT NULL
      AND p_client_id = current_user_client_id()
    ELSE false
  END;
$$;

DROP POLICY IF EXISTS income_register_sales_rep_insert ON income_register;
CREATE POLICY income_register_sales_rep_insert
  ON income_register
  FOR INSERT
  TO authenticated
  WITH CHECK (
    tenant_matches(tenant_id)
    AND current_user_role() = 'sales_rep'::app_role
    AND entry_type = 'product_sale'::income_entry_type
  );

NOTIFY pgrst, 'reload schema';

COMMIT;
