BEGIN;

CREATE OR REPLACE FUNCTION public.assert_caller_can_act_for_tenant(p_tenant_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_jwt_claims text;
  v_jwt_role text;
  v_session_role text;
BEGIN
  v_jwt_claims := nullif(btrim(coalesce(current_setting('request.jwt.claims', true), '')), '');
  IF v_jwt_claims = 'null' THEN
    v_jwt_claims := NULL;
  END IF;

  v_session_role := nullif(btrim(coalesce(current_setting('role', true), '')), '');

  IF v_jwt_claims IS NULL THEN
    IF v_session_role IN ('anon', 'authenticated') THEN
      RAISE EXCEPTION 'Tenant access denied.'
        USING ERRCODE = '42501';
    END IF;
    RETURN;
  END IF;

  v_jwt_role := coalesce(
    nullif(btrim(current_setting('request.jwt.claim.role', true)), ''),
    nullif(btrim(auth.jwt() ->> 'role'), ''),
    nullif(btrim(auth.role()), '')
  );

  IF v_jwt_role = 'service_role' THEN
    RETURN;
  END IF;

  IF v_jwt_role = 'anon' THEN
    RAISE EXCEPTION 'Tenant access denied.'
      USING ERRCODE = '42501';
  END IF;

  IF p_tenant_id IS NULL OR NOT public.tenant_matches(p_tenant_id) THEN
    RAISE EXCEPTION 'Tenant access denied.'
      USING ERRCODE = '42501';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_caller_can_act_for_tenant(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_caller_can_act_for_tenant(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.assert_caller_can_act_for_tenant(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.assert_caller_can_act_for_tenant(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
