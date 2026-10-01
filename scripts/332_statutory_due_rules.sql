BEGIN;

ALTER TABLE public.tax_settings
  ADD COLUMN IF NOT EXISTS vat_due_months_after_period smallint NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vat_due_day_rule text NOT NULL DEFAULT 'last_day',
  ADD COLUMN IF NOT EXISTS vat_due_day_number integer,
  ADD COLUMN IF NOT EXISTS wht_due_months_after_period smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS wht_due_day_rule text NOT NULL DEFAULT 'day',
  ADD COLUMN IF NOT EXISTS wht_due_day_number integer DEFAULT 15,
  ADD COLUMN IF NOT EXISTS paye_due_months_after_period smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS paye_due_day_rule text NOT NULL DEFAULT 'day',
  ADD COLUMN IF NOT EXISTS paye_due_day_number integer DEFAULT 15,
  ADD COLUMN IF NOT EXISTS ssnit_due_months_after_period smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS ssnit_due_day_rule text NOT NULL DEFAULT 'day',
  ADD COLUMN IF NOT EXISTS ssnit_due_day_number integer DEFAULT 14,
  ADD COLUMN IF NOT EXISTS tier2_due_months_after_period smallint NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS tier2_due_day_rule text NOT NULL DEFAULT 'day',
  ADD COLUMN IF NOT EXISTS tier2_due_day_number integer DEFAULT 14;

ALTER TABLE public.tax_settings
  DROP CONSTRAINT IF EXISTS tax_settings_vat_due_months_after_check;
ALTER TABLE public.tax_settings
  ADD CONSTRAINT tax_settings_vat_due_months_after_check
  CHECK (vat_due_months_after_period IN (0, 1));

ALTER TABLE public.tax_settings
  DROP CONSTRAINT IF EXISTS tax_settings_wht_due_months_after_check;
ALTER TABLE public.tax_settings
  ADD CONSTRAINT tax_settings_wht_due_months_after_check
  CHECK (wht_due_months_after_period IN (0, 1));

ALTER TABLE public.tax_settings
  DROP CONSTRAINT IF EXISTS tax_settings_paye_due_months_after_check;
ALTER TABLE public.tax_settings
  ADD CONSTRAINT tax_settings_paye_due_months_after_check
  CHECK (paye_due_months_after_period IN (0, 1));

ALTER TABLE public.tax_settings
  DROP CONSTRAINT IF EXISTS tax_settings_ssnit_due_months_after_check;
ALTER TABLE public.tax_settings
  ADD CONSTRAINT tax_settings_ssnit_due_months_after_check
  CHECK (ssnit_due_months_after_period IN (0, 1));

ALTER TABLE public.tax_settings
  DROP CONSTRAINT IF EXISTS tax_settings_tier2_due_months_after_check;
ALTER TABLE public.tax_settings
  ADD CONSTRAINT tax_settings_tier2_due_months_after_check
  CHECK (tier2_due_months_after_period IN (0, 1));

ALTER TABLE public.tax_settings
  DROP CONSTRAINT IF EXISTS tax_settings_vat_due_day_rule_check;
ALTER TABLE public.tax_settings
  ADD CONSTRAINT tax_settings_vat_due_day_rule_check
  CHECK (vat_due_day_rule IN ('day', 'last_day', 'last_working_day'));

ALTER TABLE public.tax_settings
  DROP CONSTRAINT IF EXISTS tax_settings_wht_due_day_rule_check;
ALTER TABLE public.tax_settings
  ADD CONSTRAINT tax_settings_wht_due_day_rule_check
  CHECK (wht_due_day_rule IN ('day', 'last_day', 'last_working_day'));

ALTER TABLE public.tax_settings
  DROP CONSTRAINT IF EXISTS tax_settings_paye_due_day_rule_check;
ALTER TABLE public.tax_settings
  ADD CONSTRAINT tax_settings_paye_due_day_rule_check
  CHECK (paye_due_day_rule IN ('day', 'last_day', 'last_working_day'));

ALTER TABLE public.tax_settings
  DROP CONSTRAINT IF EXISTS tax_settings_ssnit_due_day_rule_check;
