-- Script 175: Support tickets — tenant "Report a Problem" feedback channel.
-- Apply on staging first; production after verification.
--
-- Tenant super_admin: INSERT + SELECT own tenant rows.
-- Davors platform super_admin: SELECT + UPDATE all tenants (cross-tenant).
-- submitted_by / resolved_by reference user_accounts.auth_uid (PK).

BEGIN;

CREATE TABLE IF NOT EXISTS public.support_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id) ON DELETE CASCADE,
  submitted_by uuid NOT NULL REFERENCES public.user_accounts(auth_uid) ON DELETE RESTRICT,
  subject text NOT NULL,
  description text NOT NULL,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'in_progress', 'resolved', 'closed')),
  resolution_notes text NULL,
  resolved_by uuid NULL REFERENCES public.user_accounts(auth_uid) ON DELETE SET NULL,
  resolved_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.support_tickets IS
  'Tenant-reported support issues. Tenant super_admin submits and views own rows; '
  'Davors platform super_admin resolves cross-tenant.';

COMMENT ON COLUMN public.support_tickets.submitted_by IS
  'user_accounts.auth_uid of the submitting super_admin.';

COMMENT ON COLUMN public.support_tickets.resolved_by IS
  'user_accounts.auth_uid of the Davors resolver when status is resolved/closed.';

CREATE INDEX IF NOT EXISTS support_tickets_tenant_created_idx
  ON public.support_tickets (tenant_id, created_at DESC);

CREATE INDEX IF NOT EXISTS support_tickets_status_idx
  ON public.support_tickets (status);

CREATE INDEX IF NOT EXISTS support_tickets_created_at_desc_idx
  ON public.support_tickets (created_at DESC);

DROP TRIGGER IF EXISTS trg_support_tickets_enforce_tenant_id ON public.support_tickets;
CREATE TRIGGER trg_support_tickets_enforce_tenant_id
  BEFORE INSERT OR UPDATE OF tenant_id ON public.support_tickets
  FOR EACH ROW
  EXECUTE FUNCTION enforce_row_tenant_id();

CREATE OR REPLACE FUNCTION support_tickets_set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_support_tickets_updated_at ON public.support_tickets;
CREATE TRIGGER trg_support_tickets_updated_at
  BEFORE UPDATE ON public.support_tickets
  FOR EACH ROW
  EXECUTE FUNCTION support_tickets_set_updated_at();

GRANT SELECT, INSERT, UPDATE ON public.support_tickets TO authenticated;
GRANT ALL ON public.support_tickets TO service_role;

ALTER TABLE public.support_tickets ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS support_tickets_tenant_insert ON public.support_tickets;
CREATE POLICY support_tickets_tenant_insert
  ON public.support_tickets
  FOR INSERT
  TO authenticated
  WITH CHECK (tenant_matches(tenant_id) AND is_super_admin());

DROP POLICY IF EXISTS support_tickets_tenant_select ON public.support_tickets;
CREATE POLICY support_tickets_tenant_select
  ON public.support_tickets
  FOR SELECT
  TO authenticated
  USING (tenant_matches(tenant_id) AND is_super_admin());

DROP POLICY IF EXISTS support_tickets_davors_platform_select ON public.support_tickets;
CREATE POLICY support_tickets_davors_platform_select
  ON public.support_tickets
  FOR SELECT
  TO authenticated
  USING (
    is_super_admin()
    AND current_user_tenant_id() = '00000001-0000-4000-8000-000000000001'::uuid
  );

DROP POLICY IF EXISTS support_tickets_davors_platform_update ON public.support_tickets;
CREATE POLICY support_tickets_davors_platform_update
  ON public.support_tickets
  FOR UPDATE
  TO authenticated
  USING (
    is_super_admin()
    AND current_user_tenant_id() = '00000001-0000-4000-8000-000000000001'::uuid
  )
  WITH CHECK (
    is_super_admin()
    AND current_user_tenant_id() = '00000001-0000-4000-8000-000000000001'::uuid
  );

COMMIT;
