-- Script 181: Tenant-scope leave approver resolution and harden change_leave_approver.
-- Also fixes approvers PK to (tenant_id, employee_id) for multi-tenant safety.
-- Apply staging first; production after verification.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. approvers: composite primary key (employee_id alone is not tenant-unique)
-- ---------------------------------------------------------------------------
ALTER TABLE public.approvers
  DROP CONSTRAINT IF EXISTS approvers_pkey;

ALTER TABLE public.approvers
  ADD CONSTRAINT approvers_pkey PRIMARY KEY (tenant_id, employee_id);

-- ---------------------------------------------------------------------------
-- 2. current_leave_approver_auth_uid — resolve within caller's tenant only
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.current_leave_approver_auth_uid()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT lac.approver_user_account_id
  FROM public.leave_approver_config lac
  WHERE lac.tenant_id = public.current_user_tenant_id()
  ORDER BY lac.effective_from DESC, lac.created_at DESC
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.current_leave_approver_auth_uid() IS
  'Returns the active leave approver auth_uid for the current user tenant only.';

-- ---------------------------------------------------------------------------
-- 3. change_leave_approver — same-tenant guard + explicit tenant_id on insert
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.change_leave_approver(
  p_approver_auth_uid uuid,
  p_effective_from date DEFAULT CURRENT_DATE,
  p_notes text DEFAULT NULL
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
    notes
  )
  VALUES (
    v_tenant_id,
    p_approver_auth_uid,
    COALESCE(p_effective_from, CURRENT_DATE),
    NULLIF(TRIM(p_notes), '')
  )
  RETURNING id INTO v_config_id;

  RETURN v_config_id;
END;
$$;

COMMENT ON FUNCTION public.change_leave_approver(uuid, date, text) IS
  'Super-admin only: append a leave approver assignment for the current tenant.';

GRANT EXECUTE ON FUNCTION public.current_leave_approver_auth_uid() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.change_leave_approver(uuid, date, text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
