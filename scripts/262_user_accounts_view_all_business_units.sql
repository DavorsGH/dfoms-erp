-- 262_user_accounts_view_all_business_units.sql
-- Split "All Businesses" (aggregate view) from default/untagged stamp context
-- (active_business_unit_id IS NULL = workspace default row).
--
-- Backfill: any tenant with ≥1 active business unit keeps combined BS/CF
-- continuity by starting on view_all = true (legacy null-as-All behavior).

BEGIN;

ALTER TABLE public.user_accounts
  ADD COLUMN IF NOT EXISTS view_all_business_units boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.user_accounts.view_all_business_units IS
  'When true, staff is on All Businesses aggregate view (not a stamp target). '
  'When false, active_business_unit_id null = workspace default/untagged rows; '
  'non-null = that business unit.';

COMMENT ON COLUMN public.user_accounts.active_business_unit_id IS
  'Staff scoped business-unit context. Null = workspace default/untagged data '
  '(not All Businesses). Pair with view_all_business_units for aggregate view.';

UPDATE public.user_accounts ua
SET view_all_business_units = true
WHERE ua.tenant_id IN (
  SELECT bu.tenant_id
  FROM public.business_units bu
  WHERE bu.is_active = true
  GROUP BY bu.tenant_id
  HAVING COUNT(*) >= 1
);

COMMIT;
