-- Script 213: Tenant-wide default leave entitlements (visible in Leave Settings UI).
-- Sentinel rows: position = __DEFAULT__, employment_type = __ALL__.
-- resolve_leave_entitlement checks these before the legacy hardcoded fallback.

BEGIN;

ALTER TABLE public.leave_entitlement_policy
  DROP CONSTRAINT IF EXISTS leave_entitlement_policy_employment_type_check;

ALTER TABLE public.leave_entitlement_policy
  ADD CONSTRAINT leave_entitlement_policy_employment_type_check
  CHECK (
    employment_type = ANY (
      ARRAY[
        'Casual'::text,
        'Part-Time'::text,
        'Full-Time'::text,
        'Contract'::text,
        '__ALL__'::text
      ]
    )
  );

CREATE OR REPLACE FUNCTION public.resolve_leave_entitlement(
  p_tenant_id uuid,
  p_position text,
  p_employment_type text,
  p_leave_type text
)
RETURNS numeric
LANGUAGE plpgsql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_days numeric(8, 2);
  v_leave text := btrim(COALESCE(p_leave_type, ''));
  v_pos text := btrim(COALESCE(p_position, ''));
  v_emp text := btrim(COALESCE(p_employment_type, ''));
BEGIN
  IF p_tenant_id IS NOT NULL AND v_pos <> '' AND v_emp <> '' AND v_leave <> '' THEN
    SELECT lep.entitled_days
    INTO v_days
    FROM public.leave_entitlement_policy lep
    WHERE lep.tenant_id = p_tenant_id
      AND lep."position" = v_pos
      AND lep.employment_type = v_emp
      AND lep.leave_type = v_leave
    LIMIT 1;

    IF FOUND THEN
      RETURN COALESCE(v_days, 0);
    END IF;
  END IF;

  IF p_tenant_id IS NOT NULL AND v_leave <> '' THEN
    SELECT lep.entitled_days
    INTO v_days
    FROM public.leave_entitlement_policy lep
    WHERE lep.tenant_id = p_tenant_id
      AND lep."position" = '__DEFAULT__'
      AND lep.employment_type = '__ALL__'
      AND lep.leave_type = v_leave
    LIMIT 1;

    IF FOUND THEN
      RETURN COALESCE(v_days, 0);
    END IF;
  END IF;

  IF v_leave = 'Annual Leave' THEN
    RETURN 15;
  END IF;

  RETURN 0;
END;
$$;

COMMENT ON FUNCTION public.resolve_leave_entitlement(uuid, text, text, text) IS
  'Leave entitlement days from leave_entitlement_policy (position-specific, then tenant default __DEFAULT__/__ALL__, else Annual=15 / Sick=0 / Unpaid=0).';

COMMIT;

NOTIFY pgrst, 'reload schema';
