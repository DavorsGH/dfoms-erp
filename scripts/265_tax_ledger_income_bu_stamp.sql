-- 265_tax_ledger_income_bu_stamp.sql
-- Income tax ledger: stamp business_unit_id from source income_register
-- (never from live switcher / payload). Backfill orphans where ledger BU is
-- NULL but income_register.business_unit_id is set.
-- Idempotent. Staging first; production needs staging attestation.

BEGIN;

-- ---------------------------------------------------------------------------
-- replace_income_register_tax_ledger_entries — inherit BU from income_register
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.replace_income_register_tax_ledger_entries(
  p_source_id text,
  p_rows jsonb
)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_is_system_adjustment boolean;
  v_business_unit_id uuid;
BEGIN
  -- dfoms-265-tax-ledger-income-bu-stamp
  IF p_source_id IS NULL OR btrim(p_source_id) = '' THEN
    RAISE EXCEPTION 'p_source_id is required';
  END IF;

  SELECT i.is_system_adjustment, i.business_unit_id
  INTO v_is_system_adjustment, v_business_unit_id
  FROM public.income_register i
  WHERE i.id::text = p_source_id;

  IF FOUND AND v_is_system_adjustment IS TRUE THEN
    DELETE FROM public.tax_ledger_entries
    WHERE source_type = 'income_register'
      AND source_id = p_source_id;
    RETURN;
  END IF;

  DELETE FROM public.tax_ledger_entries
  WHERE source_type = 'income_register'
    AND source_id = p_source_id;

  IF p_rows IS NULL OR jsonb_typeof(p_rows) <> 'array' OR jsonb_array_length(p_rows) = 0 THEN
    RETURN;
  END IF;

  INSERT INTO public.tax_ledger_entries (
    tenant_id,
    entry_date,
    period_month,
    direction,
    tax_component,
    rate_pct,
    taxable_base,
    tax_amount,
    status,
    source_type,
    source_id,
    counterparty_name,
    notes,
    business_unit_id
  )
  SELECT
    COALESCE(
      NULLIF(r->>'tenant_id', '')::uuid,
      public.current_user_tenant_id()
    ),
    (r->>'entry_date')::date,
    (r->>'period_month')::date,
    r->>'direction',
    r->>'tax_component',
    NULLIF(r->>'rate_pct', '')::numeric,
    COALESCE((r->>'taxable_base')::numeric, 0),
    COALESCE((r->>'tax_amount')::numeric, 0),
    COALESCE(NULLIF(r->>'status', ''), 'open'),
    'income_register',
    p_source_id,
    NULLIF(r->>'counterparty_name', ''),
    NULLIF(r->>'notes', ''),
    v_business_unit_id
  FROM jsonb_array_elements(p_rows) AS t(r);
END;
$function$;

COMMENT ON FUNCTION public.replace_income_register_tax_ledger_entries(text, jsonb) IS
  'Replace tax_ledger_entries for one income_register source_id (DELETE+INSERT). '
  'business_unit_id is inherited from income_register (dfoms-265-tax-ledger-income-bu-stamp); '
  'payload BU is ignored.';

GRANT EXECUTE ON FUNCTION public.replace_income_register_tax_ledger_entries(text, jsonb)
  TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Backfill: orphan income-sourced tax legs
-- ---------------------------------------------------------------------------
UPDATE public.tax_ledger_entries t
SET
  business_unit_id = i.business_unit_id,
  updated_at = now()
FROM public.income_register i
WHERE t.source_type = 'income_register'
  AND t.source_id = i.id::text
  AND t.business_unit_id IS NULL
  AND i.business_unit_id IS NOT NULL;

NOTIFY pgrst, 'reload schema';

COMMIT;
