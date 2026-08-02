-- Script 141: Product sale due-date reminder dedup column
--
-- Adds last_reminder_sent_at on income_register so the product-sale due
-- reminder cron can skip sales already notified in the current window.
-- Safe to re-run. Apply on staging first.
--
-- Related app path: /api/cron/product-sale-due-reminders
-- Transactional event_type (optional template wiring): payment_due_reminder

BEGIN;

ALTER TABLE public.income_register
  ADD COLUMN IF NOT EXISTS last_reminder_sent_at timestamptz;

COMMENT ON COLUMN public.income_register.last_reminder_sent_at IS
  'When the last product-sale (or other income) due-balance reminder was sent. '
  'Used by cron product-sale-due-reminders to avoid duplicate notifies.';

CREATE INDEX IF NOT EXISTS idx_income_register_product_sale_due_reminders
  ON public.income_register (tenant_id, due_date)
  WHERE entry_type = 'product_sale'
    AND sale_status = 'active'
    AND outstanding_balance > 0
    AND due_date IS NOT NULL;

COMMIT;
