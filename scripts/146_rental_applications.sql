-- Script 146: Rental Applications & Tenant Screening
--
-- Adds:
--   - rental_applications (tenant-scoped application packets)
--   - rental_application_links (shareable unit apply tokens)
--   - property_units.status value application_hold (soft-hold on APPROVE only)
--
-- Soft-hold choice: extend unit status with `application_hold` (not under_maintenance).
-- Submit does NOT hold the unit; only landlord APPROVE sets application_hold so
-- another approval cannot double-book. Lease create from an approved application
-- then moves the unit to occupied.
--
-- Access model:
--   - Public submit via service-role admin APIs (token lookup); no anon RLS writes.
--   - Landlord / staff reads & decisions via service-role admin APIs after session checks.
--   - RLS enabled; service_role ALL; no authenticated/anon grants (matches invites/short_links).
--
-- Related app paths:
--   /apply/[token]
--   /landlord-portal/real-estate/applications
--   /dashboard/real-estate/applications
--
-- Safe to re-run. Apply on staging first.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Unit soft-hold status: application_hold
-- ---------------------------------------------------------------------------
-- App layer enforces vacant | occupied | under_maintenance | application_hold.
-- If a CHECK constraint exists on property_units.status, widen it; otherwise no-op.

DO $$
DECLARE
  con_name text;
BEGIN
  SELECT c.conname INTO con_name
  FROM pg_constraint c
  JOIN pg_class t ON t.oid = c.conrelid
  JOIN pg_namespace n ON n.oid = t.relnamespace
  WHERE n.nspname = 'public'
    AND t.relname = 'property_units'
    AND c.contype = 'c'
    AND pg_get_constraintdef(c.oid) ILIKE '%status%';

  IF con_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE public.property_units DROP CONSTRAINT %I', con_name);
    ALTER TABLE public.property_units
      ADD CONSTRAINT property_units_status_check
      CHECK (
        status IN (
          'vacant',
          'occupied',
          'under_maintenance',
          'application_hold'
        )
      );
  END IF;
END $$;

COMMENT ON COLUMN public.property_units.status IS
  'vacant | occupied | under_maintenance | application_hold. '
  'application_hold is set only when a rental application is approved (soft-hold).';

-- ---------------------------------------------------------------------------
-- 2. rental_application_links — shareable apply URLs per unit
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rental_application_links (
  link_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  property_id uuid NOT NULL,
  unit_id uuid NOT NULL,
  token_hash text NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT rental_application_links_token_hash_key UNIQUE (token_hash)
);

CREATE INDEX IF NOT EXISTS idx_rental_application_links_unit
  ON public.rental_application_links (tenant_id, unit_id)
  WHERE revoked_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_rental_application_links_expires
  ON public.rental_application_links (expires_at)
  WHERE revoked_at IS NULL;

COMMENT ON TABLE public.rental_application_links IS
  'Shareable hashed tokens for public rental application forms on a vacant unit.';

ALTER TABLE public.rental_application_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rental_application_links_service_role_all
  ON public.rental_application_links;
CREATE POLICY rental_application_links_service_role_all
  ON public.rental_application_links
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

GRANT ALL ON TABLE public.rental_application_links TO service_role;
REVOKE ALL ON TABLE public.rental_application_links FROM authenticated, anon;

-- ---------------------------------------------------------------------------
-- 3. rental_applications — applicant packets
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rental_applications (
  application_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  property_id uuid NOT NULL,
  unit_id uuid NOT NULL,
  link_id uuid REFERENCES public.rental_application_links (link_id),

  -- Identity
  full_name text NOT NULL,
  email text,
  phone text NOT NULL,
  national_id text,

  -- Desired occupancy
  desired_move_in date,

  -- Household / pets
  household_size integer,
  has_pets boolean NOT NULL DEFAULT false,
  pet_details text,

  -- Income / employment
  employer_name text,
  job_title text,
  monthly_income_ghs numeric(14, 2),
  employment_notes text,

  -- References (free-text v1)
  references_text text,

  -- Optional ID document URLs (storage public URLs)
  id_document_urls jsonb NOT NULL DEFAULT '[]'::jsonb,

  -- Consent
  consent_accuracy boolean NOT NULL DEFAULT false,
  consent_background_check boolean NOT NULL DEFAULT false,
  consented_at timestamptz,

  -- Workflow
  status text NOT NULL DEFAULT 'submitted'
    CHECK (
      status IN (
        'submitted',
        'under_review',
        'info_requested',
        'approved',
        'rejected',
        'withdrawn',
        'closed'
      )
    ),
  landlord_notes text,
  info_request_message text,
  decided_at timestamptz,
  decided_by uuid,
  decision_reason text,

  -- Downstream links (set on convert-to-lease)
  lessee_id uuid,
  lease_id uuid,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rental_applications_tenant_status
  ON public.rental_applications (tenant_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_rental_applications_unit
  ON public.rental_applications (tenant_id, unit_id);

COMMENT ON TABLE public.rental_applications IS
  'Public rental application packets for Real Estate tenant screening. '
  'Mutations via service-role admin APIs; landlords decide; staff read-only for davors_managed.';

ALTER TABLE public.rental_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS rental_applications_service_role_all
  ON public.rental_applications;
CREATE POLICY rental_applications_service_role_all
  ON public.rental_applications
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

GRANT ALL ON TABLE public.rental_applications TO service_role;
REVOKE ALL ON TABLE public.rental_applications FROM authenticated, anon;

COMMIT;
