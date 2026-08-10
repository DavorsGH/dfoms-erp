-- 198_commission_cancel_status.sql
-- Allow pending commission calculations to be cancelled (audit trail retained).

BEGIN;

CREATE OR REPLACE FUNCTION public.set_commission_status(
  p_calc_id uuid,
  p_new_status text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tenant_id uuid;
  v_current_status text;
BEGIN
  IF current_user_role() NOT IN (
    'super_admin'::app_role,
    'finance'::app_role,
    'hr'::app_role
  ) THEN
    RAISE EXCEPTION 'You do not have permission to update commission status';
  END IF;

  v_tenant_id := current_user_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Unable to resolve workspace for current user';
  END IF;

  IF NOT tenant_has_feature(v_tenant_id, 'crm_core') THEN
    RAISE EXCEPTION 'CRM is not enabled for this workspace';
  END IF;

  SELECT status
  INTO v_current_status
  FROM public.commission_calculations
  WHERE id = p_calc_id
    AND tenant_id = v_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Commission calculation not found';
  END IF;

  IF p_new_status = 'approved' AND v_current_status = 'pending' THEN
    UPDATE public.commission_calculations
    SET status = 'approved',
        approved_at = now()
    WHERE id = p_calc_id
      AND tenant_id = v_tenant_id;
    RETURN;
  END IF;

  IF p_new_status = 'paid' AND v_current_status = 'approved' THEN
    UPDATE public.commission_calculations
    SET status = 'paid',
        paid_at = now()
    WHERE id = p_calc_id
      AND tenant_id = v_tenant_id;
    RETURN;
  END IF;

  IF p_new_status = 'cancelled' AND v_current_status = 'pending' THEN
    UPDATE public.commission_calculations
    SET status = 'cancelled',
        approved_at = NULL,
        paid_at = NULL
    WHERE id = p_calc_id
      AND tenant_id = v_tenant_id;
    RETURN;
  END IF;

  RAISE EXCEPTION 'Invalid commission status transition from % to %',
    v_current_status, p_new_status;
END;
$$;

GRANT EXECUTE ON FUNCTION public.set_commission_status(uuid, text)
  TO authenticated, service_role;

DO $$
BEGIN
  IF to_regprocedure('public.set_commission_status(uuid,text)') IS NULL THEN
    RAISE EXCEPTION 'set_commission_status function missing after migration';
  END IF;
  RAISE NOTICE 'Script 198 complete: commission pending → cancelled transition enabled.';
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
