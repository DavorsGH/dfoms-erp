-- Script 134: Tenant portal repairs (self-fix rent credit) + lessee complaints.
-- Apply in Supabase SQL Editor (staging first, then production).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Maintenance: tenant self-fix + proposed cost + rent credit link
-- ---------------------------------------------------------------------------
ALTER TABLE public.maintenance_requests
  ADD COLUMN IF NOT EXISTS tenant_self_fix boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS proposed_cost_ghs numeric,
  ADD COLUMN IF NOT EXISTS rent_credit_entry_id uuid;

COMMENT ON COLUMN public.maintenance_requests.tenant_self_fix IS
  'True when the lessee proposes to arrange/pay the repair themselves.';
COMMENT ON COLUMN public.maintenance_requests.proposed_cost_ghs IS
  'Lessee-proposed self-fix cost; landlord approves this amount (no escrow).';
COMMENT ON COLUMN public.maintenance_requests.rent_credit_entry_id IS
  'rent_ledger.entry_id that received the self-fix rent credit after approval.';

-- ---------------------------------------------------------------------------
-- 2. Rent ledger credit (self-fix offset against amount due)
-- outstanding = amount_due_ghs - amount_paid_ghs - credit_ghs
-- ---------------------------------------------------------------------------
ALTER TABLE public.rent_ledger
  ADD COLUMN IF NOT EXISTS credit_ghs numeric NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.rent_ledger.credit_ghs IS
  'Approved offsets (e.g. tenant self-fix maintenance) reducing amount owed.';

-- ---------------------------------------------------------------------------
-- 3. Lessee complaints (portal + staff)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.lessee_complaints (
  tenant_id uuid NOT NULL,
  complaint_id uuid NOT NULL DEFAULT gen_random_uuid(),
  lease_id uuid NOT NULL,
  lessee_id uuid NOT NULL,
  subject text NOT NULL,
  description text NOT NULL,
  status text NOT NULL DEFAULT 'submitted',
  staff_response text,
  date_reported timestamptz NOT NULL DEFAULT now(),
  date_resolved timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, complaint_id)
);

CREATE INDEX IF NOT EXISTS idx_lessee_complaints_lessee
  ON public.lessee_complaints (tenant_id, lessee_id, date_reported DESC);

CREATE INDEX IF NOT EXISTS idx_lessee_complaints_lease
  ON public.lessee_complaints (tenant_id, lease_id);

COMMENT ON TABLE public.lessee_complaints IS
  'Tenant-portal complaints for Real Estate leases (distinct from ops complaint_register).';

ALTER TABLE public.lessee_complaints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lessee_portal_select_own_complaints ON public.lessee_complaints;
CREATE POLICY lessee_portal_select_own_complaints
  ON public.lessee_complaints
  FOR SELECT
  TO authenticated
  USING (
    lessee_id = public.current_user_lessee_id()
  );

-- Staff APIs use service role. Additive tenant_matches staff policies if used elsewhere.
DROP POLICY IF EXISTS lessee_complaints_tenant_select ON public.lessee_complaints;
CREATE POLICY lessee_complaints_tenant_select
  ON public.lessee_complaints
  FOR SELECT
  TO authenticated
  USING (public.tenant_matches(tenant_id));

DROP POLICY IF EXISTS lessee_complaints_tenant_insert ON public.lessee_complaints;
CREATE POLICY lessee_complaints_tenant_insert
  ON public.lessee_complaints
  FOR INSERT
  TO authenticated
  WITH CHECK (public.tenant_matches(tenant_id));

DROP POLICY IF EXISTS lessee_complaints_tenant_update ON public.lessee_complaints;
CREATE POLICY lessee_complaints_tenant_update
  ON public.lessee_complaints
  FOR UPDATE
  TO authenticated
  USING (public.tenant_matches(tenant_id))
  WITH CHECK (public.tenant_matches(tenant_id));

DROP POLICY IF EXISTS lessee_complaints_tenant_delete ON public.lessee_complaints;
CREATE POLICY lessee_complaints_tenant_delete
  ON public.lessee_complaints
  FOR DELETE
  TO authenticated
  USING (public.tenant_matches(tenant_id));

GRANT SELECT ON TABLE public.lessee_complaints TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.lessee_complaints TO authenticated;
GRANT ALL ON TABLE public.lessee_complaints TO service_role;

-- Portal SELECT on own maintenance_requests (writes still via service-role APIs).
DROP POLICY IF EXISTS lessee_portal_select_own_maintenance ON public.maintenance_requests;
CREATE POLICY lessee_portal_select_own_maintenance
  ON public.maintenance_requests
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.leases le
      WHERE le.tenant_id = maintenance_requests.tenant_id
        AND le.lease_id = maintenance_requests.lease_id
        AND le.lessee_id = public.current_user_lessee_id()
    )
  );

GRANT SELECT ON TABLE public.maintenance_requests TO authenticated;

COMMIT;
