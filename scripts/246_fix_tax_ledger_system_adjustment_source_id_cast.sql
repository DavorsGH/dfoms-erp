-- 246_fix_tax_ledger_system_adjustment_source_id_cast.sql
--
-- Root cause (2026-08-25): script 234 widened tax_ledger_entries.source_id from
-- uuid → text so Fixed Assets can store asset_id. The system-adjustment triggers
-- from script 126 still compared uuid = text / text = uuid, which Postgres rejects
-- (`operator does not exist`). Every income_register tax INSERT then failed inside
-- syncIncomeRegisterTaxLedger AFTER the delete step — wiping VAT/WHT legs while
-- income_register tax columns stayed intact.
--
-- Also adds replace_income_register_tax_ledger_entries(): one-transaction
-- delete+insert used by syncIncomeRegisterTaxLedger (unique partial index on
-- active source legs makes insert-then-delete impossible).
--
-- Idempotent. Staging first, then production. No tenant-specific branching.

BEGIN;

CREATE OR REPLACE FUNCTION public.block_tax_ledger_for_system_adjustment_income()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.source_type = 'income_register' AND NEW.source_id IS NOT NULL THEN
    IF EXISTS (
      SELECT 1
      FROM public.income_register i
      WHERE i.id::text = NEW.source_id
        AND i.is_system_adjustment IS TRUE
    ) THEN
      RETURN NULL; -- cancel this tax_ledger insert
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.clear_system_adjustment_tax_ledger()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.is_system_adjustment IS TRUE THEN
    DELETE FROM public.tax_ledger_entries
    WHERE source_type = 'income_register'
      AND source_id = NEW.id::text;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.replace_income_register_tax_ledger_entries(
  p_source_id text,
  p_rows jsonb
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_is_system_adjustment boolean;
BEGIN
  IF p_source_id IS NULL OR btrim(p_source_id) = '' THEN
    RAISE EXCEPTION 'p_source_id is required';
  END IF;

  SELECT i.is_system_adjustment
  INTO v_is_system_adjustment
  FROM public.income_register i
  WHERE i.id::text = p_source_id;

  -- Match syncIncomeRegisterTaxLedger: system-adjustment rows keep no tax legs.
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
    notes
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
    NULLIF(r->>'notes', '')
  FROM jsonb_array_elements(p_rows) AS t(r);
END;
$$;

COMMENT ON FUNCTION public.replace_income_register_tax_ledger_entries(text, jsonb) IS
  'Atomically replace tax_ledger_entries for one income_register source_id '
  '(DELETE then INSERT in a single transaction). Used by syncIncomeRegisterTaxLedger.';

GRANT EXECUTE ON FUNCTION public.replace_income_register_tax_ledger_entries(text, jsonb)
  TO authenticated, service_role;

COMMIT;
