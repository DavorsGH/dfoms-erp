BEGIN;

DO $$
DECLARE
  v_davors uuid := '00000001-0000-4000-8000-000000000001';
  v_tech uuid;
  v_fac uuid;
  v_locked_months text;
  v_income_has_updated_at boolean;
BEGIN
  SELECT id INTO v_tech
  FROM public.business_units
  WHERE tenant_id = v_davors
    AND name = 'Davors Technologies'
    AND is_active IS TRUE;

  IF v_tech IS NULL THEN
    RAISE EXCEPTION 'Davors Technologies active business unit not found for tenant %', v_davors;
  END IF;

  SELECT id INTO v_fac
  FROM public.business_units
  WHERE tenant_id = v_davors
    AND name = 'Davors Facilities'
    AND is_active IS TRUE;

  IF v_fac IS NULL THEN
    RAISE EXCEPTION 'Davors Facilities active business unit not found for tenant %', v_davors;
  END IF;

  SELECT string_agg(DISTINCT to_char(affected.month, 'YYYY-MM'), ', ' ORDER BY to_char(affected.month, 'YYYY-MM'))
  INTO v_locked_months
  FROM (
    SELECT date_trunc('month', i.date)::date AS month
    FROM public.income_register i
    WHERE i.tenant_id = v_davors
      AND i.invoice_no LIKE 'PSK-INC-%'
      AND i.service_category IN ('ERP Suite', 'Platform Billing')
      AND i.business_unit_id IS DISTINCT FROM v_tech
    UNION
    SELECT date_trunc('month', e.date)::date AS month
    FROM public.expense_register e
    WHERE e.tenant_id = v_davors
      AND e.receipt_no LIKE 'PSK-FEE-%'
      AND e.expense_category = 'Direct Operational'
      AND e.sub_category = 'Paystack Transaction Fees'
      AND e.vendor = 'Paystack'
      AND (
        e.description ILIKE '%ERP Suite subscription%'
        OR e.description ILIKE '%SMS credit purchase%'
        OR e.description ILIKE '%platform unit activation%'
        OR e.description ILIKE '%platform monthly unit billing%'
        OR e.description ILIKE '%platform annual unit billing%'
      )
      AND e.business_unit_id IS DISTINCT FROM v_tech
  ) affected
  INNER JOIN public.month_end_close m
    ON m.tenant_id = v_davors
   AND m.month = affected.month
   AND m.lock_status <> 'Open';

  IF v_locked_months IS NOT NULL AND btrim(v_locked_months) <> '' THEN
    RAISE EXCEPTION 'Refusing backfill: platform rows to move fall in non-Open month_end_close month(s): %', v_locked_months;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'income_register'
      AND column_name = 'updated_at'
  ) INTO v_income_has_updated_at;

  IF v_income_has_updated_at THEN
    UPDATE public.income_register i
    SET
      business_unit_id = v_tech,
      updated_at = now()
    WHERE i.tenant_id = v_davors
      AND i.invoice_no LIKE 'PSK-INC-%'
      AND i.service_category IN ('ERP Suite', 'Platform Billing')
      AND i.business_unit_id IS DISTINCT FROM v_tech;
  ELSE
    UPDATE public.income_register i
    SET business_unit_id = v_tech
    WHERE i.tenant_id = v_davors
      AND i.invoice_no LIKE 'PSK-INC-%'
      AND i.service_category IN ('ERP Suite', 'Platform Billing')
      AND i.business_unit_id IS DISTINCT FROM v_tech;
  END IF;

  UPDATE public.expense_register e
  SET business_unit_id = v_tech
  WHERE e.tenant_id = v_davors
    AND e.receipt_no LIKE 'PSK-FEE-%'
    AND e.expense_category = 'Direct Operational'
    AND e.sub_category = 'Paystack Transaction Fees'
    AND e.vendor = 'Paystack'
    AND (
      e.description ILIKE '%ERP Suite subscription%'
      OR e.description ILIKE '%SMS credit purchase%'
      OR e.description ILIKE '%platform unit activation%'
      OR e.description ILIKE '%platform monthly unit billing%'
      OR e.description ILIKE '%platform annual unit billing%'
    )
    AND e.business_unit_id IS DISTINCT FROM v_tech;

  UPDATE public.tax_ledger_entries t
  SET
    business_unit_id = v_tech,
    updated_at = now()
  FROM public.income_register i
  WHERE t.tenant_id = v_davors
    AND t.source_type = 'income_register'
    AND t.source_id = i.id::text
    AND i.tenant_id = v_davors
    AND i.invoice_no LIKE 'PSK-INC-%'
    AND i.service_category IN ('ERP Suite', 'Platform Billing')
    AND t.business_unit_id IS DISTINCT FROM v_tech;
END $$;

COMMIT;
