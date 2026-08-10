-- 197_sales_opportunity_edit_delete.sql
-- Edit and delete RPCs for Sales Pipeline opportunities (tenant-scoped, CRM roles).

BEGIN;

CREATE OR REPLACE FUNCTION public.update_sales_opportunity(
  p_opportunity_id uuid,
  p_client_id text,
  p_opportunity_name text,
  p_estimated_value numeric DEFAULT NULL,
  p_probability integer DEFAULT NULL,
  p_expected_close_date date DEFAULT NULL,
  p_source text DEFAULT NULL,
  p_assigned_to text DEFAULT NULL,
  p_notes text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_opportunity public.sales_opportunities%ROWTYPE;
BEGIN
  IF current_user_role() NOT IN (
    'super_admin'::app_role,
    'finance'::app_role,
    'hr'::app_role
  ) THEN
    RAISE EXCEPTION 'You do not have permission to edit sales opportunities';
  END IF;

  v_tenant_id := current_user_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Unable to resolve workspace for current user';
  END IF;

  IF NOT tenant_has_feature(v_tenant_id, 'crm_core') THEN
    RAISE EXCEPTION 'CRM is not enabled for this workspace';
  END IF;

  SELECT *
  INTO v_opportunity
  FROM public.sales_opportunities
  WHERE id = p_opportunity_id
    AND tenant_id = v_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Opportunity not found';
  END IF;

  IF NULLIF(trim(p_client_id), '') IS NULL THEN
    RAISE EXCEPTION 'Customer is required';
  END IF;

  IF NULLIF(trim(p_opportunity_name), '') IS NULL THEN
    RAISE EXCEPTION 'Opportunity name is required';
  END IF;

  IF p_estimated_value IS NOT NULL AND p_estimated_value < 0 THEN
    RAISE EXCEPTION 'Estimated value must be non-negative';
  END IF;

  IF p_probability IS NOT NULL AND (p_probability < 0 OR p_probability > 100) THEN
    RAISE EXCEPTION 'Probability must be between 0 and 100';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.customers c
    WHERE c.client_id = trim(p_client_id)
      AND c.tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'Selected customer does not exist in your workspace';
  END IF;

  IF NULLIF(trim(p_assigned_to), '') IS NOT NULL AND NOT EXISTS (
    SELECT 1
    FROM public.employees e
    WHERE e.employee_id = trim(p_assigned_to)
      AND e.tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'Selected assigned rep does not exist in your workspace';
  END IF;

  UPDATE public.sales_opportunities
  SET
    client_id = trim(p_client_id),
    opportunity_name = trim(p_opportunity_name),
    estimated_value = p_estimated_value,
    probability = p_probability,
    expected_close_date = p_expected_close_date,
    source = NULLIF(trim(p_source), ''),
    assigned_to = NULLIF(trim(p_assigned_to), ''),
    notes = NULLIF(trim(p_notes), ''),
    updated_at = now()
  WHERE id = p_opportunity_id
    AND tenant_id = v_tenant_id;

  RETURN p_opportunity_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_sales_opportunity(
  p_opportunity_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_quotation_count integer := 0;
  v_quote_count integer := 0;
BEGIN
  IF current_user_role() NOT IN (
    'super_admin'::app_role,
    'finance'::app_role,
    'hr'::app_role
  ) THEN
    RAISE EXCEPTION 'You do not have permission to delete sales opportunities';
  END IF;

  v_tenant_id := current_user_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Unable to resolve workspace for current user';
  END IF;

  IF NOT tenant_has_feature(v_tenant_id, 'crm_core') THEN
    RAISE EXCEPTION 'CRM is not enabled for this workspace';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.sales_opportunities
    WHERE id = p_opportunity_id
      AND tenant_id = v_tenant_id
  ) THEN
    RAISE EXCEPTION 'Opportunity not found';
  END IF;

  SELECT count(*)::integer
  INTO v_quotation_count
  FROM public.client_quotations
  WHERE opportunity_id = p_opportunity_id
    AND tenant_id = v_tenant_id;

  IF v_quotation_count > 0 THEN
    RAISE EXCEPTION
      'Cannot delete: % quotation(s) are linked to this opportunity. Remove or reassign them first.',
      v_quotation_count;
  END IF;

  SELECT count(*)::integer
  INTO v_quote_count
  FROM public.sales_quotes
  WHERE opportunity_id = p_opportunity_id
    AND tenant_id = v_tenant_id;

  IF v_quote_count > 0 THEN
    RAISE EXCEPTION
      'Cannot delete: % product quote(s) are linked to this opportunity. Remove or reassign them first.',
      v_quote_count;
  END IF;

  DELETE FROM public.sales_activities
  WHERE opportunity_id = p_opportunity_id
    AND tenant_id = v_tenant_id;

  DELETE FROM public.sales_opportunities
  WHERE id = p_opportunity_id
    AND tenant_id = v_tenant_id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.update_sales_opportunity(
  uuid, text, text, numeric, integer, date, text, text, text
) TO authenticated, service_role;

GRANT EXECUTE ON FUNCTION public.delete_sales_opportunity(uuid)
  TO authenticated, service_role;

DO $$
BEGIN
  IF to_regprocedure(
    'public.update_sales_opportunity(uuid,text,text,numeric,integer,date,text,text,text)'
  ) IS NULL THEN
    RAISE EXCEPTION 'update_sales_opportunity function missing after migration';
  END IF;

  IF to_regprocedure('public.delete_sales_opportunity(uuid)') IS NULL THEN
    RAISE EXCEPTION 'delete_sales_opportunity function missing after migration';
  END IF;

  RAISE NOTICE 'Script 197 complete: sales opportunity edit/delete RPCs added.';
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
