-- 260_change_leave_approver_business_unit.sql
-- Phase 5d: stamp business_unit_id on leave_approver_config create via RPC.
-- Staging first. DROP old 3-arg overload; new signature keeps DEFAULT NULL
-- so callers that omit p_business_unit_id still work (All Businesses / system).

BEGIN;

DROP FUNCTION IF EXISTS public.change_leave_approver(uuid, date, text);
DROP FUNCTION IF EXISTS public.change_leave_approver(uuid, date, text, uuid);

CREATE OR REPLACE FUNCTION public.change_leave_approver(
  p_approver_auth_uid uuid,
  p_effective_from date DEFAULT CURRENT_DATE,
  p_notes text DEFAULT NULL,
  p_business_unit_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_config_id uuid;
  v_tenant_id uuid;
BEGIN
  IF NOT public.is_super_admin() THEN
    RAISE EXCEPTION 'Only administrators can change the leave approver';
  END IF;

  v_tenant_id := public.current_user_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Unable to resolve tenant for leave approver change';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.user_accounts ua
    WHERE ua.auth_uid = p_approver_auth_uid
      AND ua.tenant_id = v_tenant_id
      AND ua.is_active IS NOT FALSE
  ) THEN
    RAISE EXCEPTION 'Selected approver user account does not exist or is inactive in your workspace';
  END IF;

  INSERT INTO public.leave_approver_config (
    tenant_id,
    approver_user_account_id,
    effective_from,
    notes,
    business_unit_id
  )
  VALUES (
    v_tenant_id,
    p_approver_auth_uid,
    COALESCE(p_effective_from, CURRENT_DATE),
    NULLIF(TRIM(p_notes), ''),
    p_business_unit_id
  )
  RETURNING id INTO v_config_id;

  RETURN v_config_id;
END;
$$;

COMMENT ON FUNCTION public.change_leave_approver(uuid, date, text, uuid) IS
  'Super-admin only: append a leave approver assignment for the current tenant; optional business_unit_id stamp on create.';

GRANT EXECUTE ON FUNCTION public.change_leave_approver(uuid, date, text, uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
