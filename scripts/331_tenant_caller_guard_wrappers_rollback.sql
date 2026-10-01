BEGIN;

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
  v_base text;
  rec record;
  v_identity_args text;
BEGIN
  FOR rec IN
    SELECT
      p.oid,
      p.proname,
      pg_get_function_identity_arguments(p.oid) AS identity_args,
      p.proargtypes
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public'
      AND p.proname LIKE '%\_\_impl' ESCAPE '\'
      AND p.prokind = 'f'
  LOOP
    v_base := regexp_replace(rec.proname, '__impl$', '');
    IF NOT (v_base = ANY (v_targets)) THEN
      CONTINUE;
    END IF;

    v_identity_args := rec.identity_args;

    IF EXISTS (
      SELECT 1
      FROM pg_proc pw
      JOIN pg_namespace nw ON nw.oid = pw.pronamespace
      WHERE nw.nspname = 'public'
        AND pw.proname = v_base
        AND pw.proargtypes = rec.proargtypes
        AND pw.oid <> rec.oid
    ) THEN
      EXECUTE format(
        'DROP FUNCTION public.%I(%s)',
        v_base,
        v_identity_args
      );
    END IF;

    EXECUTE format(
      'ALTER FUNCTION public.%I(%s) RENAME TO %I',
      rec.proname,
      v_identity_args,
      v_base
    );

    EXECUTE format(
      'REVOKE ALL ON FUNCTION public.%I(%s) FROM PUBLIC',
      v_base,
      v_identity_args
    );
    EXECUTE format(
      'REVOKE ALL ON FUNCTION public.%I(%s) FROM anon',
      v_base,
      v_identity_args
    );
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION public.%I(%s) TO authenticated, service_role',
      v_base,
      v_identity_args
    );

    RAISE NOTICE 'dfoms_wrap_rollback_ok % (%)', v_base, v_identity_args;
  END LOOP;
END;
$$;

NOTIFY pgrst, 'reload schema';

COMMIT;
