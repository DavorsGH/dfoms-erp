-- Script 206: Duty roster rotation metadata (start audit + approval)
-- Stores who started/approved each rotation per customer, tenant-scoped.

BEGIN;

CREATE TABLE IF NOT EXISTS public.roster_rotation_metadata (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  client_id text NOT NULL,
  rotation_number integer NOT NULL CHECK (rotation_number > 0),
  started_by_name text,
  started_by_auth_uid uuid,
  started_at timestamptz,
  approved_by_name text,
  approved_by_title text,
  approved_by_auth_uid uuid,
  approved_at timestamptz,
  CONSTRAINT roster_rotation_metadata_tenant_client_rotation_unique
    UNIQUE (tenant_id, client_id, rotation_number)
);

CREATE INDEX IF NOT EXISTS idx_roster_rotation_metadata_tenant_client
  ON public.roster_rotation_metadata (tenant_id, client_id);

COMMENT ON TABLE public.roster_rotation_metadata IS
  'Per-rotation audit: who started the rotation and who approved the duty roster.';

ALTER TABLE public.roster_rotation_metadata ENABLE ROW LEVEL SECURITY;

GRANT SELECT, INSERT, UPDATE ON public.roster_rotation_metadata TO authenticated;

DROP POLICY IF EXISTS roster_rotation_metadata_select ON public.roster_rotation_metadata;
CREATE POLICY roster_rotation_metadata_select
  ON public.roster_rotation_metadata
  FOR SELECT
  TO authenticated
  USING (
    tenant_matches(tenant_id)
    AND (
      is_super_admin()
      OR current_user_role() IN (
        'operations_manager'::app_role,
        'supervisor'::app_role,
        'director'::app_role
      )
      OR can_access_client_record(client_id)
    )
  );

DROP POLICY IF EXISTS roster_rotation_metadata_ops_write ON public.roster_rotation_metadata;
CREATE POLICY roster_rotation_metadata_ops_write
  ON public.roster_rotation_metadata
  FOR ALL
  TO authenticated
  USING (
    tenant_matches(tenant_id)
    AND current_user_role() IN (
      'super_admin'::app_role,
      'operations_manager'::app_role,
      'director'::app_role
    )
  )
  WITH CHECK (
    tenant_matches(tenant_id)
    AND current_user_role() IN (
      'super_admin'::app_role,
      'operations_manager'::app_role,
      'director'::app_role
    )
  );

COMMIT;
