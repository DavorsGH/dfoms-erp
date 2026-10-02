DROP TABLE IF EXISTS pg_temp.guard331_same;

CREATE TEMP TABLE guard331_same (test text, expected text, result text, detail text);

DO $$
DECLARE
  v_davors uuid := '00000001-0000-4000-8000-000000000001';
  v_uid uuid;
  v_ir uuid;
  v_cn uuid;
  v_ap uuid;
  v_lr uuid;
  v_lt uuid;
  v_claims text;
  r record;
  v_state text;
  v_msg text;
BEGIN
  SELECT auth_uid INTO v_uid
  FROM public.user_accounts
  WHERE tenant_id = v_davors
    AND auth_uid IS NOT NULL
    AND is_active IS NOT FALSE
  LIMIT 1;

  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'No active Davors user found to test with';
  END IF;

  SELECT id INTO v_ir FROM public.income_register WHERE tenant_id = v_davors LIMIT 1;
  SELECT id INTO v_cn FROM public.credit_notes WHERE tenant_id = v_davors LIMIT 1;
  SELECT id INTO v_ap FROM public.accounts_payable WHERE tenant_id = v_davors LIMIT 1;
  SELECT id INTO v_lr FROM public.leave_requests WHERE tenant_id = v_davors LIMIT 1;
  SELECT id INTO v_lt FROM public.leave_types WHERE tenant_id = v_davors OR tenant_id IS NULL LIMIT 1;

  v_claims := json_build_object('role', 'authenticated', 'sub', v_uid)::text;

  PERFORM set_config('request.jwt.claim.role', '', true);
  PERFORM set_config('request.jwt.claim.sub', '', true);

  FOR r IN
    SELECT *
    FROM (VALUES
      ('01 approve_leave_request own leave' || CASE WHEN v_lr IS NULL THEN ' (no Davors row)' ELSE '' END,
        format('SELECT public.approve_leave_request(%L::uuid, %L)', v_lr, 'guard test')),
      ('02 reject_leave_request own leave' || CASE WHEN v_lr IS NULL THEN ' (no Davors row)' ELSE '' END,
        format('SELECT public.reject_leave_request(%L::uuid, %L)', v_lr, 'guard test')),
      ('03 cancel_leave_request own leave' || CASE WHEN v_lr IS NULL THEN ' (no Davors row)' ELSE '' END,
        format('SELECT public.cancel_leave_request(%L::uuid)', v_lr)),
      ('04 submit_leave_request own or shared leave type' || CASE WHEN v_lt IS NULL THEN ' (no leave type)' ELSE '' END,
        format('SELECT public.submit_leave_request(%L::uuid, current_date, current_date, %L)', v_lt, 'guard test')),
      ('05 record_supplier_contract_replacement_payment own tenant',
        format('SELECT public.record_supplier_contract_replacement_payment(%L::uuid, gen_random_uuid(), NULL::uuid, current_date, %L, 0::numeric, %L, %L)', v_davors, 'guard test', 'Cash', 'guard test')),
      ('06 recompute_accounts_payable_from_payments own AP' || CASE WHEN v_ap IS NULL THEN ' (no Davors row)' ELSE '' END,
        format('SELECT public.recompute_accounts_payable_from_payments(%L::uuid)', v_ap)),
      ('07 reverse_fixed_asset_payable own AP' || CASE WHEN v_ap IS NULL THEN ' (no Davors row)' ELSE '' END,
        format('SELECT public.reverse_fixed_asset_payable(%L::uuid)', v_ap)),
      ('08 create_fixed_asset_payable own tenant',
        format('SELECT public.create_fixed_asset_payable(%L::uuid, %L, %L, current_date, 1::numeric, %L)', v_davors, 'GUARD-TEST', 'Guard Test', 'guard test')),
      ('09 sync_fixed_asset_payable own tenant',
        format('SELECT public.sync_fixed_asset_payable(%L::uuid, %L, %L, current_date, %L, 1::numeric, %L, NULL::uuid)', v_davors, 'GUARD-TEST', 'Guard Test', 'Cash', 'Guard Test')),
      ('10 void_product_sale own sale' || CASE WHEN v_ir IS NULL THEN ' (no Davors row)' ELSE '' END,
        format('SELECT public.void_product_sale(%L::uuid)', v_ir)),
      ('11 record_refund own credit note' || CASE WHEN v_cn IS NULL THEN ' (no Davors row)' ELSE '' END,
        format('SELECT public.record_refund(%L::uuid, 1::numeric, %L, %L)', v_cn, 'Cash', 'guard test'))
    ) AS t(test, sql_text)
  LOOP
    v_state := NULL;
    v_msg := NULL;
    BEGIN
      PERFORM set_config('request.jwt.claims', v_claims, true);
      PERFORM set_config('role', 'authenticated', true);
      EXECUTE r.sql_text;
      RAISE EXCEPTION 'guard331_rollback' USING ERRCODE = 'P0099';
    EXCEPTION WHEN OTHERS THEN
      v_state := SQLSTATE;
      v_msg := SQLERRM;
    END;

    INSERT INTO guard331_same VALUES (
      r.test,
      'passed',
      CASE WHEN v_state = '42501' AND v_msg = 'Tenant access denied.' THEN 'denied' ELSE 'passed' END,
      CASE WHEN v_state = 'P0099' THEN 'call completed (rolled back)' ELSE v_state || ': ' || v_msg END
    );
  END LOOP;
END;
$$;

SELECT test, expected, result, CASE WHEN expected = result THEN 'PASS' ELSE 'FAIL' END AS outcome, detail
FROM guard331_same
ORDER BY test;
