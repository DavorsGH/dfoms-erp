BEGIN;

DO $$
DECLARE
  r record;
  v_wrap record;
  v_count integer;
  v_call_args text;
  v_call text;
  v_body text;
BEGIN
  FOR r IN
    SELECT *
    FROM (VALUES
      ('void_product_sale', 'p_income_id', 'income_register', 'tenant_id'),
      ('create_product_return', 'p_income_register_id', 'income_register', 'tenant_id'),
      ('record_refund', 'p_credit_note_id', 'credit_notes', 'tenant_id'),
      ('recompute_accounts_payable_from_payments', 'p_ap_id', 'accounts_payable', 'tenant_id'),
      ('reverse_fixed_asset_payable', 'p_payable_id', 'accounts_payable', 'tenant_id'),
      ('approve_leave_request', 'p_request_id', 'leave_requests', 'tenant_id'),
      ('reject_leave_request', 'p_request_id', 'leave_requests', 'tenant_id'),
      ('cancel_leave_request', 'p_request_id', 'leave_requests', 'tenant_id')
    ) AS t(fn, param, tbl, col)
  LOOP
    SELECT count(*) INTO v_count
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = r.fn;

    IF v_count <> 1 THEN
      RAISE EXCEPTION '332 aborted: expected exactly one public.% but found %', r.fn, v_count;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname = r.fn || '__impl'
    ) THEN
      RAISE EXCEPTION '332 aborted: public.%__impl not found (run 331 first)', r.fn;
    END IF;

    SELECT
      p.oid,
      p.proargnames,
      p.prorettype,
      p.prosecdef,
      p.prosrc,
      pg_get_function_arguments(p.oid) AS decl,
      pg_get_function_result(p.oid) AS ret
    INTO v_wrap
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = r.fn;

    IF NOT v_wrap.prosecdef OR v_wrap.prosrc NOT LIKE '%assert_caller_can_act_for_tenant%' THEN
      RAISE EXCEPTION '332 aborted: public.% is not the 331 guard wrapper', r.fn;
    END IF;

    IF array_position(v_wrap.proargnames, r.param) IS NULL THEN
      RAISE EXCEPTION '332 aborted: public.% has no parameter %', r.fn, r.param;
    END IF;

    SELECT string_agg(quote_ident(a.name), ', ' ORDER BY a.ord)
    INTO v_call_args
    FROM unnest(v_wrap.proargnames) WITH ORDINALITY AS a(name, ord);

    IF v_wrap.prorettype = 'pg_catalog.void'::regtype THEN
      v_call := format('PERFORM public.%I(%s);', r.fn || '__impl', v_call_args);
    ELSE
      v_call := format('RETURN public.%I(%s);', r.fn || '__impl', v_call_args);
    END IF;

    v_body := format(
      E'DECLARE\n  v_tenant uuid;\nBEGIN\n  IF %I IS NOT NULL THEN\n    SELECT t.%I INTO v_tenant FROM public.%I t WHERE t.id = %I;\n    PERFORM public.assert_caller_can_act_for_tenant(v_tenant);\n  END IF;\n  %s\nEND;',
      r.param,
      r.col,
      r.tbl,
      r.param,
      v_call
    );

    EXECUTE format(
      'CREATE OR REPLACE FUNCTION public.%I(%s) RETURNS %s LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS %L',
      r.fn,
      v_wrap.decl,
      v_wrap.ret,
      v_body
    );

    IF NOT EXISTS (
      SELECT 1 FROM pg_proc p
      WHERE p.oid = v_wrap.oid
        AND p.prosecdef
        AND p.prosrc LIKE '%assert_caller_can_act_for_tenant%'
        AND p.prosrc LIKE '%IS NOT NULL THEN%'
    ) THEN
      RAISE EXCEPTION '332 check failed: public.% was not updated as expected', r.fn;
    END IF;

    IF has_function_privilege('anon', v_wrap.oid, 'EXECUTE')
      OR has_function_privilege('authenticated', (SELECT p.oid FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname = 'public' AND p.proname = r.fn || '__impl'), 'EXECUTE')
    THEN
      RAISE EXCEPTION '332 check failed: grants on % or its impl are too open', r.fn;
    END IF;
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
