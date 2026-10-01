BEGIN;

DROP FUNCTION IF EXISTS public.admin_delete_payroll_history_for_month(date);

DO $$
DECLARE
  sig text;
  server_only text[] := ARRAY[
    'public.lock_payroll_period(uuid, uuid, text[], date, integer, integer, text, text, jsonb)',
    'public.release_payroll_period(uuid, uuid, text[], date, integer, integer)',
    'public.reopen_payroll_period(uuid, uuid, text[], date, integer, integer)',
    'public.remit_tax_for_period(uuid, uuid, date, text, boolean)',
    'public.undo_remit_tax_for_period(uuid, uuid, date, text)',
    'public.admin_delete_payroll_history_for_employees(date, uuid, text[])',
    'public.admin_delete_payroll_history_for_month(date, uuid)',
    'public.apply_account_credit(uuid, numeric, text, text, uuid)',
    'public.grant_post_waiver_grace_period(uuid, integer)',
    'public.credit_sms_purchase(uuid, integer, text)',
    'public.debit_sms_credit(uuid)',
    'public.ensure_sms_allowance_current(uuid)',
    'public.list_missing_sql_scripts(text)',
    'public.admin_update_payroll_history_statutory(uuid, date, jsonb)',
    'public.record_client_invoice_payment(uuid, uuid, date, numeric, text, text, uuid)',
    'public.void_client_invoice_payment(uuid, uuid)'
  ];
  internal_only text[] := ARRAY[
    'public.enforce_row_tenant_id()',
    'public.enforce_ap_payment_tenant_match()',
    'public.enforce_client_invoice_payment_tenant_match()',
    'public.enforce_client_receipt_tenant_match()',
    'public.enforce_product_sale_payment_tenant_match()',
    'public.trg_pur_accounts_payable_before_delete()',
    'public._pos_sync_vfrs_for_return_income_id(uuid, uuid)',
    'public._post_customer_refund_cash_outflow(uuid, public.credit_notes, uuid, numeric, text, date, text)',
    'public._record_refund_core(uuid, numeric, text, text, date)',
    'public._reverse_loyalty_points_for_product_return(uuid, text, text, numeric, uuid)'
  ];
BEGIN
  FOREACH sig IN ARRAY server_only LOOP
    IF to_regprocedure(sig) IS NOT NULL THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', sig);
      EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO service_role', sig);
    ELSE
      RAISE NOTICE 'skipped, not found: %', sig;
    END IF;
  END LOOP;

  FOREACH sig IN ARRAY internal_only LOOP
    IF to_regprocedure(sig) IS NOT NULL THEN
      EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM authenticated', sig);
    ELSE
      RAISE NOTICE 'skipped, not found: %', sig;
    END IF;
  END LOOP;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;