BEGIN;

ALTER TABLE public.statutory_reminder_log
  ADD COLUMN IF NOT EXISTS business_unit_id uuid NULL;

ALTER TABLE public.statutory_reminder_log
  DROP CONSTRAINT IF EXISTS statutory_reminder_log_business_unit_id_fkey;

ALTER TABLE public.statutory_reminder_log
  ADD CONSTRAINT statutory_reminder_log_business_unit_id_fkey
  FOREIGN KEY (business_unit_id) REFERENCES public.business_units (id) ON DELETE CASCADE;

ALTER TABLE public.statutory_reminder_log
  DROP CONSTRAINT IF EXISTS statutory_reminder_log_dedup;

DROP INDEX IF EXISTS public.statutory_reminder_log_dedup_idx;

CREATE UNIQUE INDEX statutory_reminder_log_dedup_idx
  ON public.statutory_reminder_log (
    tenant_id,
    business_unit_id,
    statutory_type,
    period_month,
    reminder_kind,
    channel,
    recipient_user_id
  ) NULLS NOT DISTINCT;

NOTIFY pgrst, 'reload schema';

COMMIT;
