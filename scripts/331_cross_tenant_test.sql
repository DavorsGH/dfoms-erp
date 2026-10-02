DROP TABLE IF EXISTS pg_temp.guard331_test;

CREATE TEMP TABLE guard331_test (test text, expected text, result text, detail text);

DO $$
DECLARE
  v_davors uuid := '00000001-0000-4000-8000-000000000001';
  v_uid uuid;
  v_other uuid;
  v_ir uuid;
  v_cn uuid;
  v_ap uuid;
  v_lr uuid;
  v_lt uuid;
  v_user_claims text;
  v_srv_claims text;
  r record;
  v_state text;
  v_msg text;
BEGIN
  SELECT auth_uid, tenant_id
  INTO v_uid, v_other
  FROM public.user_accounts
  WHERE tenant_id <> v_davors
    AND auth_uid IS NOT NULL
    AND is_active IS NOT FALSE
  LIMIT 1;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No active non-Davors user found to test with';
  END IF;

  SELECT id INTO v_ir FROM public.income_register WHERE tenant_id = v_davors LIMIT 1;
  SELECT id INTO v_cn FROM public.credit_notes WHERE tenant_id = v_davors LIMIT 1;
  SELECT id INTO v_ap FROM public.accounts_payable WHERE tenant_id = v_davors LIMIT 1;
  SELECT id INTO v_lr FROM public.leave_requests WHERE tenant_id = v_davors LIMIT 1;
  SELECT id INTO v_lt FROM public.leave_types WHERE tenant_id = v_davors LIMIT 1;

  v_user_claims := json_build_object('role', 'authenticated', 'sub', v_uid)::text;
  v_srv_claims := json_build_object('role', 'service_role')::text;

  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  FOR r IN
    SELECT *
    FROM (VALUES
      ('01 save_client_invoice for Davors', 'authenticated', v_user_claims,
        format('SELECT public.save_client_invoice(%L::uuid, NULL::uuid, NULL::uuid, %L::jsonb)', v_davors, '{}'), 'denied'),
      ('02 change_client_invoice_status for Davors', 'authenticated', v_user_claims,
        format('SELECT public.change_client_invoice_status(%L::uuid, gen_random_uuid(), %L)', v_davors, 'void'), 'denied'),
      ('03 void_client_invoice for Davors', 'authenticated', v_user_claims,
        format('SELECT public.void_client_invoice(%L::uuid, gen_random_uuid())', v_davors), 'denied'),
      ('04 delete_accounts_payable for Davors', 'authenticated', v_user_claims,
        format('SELECT public.delete_accounts_payable(%L::uuid, gen_random_uuid())', v_davors), 'denied'),
      ('05 delete_fixed_asset for Davors', 'authenticated', v_user_claims,
        format('SELECT public.delete_fixed_asset(%L::uuid, %L)', v_davors, 'GUARD-TEST'), 'denied'),
      ('06 generate_next_code for Davors', 'authenticated', v_user_claims,
        format('SELECT public.generate_next_code(%L::uuid, %L, 4)', v_davors, 'invoice'), 'denied'),
      ('07 void_product_sale on Davors sale' || CASE WHEN v_ir IS NULL THEN ' (no Davors row)' ELSE '' END, 'authenticated', v_user_claims,
        format('SELECT public.void_product_sale(%L::uuid)', v_ir), 'denied'),
      ('08 create_product_return on Davors sale' || CASE WHEN v_ir IS NULL THEN ' (no Davors row)' ELSE '' END, 'authenticated', v_user_claims,
        format('SELECT public.create_product_return(%L::uuid, %L::jsonb, %L)', v_ir, '[]', 'guard test'), 'denied'),
      ('09 record_refund on Davors credit note' || CASE WHEN v_cn IS NULL THEN ' (no Davors row)' ELSE '' END, 'authenticated', v_user_claims,
        format('SELECT public.record_refund(%L::uuid, 1::numeric, %L, %L)', v_cn, 'Cash', 'guard test'), 'denied'),
      ('10 recompute_accounts_payable on Davors AP' || CASE WHEN v_ap IS NULL THEN ' (no Davors row)' ELSE '' END, 'authenticated', v_user_claims,
        format('SELECT public.recompute_accounts_payable_from_payments(%L::uuid)', v_ap), 'denied'),
      ('11 reverse_fixed_asset_payable on Davors AP' || CASE WHEN v_ap IS NULL THEN ' (no Davors row)' ELSE '' END, 'authenticated', v_user_claims,
        format('SELECT public.reverse_fixed_asset_payable(%L::uuid)', v_ap), 'denied'),
      ('12 approve_leave_request on Davors leave' || CASE WHEN v_lr IS NULL THEN ' (no Davors row)' ELSE '' END, 'authenticated', v_user_claims,
        format('SELECT public.approve_leave_request(%L::uuid, %L)', v_lr, 'guard test'), 'denied'),
      ('13 reject_leave_request on Davors leave' || CASE WHEN v_lr IS NULL THEN ' (no Davors row)' ELSE '' END, 'authenticated', v_user_claims,
        format('SELECT public.reject_leave_request(%L::uuid, %L)', v_lr, 'guard test'), 'denied'),
      ('14 cancel_leave_request on Davors leave' || CASE WHEN v_lr IS NULL THEN ' (no Davors row)' ELSE '' END, 'authenticated', v_user_claims,
        format('SELECT public.cancel_leave_request(%L::uuid)', v_lr), 'denied'),
      ('15 submit_leave_request with Davors leave type' || CASE WHEN v_lt IS NULL THEN ' (no Davors-only leave type)' ELSE '' END, 'authenticated', v_user_claims,
        format('SELECT public.submit_leave_request(%L::uuid, current_date, current_date, %L)', v_lt, 'guard test'),
        CASE WHEN v_lt IS NULL THEN 'passed' ELSE 'denied' END),
      ('16 CONTROL own tenant generate_next_code', 'authenticated', v_user_claims,
        format('SELECT public.generate_next_code(%L::uuid, %L, 4)', v_other, 'invoice'), 'passed'),
      ('17 CONTROL service_role for Davors', NULL, v_srv_claims,
        format('SELECT public.generate_next_code(%L::uuid, %L, 4)', v_davors, 'invoice'), 'passed'),
      ('18 CONTROL authenticated session with no claims', 'authenticated', '',
        format('SELECT public.generate_next_code(%L::uuid, %L, 4)', v_davors, 'invoice'), 'denied')
    ) AS t(test, role_name, claims, sql_text, expected)
  LOOP
    v_state := NULL;
    v_msg := NULL;
    BEGIN
      PERFORM set_config('request.jwt.claims', r.claims, true);
      IF r.role_name IS NOT NULL THEN
        PERFORM set_config('role', r.role_name, true);
      END IF;
      EXECUTE r.sql_text;
      RAISE EXCEPTION 'guard331_rollback' USING ERRCODE = 'P0099';
    EXCEPTION WHEN OTHERS THEN
      v_state := SQLSTATE;
      v_msg := SQLERRM;
    END;

    INSERT INTO guard331_test VALUES (
      r.test,
      r.expected,
      CASE WHEN v_state = '42501' AND v_msg = 'Tenant access denied.' THEN 'denied' ELSE 'passed' END,
      CASE WHEN v_state = 'P0099' THEN 'call completed (rolled back)' ELSE v_state || ': ' || v_msg END
    );
  END LOOP;
END;
$$;

SELECT test, expected, result, CASE WHEN expected = result THEN 'PASS' ELSE 'FAIL' END AS outcome, detail
FROM guard331_test
ORDER BY test;
