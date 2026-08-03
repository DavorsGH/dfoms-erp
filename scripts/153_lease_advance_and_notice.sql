-- =============================================================================
-- 153_lease_advance_and_notice.sql
-- Apply to staging first. Do NOT apply to production until approved.
--
-- Adds per-lease configurable PDF fields on public.leases:
--   - advance_rent_amount_ghs (numeric) — advance rent shown in tenancy PDF
--   - termination_notice_months (integer) — prior notice period in months
--
-- Backfill:
--   advance = rent_amount_ghs × term months (from start_date / end_date)
--   notice  = 3
--
-- Safe to re-run (idempotent).
-- =============================================================================

BEGIN;

ALTER TABLE public.leases
  ADD COLUMN IF NOT EXISTS advance_rent_amount_ghs numeric,
  ADD COLUMN IF NOT EXISTS termination_notice_months integer;

-- Term months mirrors app computeLeaseTermMonths (start/end calendar months).
UPDATE public.leases
SET advance_rent_amount_ghs = ROUND(
  (COALESCE(rent_amount_ghs, 0)::numeric)
  * GREATEST(
      1,
      (
        (EXTRACT(YEAR FROM end_date)::integer
          - EXTRACT(YEAR FROM start_date)::integer) * 12
        + (EXTRACT(MONTH FROM end_date)::integer
          - EXTRACT(MONTH FROM start_date)::integer)
        + CASE
            WHEN EXTRACT(DAY FROM end_date)::integer
              >= EXTRACT(DAY FROM start_date)::integer
            THEN 0
            ELSE -1
          END
      )
    ),
  2
)
WHERE advance_rent_amount_ghs IS NULL;

UPDATE public.leases
SET termination_notice_months = 3
WHERE termination_notice_months IS NULL;

ALTER TABLE public.leases
  ALTER COLUMN advance_rent_amount_ghs SET DEFAULT 0,
  ALTER COLUMN termination_notice_months SET DEFAULT 3;

ALTER TABLE public.leases
  ALTER COLUMN advance_rent_amount_ghs SET NOT NULL,
  ALTER COLUMN termination_notice_months SET NOT NULL;

ALTER TABLE public.leases
  DROP CONSTRAINT IF EXISTS leases_advance_rent_amount_ghs_check;

ALTER TABLE public.leases
  ADD CONSTRAINT leases_advance_rent_amount_ghs_check
  CHECK (advance_rent_amount_ghs >= 0);

ALTER TABLE public.leases
  DROP CONSTRAINT IF EXISTS leases_termination_notice_months_check;

ALTER TABLE public.leases
  ADD CONSTRAINT leases_termination_notice_months_check
  CHECK (termination_notice_months >= 1);

COMMENT ON COLUMN public.leases.advance_rent_amount_ghs IS
  'Advance rent (GHS) shown on the generated tenancy PDF. Suggested as rent × term months on create; independently editable.';

COMMENT ON COLUMN public.leases.termination_notice_months IS
  'Prior notice period in months for early termination clause on the generated tenancy PDF. Default 3.';

NOTIFY pgrst, 'reload schema';

COMMIT;
