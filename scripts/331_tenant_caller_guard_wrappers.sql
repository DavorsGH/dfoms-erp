BEGIN;

CREATE OR REPLACE FUNCTION public.dfoms_tenant_guard_expr(p_proname text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_proname
    WHEN 'save_client_invoice' THEN 'p_tenant_id'
    WHEN 'change_client_invoice_status' THEN 'p_tenant_id'
    WHEN 'void_client_invoice' THEN 'p_tenant_id'
    WHEN 'checkout_pos_cart' THEN 'p_tenant_id'
    WHEN 'save_accounts_payable' THEN 'p_tenant_id'
    WHEN 'delete_accounts_payable' THEN 'p_tenant_id'
    WHEN 'record_supplier_contract_replacement_payment' THEN 'p_tenant_id'
    WHEN 'save_fixed_asset' THEN 'p_tenant_id'
    WHEN 'delete_fixed_asset' THEN 'p_tenant_id'
    WHEN 'create_fixed_asset_payable' THEN 'p_tenant_id'
    WHEN 'sync_fixed_asset_payable' THEN 'p_tenant_id'
    WHEN 'generate_next_code' THEN 'p_tenant_id'
    WHEN 'void_product_sale' THEN 'income_register'
    WHEN 'create_product_return' THEN 'income_register_any'
    WHEN 'record_refund' THEN 'credit_note'
    WHEN 'recompute_accounts_payable_from_payments' THEN 'ap_id'
    WHEN 'reverse_fixed_asset_payable' THEN 'payable_id'
    WHEN 'replace_purchase_tax_ledger_entries' THEN 'purchase_source'
    WHEN 'submit_leave_request' THEN 'session_tenant'
    WHEN 'approve_leave_request' THEN 'leave_request'
    WHEN 'reject_leave_request' THEN 'leave_request'
    WHEN 'cancel_leave_request' THEN 'leave_request'
    ELSE NULL
  END;
$$;

CREATE OR REPLACE FUNCTION public.dfoms_build_tenant_guard_block(p_mode text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_mode
    WHEN 'p_tenant_id' THEN
      $b$v_tenant := p_tenant_id;
PERFORM public.assert_caller_can_act_for_tenant(v_tenant);$b$
    WHEN 'income_register' THEN
      $b$SELECT ir.tenant_id INTO v_tenant
FROM public.income_register ir
WHERE ir.id = p_income_id;
IF v_tenant IS NOT NULL THEN
  PERFORM public.assert_caller_can_act_for_tenant(v_tenant);
END IF;$b$
    WHEN 'income_register_any' THEN
      $b$SELECT ir.tenant_id INTO v_tenant
FROM public.income_register ir
WHERE ir.id = p_income_register_id;
IF v_tenant IS NOT NULL THEN
  PERFORM public.assert_caller_can_act_for_tenant(v_tenant);
END IF;$b$
    WHEN 'credit_note' THEN
      $b$SELECT cn.tenant_id INTO v_tenant
FROM public.credit_notes cn
WHERE cn.id = p_credit_note_id;
IF v_tenant IS NOT NULL THEN
  PERFORM public.assert_caller_can_act_for_tenant(v_tenant);
END IF;$b$
    WHEN 'ap_id' THEN
      $b$SELECT ap.tenant_id INTO v_tenant
FROM public.accounts_payable ap
WHERE ap.id = p_ap_id;
IF v_tenant IS NOT NULL THEN
  PERFORM public.assert_caller_can_act_for_tenant(v_tenant);
END IF;$b$
    WHEN 'payable_id' THEN
      $b$SELECT ap.tenant_id INTO v_tenant
FROM public.accounts_payable ap
WHERE ap.id = p_payable_id;
IF v_tenant IS NOT NULL THEN
  PERFORM public.assert_caller_can_act_for_tenant(v_tenant);
END IF;$b$
    WHEN 'purchase_source' THEN
      $b$SELECT ctx.tenant_id INTO v_tenant
FROM public._pur_lookup_purchase_source_context(p_source_type, p_source_id) ctx;
IF v_tenant IS NOT NULL THEN
  PERFORM public.assert_caller_can_act_for_tenant(v_tenant);
END IF;$b$
    WHEN 'leave_request' THEN
      $b$SELECT COALESCE(lr.tenant_id, e.tenant_id) INTO v_tenant
FROM public.leave_requests lr
LEFT JOIN public.employees e ON e.employee_id = lr.employee_id
WHERE lr.id = p_request_id;
IF v_tenant IS NOT NULL THEN
  PERFORM public.assert_caller_can_act_for_tenant(v_tenant);
END IF;$b$
    WHEN 'session_tenant' THEN
      $b$v_tenant := public.current_user_tenant_id();
PERFORM public.assert_caller_can_act_for_tenant(v_tenant);$b$
    ELSE NULL
  END;
$$;

DO $$
DECLARE
  v_targets text[] := ARRAY[
    'save_client_invoice',
    'change_client_invoice_status',
    'void_client_invoice',
    'checkout_pos_cart',
    'void_product_sale',
    'record_refund',
    'save_accounts_payable',
    'delete_accounts_payable',
    'recompute_accounts_payable_from_payments',
    'record_supplier_contract_replacement_payment',
    'save_fixed_asset',
    'delete_fixed_asset',
    'create_fixed_asset_payable',
    'sync_fixed_asset_payable',
    'reverse_fixed_asset_payable',
    'replace_purchase_tax_ledger_entries',
    'generate_next_code',
    'submit_leave_request',
    'approve_leave_request',
    'reject_leave_request',
    'cancel_leave_request',
    'create_product_return'
  ];
  v_name text;
  v_mode text;
  v_guard text;
  rec record;
  v_impl_name text;
  v_identity_args text;
  v_decl_args text;
  v_result_type text;
  v_call_sql text;
  v_body text;
  v_create_sql text;
  v_found boolean;
BEGIN
  FOREACH v_name IN ARRAY v_targets
  LOOP
    v_found := false;
    v_mode := public.dfoms_tenant_guard_expr(v_name);
    IF v_mode IS NULL THEN
      RAISE NOTICE 'dfoms_wrap_skip unknown tenant mode for %', v_name;
      CONTINUE;
    END IF;
    v_guard := public.dfoms_build_tenant_guard_block(v_mode);
    IF v_guard IS NULL THEN
      RAISE NOTICE 'dfoms_wrap_skip missing guard block for %', v_name;
      CONTINUE;
    END IF;

    FOR rec IN
      SELECT
        p.oid,
        p.proname,
        p.proretset,
        p.prorettype,
        p.proargtypes,
        pg_get_function_identity_arguments(p.oid) AS identity_args,
        pg_get_function_arguments(p.oid) AS decl_args,
        pg_get_function_result(p.oid) AS result_type
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = v_name
        AND p.prokind = 'f'
    LOOP
      v_found := true;
      v_impl_name := rec.proname || '__impl';
      v_identity_args := rec.identity_args;
      v_decl_args := rec.decl_args;
      v_result_type := rec.result_type;

      IF EXISTS (
        SELECT 1
        FROM pg_proc p2
        JOIN pg_namespace n2 ON n2.oid = p2.pronamespace
        WHERE n2.nspname = 'public'
          AND p2.proname = v_impl_name
          AND p2.proargtypes = rec.proargtypes
      ) THEN
        RAISE NOTICE 'dfoms_wrap_skip already wrapped % (%)', v_name, v_identity_args;
        CONTINUE;
      END IF;

      IF EXISTS (
        SELECT 1
        FROM pg_proc px
        WHERE px.oid = rec.oid
          AND px.proargmodes IS NOT NULL
          AND EXISTS (
            SELECT 1
            FROM unnest(px.proargmodes) AS m(mode)
            WHERE m.mode IN ('o', 'b', 'v', 't')
          )
      ) THEN
        RAISE NOTICE 'dfoms_wrap_skip non_generic signature % (%)', v_name, v_identity_args;
        CONTINUE;
      END IF;

      IF rec.proretset THEN
        v_call_sql := format(
          'RETURN QUERY SELECT * FROM public.%I(%s)',
          v_impl_name,
          v_identity_args
        );
      ELSIF rec.prorettype = 'pg_catalog.void'::regtype THEN
        v_call_sql := format(
          'PERFORM public.%I(%s)',
          v_impl_name,
          v_identity_args
        );
      ELSE
        v_call_sql := format(
          'RETURN public.%I(%s)',
          v_impl_name,
          v_identity_args
        );
      END IF;

      EXECUTE format(
        'ALTER FUNCTION public.%I(%s) RENAME TO %I',
        rec.proname,
        v_identity_args,
        v_impl_name
      );

      EXECUTE format(
        'REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC',
        v_impl_name,
        v_identity_args
      );
      EXECUTE format(
        'REVOKE ALL ON FUNCTION public.%I(%s) FROM anon',
        v_impl_name,
        v_identity_args
      );
      EXECUTE format(
        'REVOKE ALL ON FUNCTION public.%I(%s) FROM authenticated',
        v_impl_name,
        v_identity_args
      );
      EXECUTE format(
        'GRANT EXECUTE ON FUNCTION public.%I(%s) TO service_role',
        v_impl_name,
        v_identity_args
      );

      v_body := format(
        $wrap$DECLARE
  v_tenant uuid;
BEGIN
%s
%s
END;$wrap$,
        v_guard,
        v_call_sql
      );

      v_create_sql := format(
        'CREATE OR REPLACE FUNCTION public.%I(%s) RETURNS %s LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $dfoms_w$%s$dfoms_w$',
        rec.proname,
        v_decl_args,
        v_result_type,
        v_body
      );

      EXECUTE v_create_sql;

      EXECUTE format(
        'REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC',
        rec.proname,
        v_identity_args
      );
      EXECUTE format(
        'REVOKE ALL ON FUNCTION public.%I(%s) FROM anon',
        rec.proname,
        v_identity_args
      );
      EXECUTE format(
        'GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated, service_role',
        rec.proname,
        v_identity_args
      );

      RAISE NOTICE 'dfoms_wrap_ok % (%)', v_name, v_identity_args;
    END LOOP;

    IF NOT v_found THEN
      RAISE NOTICE 'dfoms_wrap_skip not found %', v_name;
    END IF;
  END LOOP;
END;
$$;

DROP FUNCTION public.dfoms_build_tenant_guard_block(text);
DROP FUNCTION public.dfoms_tenant_guard_expr(text);

NOTIFY pgrst, 'reload schema';

COMMIT;
