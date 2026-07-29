-- Allow "skipped_no_credit" on announcement (+ campaign if constrained) recipient status.
-- Applied when SMS wallet debit fails before Hubtel send.

ALTER TABLE public.employee_announcement_recipients
  DROP CONSTRAINT IF EXISTS employee_announcement_recipients_status_check;

ALTER TABLE public.employee_announcement_recipients
  ADD CONSTRAINT employee_announcement_recipients_status_check
  CHECK (status = ANY (ARRAY[
    'sent'::text,
    'failed'::text,
    'skipped_no_contact'::text,
    'skipped_no_login'::text,
    'skipped_no_credit'::text
  ]));

-- Campaign recipients: only recreate check if one already exists with the legacy set.
DO $$
DECLARE
  v_conname text;
BEGIN
  SELECT c.conname
  INTO v_conname
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND t.relname = 'campaign_recipients'
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) ILIKE '%skipped_opted_out%'
  LIMIT 1;

  IF v_conname IS NOT NULL THEN
    EXECUTE format(
      'ALTER TABLE public.campaign_recipients DROP CONSTRAINT %I',
      v_conname
    );
    ALTER TABLE public.campaign_recipients
      ADD CONSTRAINT campaign_recipients_status_check
      CHECK (status = ANY (ARRAY[
        'pending'::text,
        'sent'::text,
        'failed'::text,
        'skipped_opted_out'::text,
        'skipped_no_credit'::text
      ]));
  END IF;
END $$;
