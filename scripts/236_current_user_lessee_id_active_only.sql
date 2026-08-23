-- Script 236: Sequential email reuse — active-only lessee identity helper
-- current_user_lessee_id() ignores former lessees so revoked portal links
-- cannot resolve after auth_user_id is cleared (defense in depth; unique
-- index idx_lessees_auth_user_id already limits one non-null link).

BEGIN;

CREATE OR REPLACE FUNCTION public.current_user_lessee_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.lessee_id
  FROM public.lessees l
  WHERE l.auth_user_id = auth.uid()
    AND COALESCE(l.status, 'active') <> 'former'
  ORDER BY l.created_at ASC
  LIMIT 1;
$$;

COMMENT ON FUNCTION public.current_user_lessee_id() IS
  'Resolves the active (non-former) lessee row for auth.uid(); supports sequential portal reuse.';

GRANT EXECUTE ON FUNCTION public.current_user_lessee_id() TO authenticated, service_role;

COMMIT;
