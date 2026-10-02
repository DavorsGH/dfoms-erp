BEGIN;

DO $$
DECLARE
  r record;
  v_proc record;
  v_count integer;
  v_impl text;
  v_argtypes oid[];
  v_param_pos integer;
  v_id_type oid;
  v_tenant_type oid;
  v_ctx_oid oid;
  v_call_args text;
  v_lookup text;
  v_call text;
  v_body text;
  v_auth_exec boolean;
  v_srv_exec boolean;
  v_owner oid;
  v_names text[] := '{}';
  v_name text;
  v_wrap_oid oid;
  v_impl_oid oid;
BEGIN
  IF to_regprocedure('public.assert_caller_can_act_for_tenant(uuid)') IS NULL THEN
    RAISE EXCEPTION '331 aborted: guard function from 330 is missing';
  END IF;

  SELECT oid INTO v_owner FROM pg_roles WHERE rolname = current_user;

  FOR r IN
    SELECT *
    FROM (VALUES
      ('save_client_invoice', 'tenant_param', 'p_tenant_id', NULL, NULL),
      ('change_client_invoice_status', 'tenant_param', 'p_tenant_id', NULL, NULL),
      ('void_client_invoice', 'tenant_param', 'p_tenant_id', NULL, NULL),
      ('checkout_pos_cart', 'tenant_param', 'p_tenant_id', NULL, NULL),
      ('save_accounts_payable', 'tenant_param', 'p_tenant_id', NULL, NULL),
      ('delete_accounts_payable', 'tenant_param', 'p_tenant_id', NULL, NULL),
      ('record_supplier_contract_replacement_payment', 'tenant_param', 'p_tenant_id', NULL, NULL),
      ('save_fixed_asset', 'tenant_param', 'p_tenant_id', NULL, NULL),
      ('delete_fixed_asset', 'tenant_param', 'p_tenant_id', NULL, NULL),
      ('create_fixed_asset_payable', 'tenant_param', 'p_tenant_id', NULL, NULL),
      ('sync_fixed_asset_payable', 'tenant_param', 'p_tenant_id', NULL, NULL),
      ('generate_next_code', 'tenant_param', 'p_tenant_id', NULL, NULL),
      ('void_product_sale', 'row', 'p_income_id', 'income_register', 'tenant_id'),
      ('create_product_return', 'row', 'p_income_register_id', 'income_register', 'tenant_id'),
      ('record_refund', 'row', 'p_credit_note_id', 'credit_notes', 'tenant_id'),
      ('recompute_accounts_payable_from_payments', 'row', 'p_ap_id', 'accounts_payable', 'tenant_id'),
      ('reverse_fixed_asset_payable', 'row', 'p_payable_id', 'accounts_payable', 'tenant_id'),
      ('approve_leave_request', 'row', 'p_request_id', 'leave_requests', 'tenant_id'),
      ('reject_leave_request', 'row', 'p_request_id', 'leave_requests', 'tenant_id'),
      ('cancel_leave_request', 'row', 'p_request_id', 'leave_requests', 'tenant_id'),
      ('replace_purchase_tax_ledger_entries', 'purchase_source', 'p_source_id', NULL, NULL),
      ('submit_leave_request', 'leave_type', 'p_leave_type_id', 'leave_types', 'tenant_id')
    ) AS t(fn, mode, param, tbl, col)
  LOOP
    v_names := v_names || r.fn;
    v_impl := r.fn || '__impl';

    SELECT count(*) INTO v_count
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = r.fn;

    IF v_count <> 1 THEN
      RAISE EXCEPTION '331 aborted: expected exactly one public.% but found %', r.fn, v_count;
    END IF;

    SELECT
      p.oid,
      p.proargnames,
      p.proargmodes,
      ARRAY(SELECT x.t FROM unnest(p.proargtypes::oid[]) WITH ORDINALITY AS x(t, ord) ORDER BY x.ord) AS argtypes,
      p.prosecdef,
      p.proretset,
      p.prorettype,
      p.proowner,
      p.prosrc,
      pg_get_function_identity_arguments(p.oid) AS ident,
      pg_get_function_arguments(p.oid) AS decl,
      pg_get_function_result(p.oid) AS ret
    INTO v_proc
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = r.fn;

    IF EXISTS (
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = v_impl
    ) THEN
      IF v_proc.prosrc LIKE '%assert_caller_can_act_for_tenant%' THEN
        CONTINUE;
      END IF;
      RAISE EXCEPTION '331 aborted: public.% exists but public.% no longer calls the tenant guard', v_impl, r.fn;
    END IF;

    IF NOT v_proc.prosecdef THEN
      RAISE EXCEPTION '331 aborted: public.% is not SECURITY DEFINER', r.fn;
    END IF;

    IF v_proc.proargmodes IS NOT NULL OR v_proc.proretset THEN
      RAISE EXCEPTION '331 aborted: public.% has OUT/TABLE/VARIADIC arguments or returns a set', r.fn;
    END IF;

    IF v_proc.proowner <> v_owner THEN
      RAISE EXCEPTION '331 aborted: public.% is not owned by %', r.fn, current_user;
    END IF;

    IF v_proc.proargnames IS NULL
      OR EXISTS (SELECT 1 FROM unnest(v_proc.proargnames) a WHERE a IS NULL OR a = '' OR a = 'v_tenant')
    THEN
      RAISE EXCEPTION '331 aborted: public.% has an unnamed parameter or one named v_tenant', r.fn;
    END IF;

    v_param_pos := array_position(v_proc.proargnames, r.param);
    IF v_param_pos IS NULL THEN
      RAISE EXCEPTION '331 aborted: public.% has no parameter %', r.fn, r.param;
    END IF;

    IF r.tbl IS NOT NULL THEN
      IF to_regclass('public.' || r.tbl) IS NULL THEN
        RAISE EXCEPTION '331 aborted: table public.% not found (needed by %)', r.tbl, r.fn;
      END IF;

      SELECT a.atttypid INTO v_id_type
      FROM pg_attribute a
      WHERE a.attrelid = to_regclass('public.' || r.tbl) AND a.attname = 'id' AND NOT a.attisdropped;

      SELECT a.atttypid INTO v_tenant_type
      FROM pg_attribute a
      WHERE a.attrelid = to_regclass('public.' || r.tbl) AND a.attname = r.col AND NOT a.attisdropped;

      IF v_id_type IS NULL OR v_tenant_type IS NULL THEN
        RAISE EXCEPTION '331 aborted: public.% is missing column id or % (needed by %)', r.tbl, r.col, r.fn;
      END IF;

      IF v_tenant_type <> 'uuid'::regtype THEN
        RAISE EXCEPTION '331 aborted: public.%.% is not uuid (needed by %)', r.tbl, r.col, r.fn;
      END IF;

      IF v_id_type IS DISTINCT FROM v_proc.argtypes[v_param_pos] THEN
        RAISE EXCEPTION '331 aborted: public.%.id type does not match parameter % of %', r.tbl, r.param, r.fn;
      END IF;
    END IF;

    IF r.mode = 'purchase_source' THEN
      IF array_position(v_proc.proargnames, 'p_source_type') IS NULL THEN
        RAISE EXCEPTION '331 aborted: public.% has no parameter p_source_type', r.fn;
      END IF;

      v_ctx_oid := to_regprocedure('public._pur_lookup_purchase_source_context(text, text)');
      IF v_ctx_oid IS NULL THEN
        RAISE EXCEPTION '331 aborted: public._pur_lookup_purchase_source_context(text, text) not found';
      END IF;

      IF NOT EXISTS (
        SELECT 1 FROM pg_proc p
        WHERE p.oid = v_ctx_oid AND 'tenant_id' = ANY (coalesce(p.proargnames, '{}'::text[]))
      ) AND NOT EXISTS (
        SELECT 1
        FROM pg_proc p
        JOIN pg_type ty ON ty.oid = p.prorettype
        JOIN pg_attribute a ON a.attrelid = ty.typrelid
        WHERE p.oid = v_ctx_oid AND a.attname = 'tenant_id' AND NOT a.attisdropped
      ) THEN
        RAISE EXCEPTION '331 aborted: public._pur_lookup_purchase_source_context does not return tenant_id';
      END IF;
    END IF;

    v_lookup := CASE r.mode
      WHEN 'tenant_param' THEN
        'v_tenant := p_tenant_id;'
      WHEN 'row' THEN
        format('SELECT t.%I INTO v_tenant FROM public.%I t WHERE t.id = %I;', r.col, r.tbl, r.param)
      WHEN 'purchase_source' THEN
        'SELECT ctx.tenant_id INTO v_tenant FROM public._pur_lookup_purchase_source_context(p_source_type, p_source_id) ctx;'
      WHEN 'leave_type' THEN
        format('SELECT t.%I INTO v_tenant FROM public.%I t WHERE t.id = %I; v_tenant := coalesce(v_tenant, public.current_user_tenant_id());', r.col, r.tbl, r.param)
    END;

    IF v_lookup IS NULL THEN
      RAISE EXCEPTION '331 aborted: unknown mode % for %', r.mode, r.fn;
    END IF;

    SELECT string_agg(quote_ident(a.name), ', ' ORDER BY a.ord)
    INTO v_call_args
    FROM unnest(v_proc.proargnames) WITH ORDINALITY AS a(name, ord);

    IF v_proc.prorettype = 'pg_catalog.void'::regtype THEN
      v_call := format('PERFORM public.%I(%s);', v_impl, v_call_args);
    ELSE
      v_call := format('RETURN public.%I(%s);', v_impl, v_call_args);
    END IF;

    v_body := format(
      E'DECLARE\n  v_tenant uuid;\nBEGIN\n  %s\n  PERFORM public.assert_caller_can_act_for_tenant(v_tenant);\n  %s\nEND;',
      v_lookup,
      v_call
    );

    v_auth_exec := has_function_privilege('authenticated', v_proc.oid, 'EXECUTE');
    v_srv_exec := has_function_privilege('service_role', v_proc.oid, 'EXECUTE');

    EXECUTE format('ALTER FUNCTION public.%I(%s) RENAME TO %I', r.fn, v_proc.ident, v_impl);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated', v_impl, v_proc.ident);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO service_role', v_impl, v_proc.ident);

    EXECUTE format(
      'CREATE FUNCTION public.%I(%s) RETURNS %s LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS %L',
      r.fn,
      v_proc.decl,
      v_proc.ret,
      v_body
    );

    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon, authenticated, service_role', r.fn, v_proc.ident);
    IF v_auth_exec THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated', r.fn, v_proc.ident);
    END IF;
    IF v_srv_exec THEN
      EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO service_role', r.fn, v_proc.ident);
    END IF;
  END LOOP;

  FOREACH v_name IN ARRAY v_names
  LOOP
    v_wrap_oid := NULL;
    v_impl_oid := NULL;

    SELECT p.oid INTO v_wrap_oid
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = v_name;

    SELECT p.oid INTO v_impl_oid
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = v_name || '__impl';

    IF v_wrap_oid IS NULL OR v_impl_oid IS NULL THEN
      RAISE EXCEPTION '331 check failed: wrapper or impl missing for %', v_name;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p
      WHERE p.oid = v_wrap_oid AND p.prosecdef AND p.prosrc LIKE '%assert_caller_can_act_for_tenant%'
    ) THEN
      RAISE EXCEPTION '331 check failed: public.% is not a SECURITY DEFINER guard wrapper', v_name;
    END IF;

    IF has_function_privilege('anon', v_wrap_oid, 'EXECUTE')
      OR has_function_privilege('anon', v_impl_oid, 'EXECUTE')
      OR has_function_privilege('authenticated', v_impl_oid, 'EXECUTE')
    THEN
      RAISE EXCEPTION '331 check failed: grants on % or its impl are too open', v_name;
    END IF;
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
