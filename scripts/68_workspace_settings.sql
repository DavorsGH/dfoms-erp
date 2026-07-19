-- Script 68: Workspace settings — tenant logo_url + tenant-logos storage bucket.
-- Apply on staging/local before production.

BEGIN;

ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS logo_url TEXT;

COMMENT ON COLUMN tenants.logo_url IS
  'Public URL for tenant workspace logo (Supabase Storage tenant-logos bucket).';

GRANT UPDATE (name, logo_url, updated_at) ON tenants TO authenticated;

DROP POLICY IF EXISTS tenants_update_own_super_admin ON tenants;
CREATE POLICY tenants_update_own_super_admin
  ON tenants
  FOR UPDATE
  TO authenticated
  USING (
    id = (SELECT current_user_tenant_id())
    AND is_super_admin()
  )
  WITH CHECK (
    id = (SELECT current_user_tenant_id())
    AND is_super_admin()
  );

INSERT INTO storage.buckets (id, name, public)
VALUES ('tenant-logos', 'tenant-logos', true)
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public;

DROP POLICY IF EXISTS public_read_tenant_logos ON storage.objects;
CREATE POLICY public_read_tenant_logos
  ON storage.objects
  FOR SELECT
  USING (bucket_id = 'tenant-logos');

DROP POLICY IF EXISTS authenticated_upload_tenant_logos ON storage.objects;
CREATE POLICY authenticated_upload_tenant_logos
  ON storage.objects
  FOR INSERT
  TO authenticated
  WITH CHECK (
    bucket_id = 'tenant-logos'
    AND is_super_admin()
    AND (storage.foldername(name))[1] = (SELECT current_user_tenant_id()::text)
  );

DROP POLICY IF EXISTS authenticated_update_tenant_logos ON storage.objects;
CREATE POLICY authenticated_update_tenant_logos
  ON storage.objects
  FOR UPDATE
  TO authenticated
  USING (
    bucket_id = 'tenant-logos'
    AND is_super_admin()
    AND (storage.foldername(name))[1] = (SELECT current_user_tenant_id()::text)
  )
  WITH CHECK (
    bucket_id = 'tenant-logos'
    AND is_super_admin()
    AND (storage.foldername(name))[1] = (SELECT current_user_tenant_id()::text)
  );

COMMIT;
