DROP TABLE IF EXISTS pg_temp.guard_test;

CREATE TEMP TABLE guard_test (test text, expected text, result text);

DO $$
DECLARE
  v_davors uuid := '00000001-0000-4000-8000-000000000001';
  v_uid uuid;
  v_other_tenant uuid;
  r record;
BEGIN
  SELECT auth_uid, tenant_id
  INTO v_uid, v_other_tenant
  FROM public.user_accounts
  WHERE tenant_id <> v_davors
    AND auth_uid IS NOT NULL
    AND is_active IS NOT FALSE
  LIMIT 1;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No active non-Davors user found to test with';
  END IF;

  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  FOR r IN
    SELECT *
    FROM (VALUES
      ('1 direct DB session, no claims', '', v_davors, 'allowed'),
      ('2 anon', json_build_object('role', 'anon')::text, v_davors, 'denied 42501'),
      ('3 service_role', json_build_object('role', 'service_role')::text, v_davors, 'allowed'),
      ('4 other-tenant user acting for Davors', json_build_object('role', 'authenticated', 'sub', v_uid)::text, v_davors, 'denied 42501'),
      ('5 other-tenant user acting for own tenant', json_build_object('role', 'authenticated', 'sub', v_uid)::text, v_other_tenant, 'allowed'),
      ('6 other-tenant user with null tenant', json_build_object('role', 'authenticated', 'sub', v_uid)::text, NULL::uuid, 'denied 42501')
    ) AS t(test, claims, tenant, expected)
  LOOP
    PERFORM set_config('request.jwt.claims', r.claims, true);
    BEGIN
      PERFORM public.assert_caller_can_act_for_tenant(r.tenant);
      INSERT INTO guard_test VALUES (r.test, r.expected, 'allowed');
    EXCEPTION WHEN OTHERS THEN
      INSERT INTO guard_test VALUES (r.test, r.expected, 'denied ' || SQLSTATE);
    END;
  END LOOP;
END;
$$;

SELECT test, expected, result, CASE WHEN expected = result THEN 'PASS' ELSE 'FAIL' END AS outcome
FROM guard_test
ORDER BY test;