ALTER TABLE public.tax_settings
  ADD CONSTRAINT tax_settings_ssnit_due_day_rule_check
  CHECK (ssnit_due_day_rule IN ('day', 'last_day', 'last_working_day'));

ALTER TABLE public.tax_settings
  DROP CONSTRAINT IF EXISTS tax_settings_tier2_due_day_rule_check;
ALTER TABLE public.tax_settings
  ADD CONSTRAINT tax_settings_tier2_due_day_rule_check
  CHECK (tier2_due_day_rule IN ('day', 'last_day', 'last_working_day'));

ALTER TABLE public.tax_settings
  DROP CONSTRAINT IF EXISTS tax_settings_vat_due_day_number_check;
ALTER TABLE public.tax_settings
  ADD CONSTRAINT tax_settings_vat_due_day_number_check
  CHECK (
    (vat_due_day_rule <> 'day' AND vat_due_day_number IS NULL)
    OR (
      vat_due_day_rule = 'day'
      AND vat_due_day_number >= 1
      AND vat_due_day_number <= 31
    )
  );

ALTER TABLE public.tax_settings
  DROP CONSTRAINT IF EXISTS tax_settings_wht_due_day_number_check;
ALTER TABLE public.tax_settings
  ADD CONSTRAINT tax_settings_wht_due_day_number_check
  CHECK (
    (wht_due_day_rule <> 'day' AND wht_due_day_number IS NULL)
    OR (
      wht_due_day_rule = 'day'
      AND wht_due_day_number >= 1
      AND wht_due_day_number <= 31
    )
  );

ALTER TABLE public.tax_settings
  DROP CONSTRAINT IF EXISTS tax_settings_paye_due_day_number_check;
ALTER TABLE public.tax_settings
  ADD CONSTRAINT tax_settings_paye_due_day_number_check
  CHECK (
    (paye_due_day_rule <> 'day' AND paye_due_day_number IS NULL)
    OR (
      paye_due_day_rule = 'day'
      AND paye_due_day_number >= 1
      AND paye_due_day_number <= 31
    )
  );

ALTER TABLE public.tax_settings
  DROP CONSTRAINT IF EXISTS tax_settings_ssnit_due_day_number_check;
ALTER TABLE public.tax_settings
  ADD CONSTRAINT tax_settings_ssnit_due_day_number_check
  CHECK (
    (ssnit_due_day_rule <> 'day' AND ssnit_due_day_number IS NULL)
    OR (
      ssnit_due_day_rule = 'day'
      AND ssnit_due_day_number >= 1
      AND ssnit_due_day_number <= 31
    )
  );

ALTER TABLE public.tax_settings
  DROP CONSTRAINT IF EXISTS tax_settings_tier2_due_day_number_check;
ALTER TABLE public.tax_settings
  ADD CONSTRAINT tax_settings_tier2_due_day_number_check
  CHECK (
    (tier2_due_day_rule <> 'day' AND tier2_due_day_number IS NULL)
    OR (
      tier2_due_day_rule = 'day'
      AND tier2_due_day_number >= 1
      AND tier2_due_day_number <= 31
    )
  );

UPDATE public.tax_settings
SET
  vat_due_months_after_period = 0,
  vat_due_day_rule = 'last_day',
  vat_due_day_number = NULL;

UPDATE public.tax_settings
SET
  wht_due_months_after_period = 1,
  wht_due_day_rule = 'day',
  wht_due_day_number = COALESCE(wht_return_due_day, 15)
WHERE wht_return_due_day IS NOT NULL;

UPDATE public.tax_settings
SET
  wht_due_months_after_period = 1,
  wht_due_day_rule = 'day',
  wht_due_day_number = 15
WHERE wht_return_due_day IS NULL;

UPDATE public.tax_settings
SET
  paye_due_months_after_period = 1,
  paye_due_day_rule = 'day',
  paye_due_day_number = paye_return_due_day;

UPDATE public.tax_settings
SET
  ssnit_due_months_after_period = 1,
  ssnit_due_day_rule = 'day',
  ssnit_due_day_number = ssnit_return_due_day;

UPDATE public.tax_settings
SET
  tier2_due_months_after_period = 1,
  tier2_due_day_rule = 'day',
  tier2_due_day_number = tier2_return_due_day;

NOTIFY pgrst, 'reload schema';

COMMIT;
