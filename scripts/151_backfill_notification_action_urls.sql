-- =============================================================================
-- 151_backfill_notification_action_urls.sql
-- =============================================================================
-- Idempotent data fix: rewrite stale notification deep-links.
--
-- Staff (employee_notifications):
--   Old landlord pending-approval path
--     /dashboard/real-estate/landlords/{uuid}
--   → /dashboard/real-estate/landlords?highlight={uuid}
--   Also rewrites absolute site URLs ending in that path, and matching
--   trailing URL lines embedded in body (pre-action_url legacy).
--
-- landlord_notifications / lessee_notifications:
--   No known analogous broken detail-path pattern from before the portal
--   notification fixes. This script still runs audit UPDATEs that are no-ops
--   when nothing matches (safe to re-run).
--
-- Safe to re-run: WHERE clauses only match the old form (no highlight=).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1) employee_notifications.action_url
-- ---------------------------------------------------------------------------
UPDATE public.employee_notifications
SET action_url =
  '/dashboard/real-estate/landlords?highlight='
  || (regexp_match(
    action_url,
    '/dashboard/real-estate/landlords/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/?$'
  ))[1]
WHERE action_url IS NOT NULL
  AND action_url ~ '/dashboard/real-estate/landlords/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/?$'
  AND action_url !~ '[?&]highlight=';

-- ---------------------------------------------------------------------------
-- 2) employee_notifications.body (legacy trailing absolute/relative URL line)
-- ---------------------------------------------------------------------------
UPDATE public.employee_notifications
SET body = regexp_replace(
  body,
  '(^|\n)((?:https?://[^\s]+)?/dashboard/real-estate/landlords/)([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/?(\s*)$',
  E'\\1/dashboard/real-estate/landlords?highlight=\\3\\4',
  'n'
)
WHERE body ~ '(^|\n)((?:https?://[^\s]+)?/dashboard/real-estate/landlords/)([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/?(\s*)$';

-- ---------------------------------------------------------------------------
-- 2b) Promote body trailing landlord deep-link into action_url when null
--     (pre-action_url-column rows). Idempotent: only where action_url IS NULL.
-- ---------------------------------------------------------------------------
UPDATE public.employee_notifications
SET action_url =
  '/dashboard/real-estate/landlords?highlight='
  || coalesce(
    (regexp_match(
      body,
      '/dashboard/real-estate/landlords\?highlight=([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\s*$'
    ))[1],
    (regexp_match(
      body,
      '/dashboard/real-estate/landlords/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/?\s*$'
    ))[1]
  )
WHERE action_url IS NULL
  AND (
    body ~ '/dashboard/real-estate/landlords\?highlight=[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}\s*$'
    OR body ~ '/dashboard/real-estate/landlords/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/?\s*$'
  );

-- ---------------------------------------------------------------------------
-- 3) landlord_notifications — same pattern if any ever stored staff-style URLs
-- ---------------------------------------------------------------------------
UPDATE public.landlord_notifications
SET action_url =
  '/dashboard/real-estate/landlords?highlight='
  || (regexp_match(
    action_url,
    '/dashboard/real-estate/landlords/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/?$'
  ))[1]
WHERE action_url IS NOT NULL
  AND action_url ~ '/dashboard/real-estate/landlords/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/?$'
  AND action_url !~ '[?&]highlight=';

-- ---------------------------------------------------------------------------
-- 4) lessee_notifications — same defensive rewrite
-- ---------------------------------------------------------------------------
UPDATE public.lessee_notifications
SET action_url =
  '/dashboard/real-estate/landlords?highlight='
  || (regexp_match(
    action_url,
    '/dashboard/real-estate/landlords/([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})/?$'
  ))[1]
WHERE action_url IS NOT NULL
  AND action_url ~ '/dashboard/real-estate/landlords/[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}/?$'
  AND action_url !~ '[?&]highlight=';
