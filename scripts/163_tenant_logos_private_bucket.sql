-- Script 163: Make tenant-logos bucket private (remove anonymous public read).
-- RE photos, receipts, lease documents, and logos must use signed URLs server-side.
-- Apply on staging/local before production.

BEGIN;

UPDATE storage.buckets
SET public = false
WHERE id = 'tenant-logos';

DROP POLICY IF EXISTS public_read_tenant_logos ON storage.objects;

-- Authenticated super-admins may read objects in their tenant folder (direct client
-- access when not using service-role signed URLs). Service role bypasses RLS.
DROP POLICY IF EXISTS authenticated_read_tenant_logos ON storage.objects;
CREATE POLICY authenticated_read_tenant_logos
  ON storage.objects
  FOR SELECT
  TO authenticated
  USING (
    bucket_id = 'tenant-logos'
    AND is_super_admin()
    AND (storage.foldername(name))[1] = (SELECT current_user_tenant_id()::text)
  );

COMMENT ON COLUMN tenants.logo_url IS
  'Storage path or legacy URL for tenant workspace logo (tenant-logos bucket; use signed URLs for display).';

COMMIT;
