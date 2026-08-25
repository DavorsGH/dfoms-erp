BEGIN;

CREATE TABLE IF NOT EXISTS public.facility_managers (
  facility_manager_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id),
  auth_user_id uuid,
  full_name text NOT NULL,
  email text NOT NULL,
  phone text,
  status text NOT NULL DEFAULT 'invited'
    CHECK (status IN ('invited', 'active', 'revoked')),
  can_manage_maintenance boolean NOT NULL DEFAULT true,
  can_manage_complaints boolean NOT NULL DEFAULT true,
  can_manage_inspections boolean NOT NULL DEFAULT true,
  can_log_services boolean NOT NULL DEFAULT true,
  can_collect_rent boolean NOT NULL DEFAULT false,
  can_collect_charges boolean NOT NULL DEFAULT false,
  invited_by_auth_uid uuid,
  invited_at timestamptz NOT NULL DEFAULT now(),
  activated_at timestamptz,
  revoked_at timestamptz,
  revoked_by_auth_uid uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT facility_managers_email_nonempty
    CHECK (length(trim(email)) > 0),
  CONSTRAINT facility_managers_status_timestamps CHECK (
    (status = 'invited' AND activated_at IS NULL AND revoked_at IS NULL)
    OR (status = 'active' AND activated_at IS NOT NULL AND revoked_at IS NULL)
    OR (status = 'revoked' AND revoked_at IS NOT NULL)
  ),
  CONSTRAINT facility_managers_tenant_fm_unique
    UNIQUE (tenant_id, facility_manager_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_facility_managers_auth_user_id
  ON public.facility_managers (auth_user_id)
  WHERE auth_user_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_facility_managers_tenant_email_active
  ON public.facility_managers (tenant_id, lower(email))
  WHERE status IN ('invited', 'active');

CREATE INDEX IF NOT EXISTS idx_facility_managers_tenant_status
  ON public.facility_managers (tenant_id, status);

CREATE TABLE IF NOT EXISTS public.facility_manager_property_assignments (
  assignment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  facility_manager_id uuid NOT NULL,
  property_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by_auth_uid uuid,
  CONSTRAINT facility_manager_property_assignments_unique
    UNIQUE (tenant_id, facility_manager_id, property_id),
  CONSTRAINT facility_manager_property_assignments_fm_fk
    FOREIGN KEY (tenant_id, facility_manager_id)
    REFERENCES public.facility_managers (tenant_id, facility_manager_id)
    ON DELETE CASCADE,
  CONSTRAINT facility_manager_property_assignments_property_fk
    FOREIGN KEY (tenant_id, property_id)
    REFERENCES public.properties (tenant_id, property_id)
    ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_fm_assignments_property
  ON public.facility_manager_property_assignments (property_id);

CREATE INDEX IF NOT EXISTS idx_fm_assignments_fm
  ON public.facility_manager_property_assignments (facility_manager_id);

CREATE TABLE IF NOT EXISTS public.facility_manager_portal_invites (
  invite_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id),
  facility_manager_id uuid NOT NULL
    REFERENCES public.facility_managers (facility_manager_id) ON DELETE CASCADE,
  email text NOT NULL,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  used_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT facility_manager_portal_invites_token_hash_key UNIQUE (token_hash)
);

CREATE INDEX IF NOT EXISTS idx_fm_invites_fm
  ON public.facility_manager_portal_invites (tenant_id, facility_manager_id);

CREATE INDEX IF NOT EXISTS idx_fm_invites_expires
  ON public.facility_manager_portal_invites (expires_at)
  WHERE used_at IS NULL;

CREATE TABLE IF NOT EXISTS public.facility_manager_collections (
  collection_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id),
  facility_manager_id uuid NOT NULL
    REFERENCES public.facility_managers (facility_manager_id),
  rent_ledger_entry_id uuid NOT NULL,
  property_id uuid NOT NULL,
  lease_id uuid NOT NULL,
  amount_ghs numeric(12,2) NOT NULL CHECK (amount_ghs > 0),
  payment_method text NOT NULL
    CHECK (payment_method IN ('cash', 'momo', 'bank_transfer')),
  collected_at timestamptz NOT NULL DEFAULT now(),
  notes text,
  status text NOT NULL DEFAULT 'pending_landlord_confirmation'
    CHECK (status IN (
      'pending_landlord_confirmation',
      'confirmed',
      'rejected',
      'cancelled'
    )),
  confirmed_by_auth_uid uuid,
  confirmed_at timestamptz,
  rejection_reason text,
  applied_to_rent_ledger_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT facility_manager_collections_property_fk
    FOREIGN KEY (tenant_id, property_id)
    REFERENCES public.properties (tenant_id, property_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_fm_collections_one_pending_per_entry
  ON public.facility_manager_collections (tenant_id, rent_ledger_entry_id)
  WHERE status = 'pending_landlord_confirmation';

CREATE INDEX IF NOT EXISTS idx_fm_collections_fm
  ON public.facility_manager_collections (facility_manager_id);

CREATE INDEX IF NOT EXISTS idx_fm_collections_property
  ON public.facility_manager_collections (tenant_id, property_id);

CREATE INDEX IF NOT EXISTS idx_fm_collections_status
  ON public.facility_manager_collections (tenant_id, status);

CREATE TABLE IF NOT EXISTS public.property_service_records (
  record_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id),
  property_id uuid NOT NULL,
  unit_id uuid,
  service_type text NOT NULL CHECK (service_type IN (
    'cleaning', 'gardening', 'other'
  )),
  service_date date NOT NULL,
  notes text,
  logged_by_facility_manager_id uuid
    REFERENCES public.facility_managers (facility_manager_id),
  logged_by_auth_uid uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT property_service_records_property_fk
    FOREIGN KEY (tenant_id, property_id)
    REFERENCES public.properties (tenant_id, property_id),
  CONSTRAINT property_service_records_unit_fk
    FOREIGN KEY (tenant_id, unit_id)
    REFERENCES public.property_units (tenant_id, unit_id)
);

CREATE INDEX IF NOT EXISTS idx_property_service_records_property
  ON public.property_service_records (tenant_id, property_id);

CREATE INDEX IF NOT EXISTS idx_property_service_records_fm
  ON public.property_service_records (logged_by_facility_manager_id);

CREATE OR REPLACE FUNCTION public.current_user_facility_manager_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT fm.facility_manager_id
  FROM public.facility_managers fm
  WHERE fm.auth_user_id = auth.uid()
    AND fm.status = 'active'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.current_user_facility_manager_tenant_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT fm.tenant_id
  FROM public.facility_managers fm
  WHERE fm.auth_user_id = auth.uid()
    AND fm.status = 'active'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.is_facility_manager_portal_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.current_user_facility_manager_id() IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.facility_manager_has_property(p_property_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.facility_manager_property_assignments a
    WHERE a.facility_manager_id = public.current_user_facility_manager_id()
      AND a.property_id = p_property_id
  );
$$;

GRANT EXECUTE ON FUNCTION public.current_user_facility_manager_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.current_user_facility_manager_tenant_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.is_facility_manager_portal_user() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.facility_manager_has_property(uuid) TO authenticated, service_role;

COMMIT;
