BEGIN;

DO $$
DECLARE
  v_names text[] := ARRAY[
    'save_client_invoice',
    'change_client_invoice_status',
    'void_client_invoice',
    'checkout_pos_cart',
    'save_accounts_payable',
    'delete_accounts_payable',
    'record_supplier_contract_replacement_payment',
    'save_fixed_asset',
    'delete_fixed_asset',
    'create_fixed_asset_payable',
    'sync_fixed_asset_payable',
    'generate_next_code',
    'void_product_sale',
    'create_product_return',
    'record_refund',
    'recompute_accounts_payable_from_payments',
    'reverse_fixed_asset_payable',
    'approve_leave_request',
    'reject_leave_request',
    'cancel_leave_request',
    'replace_purchase_tax_ledger_entries',
    'submit_leave_request'
  ];
  v_name text;
  v_impl_oid oid;
  v_impl_ident text;
  v_wrap_oid oid;
  v_wrap_ident text;
  v_wrap_src text;
BEGIN
  FOREACH v_name IN ARRAY v_names
  LOOP
    v_impl_oid := NULL;
    v_wrap_oid := NULL;

    SELECT p.oid, pg_get_function_identity_arguments(p.oid)
    INTO v_impl_oid, v_impl_ident
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = v_name || '__impl';

    IF v_impl_oid IS NULL THEN
      CONTINUE;
    END IF;

    SELECT p.oid, pg_get_function_identity_arguments(p.oid), p.prosrc
    INTO v_wrap_oid, v_wrap_ident, v_wrap_src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = v_name;

    IF v_wrap_oid IS NOT NULL THEN
      IF v_wrap_src NOT LIKE '%assert_caller_can_act_for_tenant%' THEN
        RAISE EXCEPTION 'rollback aborted: public.% is not the guard wrapper', v_name;
      END IF;
      EXECUTE format('DROP FUNCTION public.%I(%s)', v_name, v_wrap_ident);
    END IF;

    EXECUTE format('ALTER FUNCTION public.%I(%s) RENAME TO %I', v_name || '__impl', v_impl_ident, v_name);
    EXECUTE format('REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC, anon', v_name, v_impl_ident);
    EXECUTE format('GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated, service_role', v_name, v_impl_ident);
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
