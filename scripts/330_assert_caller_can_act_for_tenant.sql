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
  v_has_postgrest_jwt boolean;
BEGIN
  v_jwt_claims := current_setting('request.jwt.claims', true);
  v_has_postgrest_jwt :=
    v_jwt_claims IS NOT NULL
    AND btrim(v_jwt_claims) <> ''
    AND btrim(v_jwt_claims) <> 'null';

  IF NOT v_has_postgrest_jwt THEN
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
GRANT EXECUTE ON FUNCTION public.assert_caller_can_act_for_tenant(uuid)
  TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
