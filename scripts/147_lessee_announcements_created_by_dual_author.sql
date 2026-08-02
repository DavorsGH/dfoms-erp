-- =============================================================================
-- 147_lessee_announcements_created_by_dual_author.sql
-- Apply to staging first. Do NOT apply to production until approved.
--
-- Bug: platform_only landlords creating lessee_announcements fail with
--   lessee_announcements_created_by_fkey
-- because created_by referenced user_accounts(auth_uid) only, while the
-- landlord portal passes landlords.auth_user_id (not a user_accounts row).
--
-- Precedent: rental_application_links.created_by (script 146) and
-- product_sale_payment_requests.created_by (script 111) store auth uid as
-- plain uuid with no FK so staff and landlords can both author rows.
--
-- Change: drop FK on lessee_announcements.created_by. Column remains uuid;
-- staff paths keep writing user_accounts.auth_uid; landlord portal keeps
-- writing landlords.auth_user_id. Safe to re-run.
-- =============================================================================

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'lessee_announcements'
      AND c.conname = 'lessee_announcements_created_by_fkey'
  ) THEN
    ALTER TABLE public.lessee_announcements
      DROP CONSTRAINT lessee_announcements_created_by_fkey;
  END IF;
END $$;

COMMENT ON COLUMN public.lessee_announcements.created_by IS
  'Auth uid of author: user_accounts.auth_uid for staff, or landlords.auth_user_id '
  'for platform_only landlord portal. No FK — dual author types (same pattern as '
  'rental_application_links.created_by).';

NOTIFY pgrst, 'reload schema';

COMMIT;
