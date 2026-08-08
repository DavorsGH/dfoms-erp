-- Script 180: Seed payment_methods from Davors template for tenants with no rows yet.
-- One-time backfill only — tenants that already have payment_methods are untouched.
-- Apply staging first; production after verification.

BEGIN;

-- Davors Facilities Management Services Ltd (platform template tenant).
INSERT INTO public.payment_methods (tenant_id, name)
SELECT t.id, d.name
FROM public.tenants t
CROSS JOIN (
  SELECT name
  FROM public.payment_methods
  WHERE tenant_id = '00000001-0000-4000-8000-000000000001'::uuid
  ORDER BY name
) d
WHERE NOT EXISTS (
  SELECT 1
  FROM public.payment_methods pm
  WHERE pm.tenant_id = t.id
)
ON CONFLICT (tenant_id, name) DO NOTHING;

COMMIT;
