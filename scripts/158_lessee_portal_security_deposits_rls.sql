-- Lessee (tenant) portal: SELECT RLS on security_deposits.
-- Mirrors lessee_portal_select_own_rent_ledger (script 131):
-- scoped through lease_id -> lessee_id via current_user_lessee_id().
--
-- Apply after 131_lessee_portal_foundation.sql (requires current_user_lessee_id()).

BEGIN;

ALTER TABLE public.security_deposits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lessee_portal_select_own_security_deposits ON public.security_deposits;
CREATE POLICY lessee_portal_select_own_security_deposits
  ON public.security_deposits
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.leases le
      WHERE le.tenant_id = security_deposits.tenant_id
        AND le.lease_id = security_deposits.lease_id
        AND le.lessee_id = public.current_user_lessee_id()
    )
  );

GRANT SELECT ON TABLE public.security_deposits TO authenticated;

COMMIT;
