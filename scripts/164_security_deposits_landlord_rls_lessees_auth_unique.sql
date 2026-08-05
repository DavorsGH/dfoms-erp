-- Script 164: Security hardening (defense in depth)
-- 1. Landlord-portal SELECT RLS on security_deposits (mirrors rent_ledger / leases in script 139)
-- 2. Partial UNIQUE index on lessees.auth_user_id (mirrors landlords in script 139)
--
-- Apply after 139_landlord_portal_foundation.sql and 158_lessee_portal_security_deposits_rls.sql.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Landlord portal: SELECT own tenant's security deposits
-- ---------------------------------------------------------------------------
ALTER TABLE public.security_deposits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS landlord_portal_select_own_security_deposits ON public.security_deposits;
CREATE POLICY landlord_portal_select_own_security_deposits
  ON public.security_deposits
  FOR SELECT
  TO authenticated
  USING (tenant_id = public.current_user_landlord_tenant_id());

-- GRANT SELECT already granted in script 158; no change needed.

-- ---------------------------------------------------------------------------
-- 2. Enforce one lessee row per auth user (current_user_lessee_id() determinism)
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  dup_count integer;
  dup_detail text;
BEGIN
  SELECT COUNT(*)::integer
  INTO dup_count
  FROM (
    SELECT auth_user_id
    FROM public.lessees
    WHERE auth_user_id IS NOT NULL
    GROUP BY auth_user_id
    HAVING COUNT(*) > 1
  ) duplicates;

  IF dup_count > 0 THEN
    SELECT string_agg(
      format(
        'auth_user_id=%s lessee_ids=[%s]',
        auth_user_id,
        lessee_ids
      ),
      '; '
    )
    INTO dup_detail
    FROM (
      SELECT
        auth_user_id,
        string_agg(lessee_id::text, ', ' ORDER BY created_at ASC) AS lessee_ids
      FROM public.lessees
      WHERE auth_user_id IS NOT NULL
      GROUP BY auth_user_id
      HAVING COUNT(*) > 1
    ) grouped;

    RAISE EXCEPTION
      'Cannot add UNIQUE on lessees.auth_user_id: % duplicate auth_user_id value(s) found. Resolve before re-running. Details: %',
      dup_count,
      dup_detail;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_lessees_auth_user_id
  ON public.lessees (auth_user_id)
  WHERE auth_user_id IS NOT NULL;

COMMENT ON INDEX public.idx_lessees_auth_user_id IS
  'At most one lessee portal login per Supabase Auth user (mirrors idx_landlords_auth_user_id).';

COMMIT;
