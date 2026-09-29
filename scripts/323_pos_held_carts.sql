BEGIN;

CREATE OR REPLACE FUNCTION public.current_user_active_business_unit_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ua.active_business_unit_id
  FROM public.user_accounts ua
  WHERE ua.auth_uid = auth.uid()
    AND ua.is_active IS NOT FALSE
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.pos_business_unit_row_visible(p_row_business_unit_id uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.current_user_view_all_business_units() THEN
    RETURN true;
  END IF;

  IF public.current_user_active_business_unit_id() IS NOT NULL THEN
    RETURN p_row_business_unit_id IS NOT DISTINCT FROM public.current_user_active_business_unit_id();
  END IF;

  RETURN p_row_business_unit_id IS NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.can_access_pos_held_carts()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.current_user_role() IN (
    'super_admin'::public.app_role,
    'finance'::public.app_role,
    'hr'::public.app_role,
    'director'::public.app_role,
    'sales_rep'::public.app_role
  );
$$;

CREATE TABLE IF NOT EXISTS public.pos_held_carts (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  business_unit_id uuid,
  label text NOT NULL,
  client_id text,
  cart jsonb NOT NULL,
  sales_rep_id text,
  notes text,
  held_by uuid NOT NULL,
  held_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);

ALTER TABLE public.pos_held_carts
  DROP CONSTRAINT IF EXISTS pos_held_carts_tenant_fkey;

ALTER TABLE public.pos_held_carts
  ADD CONSTRAINT pos_held_carts_tenant_fkey
  FOREIGN KEY (tenant_id) REFERENCES public.tenants(id);

ALTER TABLE public.pos_held_carts
  DROP CONSTRAINT IF EXISTS pos_held_carts_business_unit_fkey;

ALTER TABLE public.pos_held_carts
  ADD CONSTRAINT pos_held_carts_business_unit_fkey
  FOREIGN KEY (business_unit_id) REFERENCES public.business_units(id)
  ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_pos_held_carts_tenant_held_at
  ON public.pos_held_carts (tenant_id, held_at DESC);

CREATE INDEX IF NOT EXISTS idx_pos_held_carts_tenant_business_unit
  ON public.pos_held_carts (tenant_id, business_unit_id);

CREATE OR REPLACE FUNCTION public.touch_pos_held_carts_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_pos_held_carts_updated_at ON public.pos_held_carts;

CREATE TRIGGER trg_pos_held_carts_updated_at
  BEFORE UPDATE ON public.pos_held_carts
  FOR EACH ROW
  EXECUTE FUNCTION public.touch_pos_held_carts_updated_at();

ALTER TABLE public.pos_held_carts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pos_held_carts_select ON public.pos_held_carts;
CREATE POLICY pos_held_carts_select ON public.pos_held_carts
  AS PERMISSIVE FOR SELECT TO authenticated
  USING (
    public.tenant_matches(tenant_id)
    AND public.can_access_pos_held_carts()
    AND public.pos_business_unit_row_visible(business_unit_id)
  );

DROP POLICY IF EXISTS pos_held_carts_insert ON public.pos_held_carts;
CREATE POLICY pos_held_carts_insert ON public.pos_held_carts
  AS PERMISSIVE FOR INSERT TO authenticated
  WITH CHECK (
    public.tenant_matches(tenant_id)
    AND public.can_access_pos_held_carts()
    AND public.pos_business_unit_row_visible(business_unit_id)
    AND held_by = auth.uid()
  );

DROP POLICY IF EXISTS pos_held_carts_update ON public.pos_held_carts;
CREATE POLICY pos_held_carts_update ON public.pos_held_carts
  AS PERMISSIVE FOR UPDATE TO authenticated
  USING (
    public.tenant_matches(tenant_id)
    AND public.can_access_pos_held_carts()
    AND public.pos_business_unit_row_visible(business_unit_id)
  )
  WITH CHECK (
    public.tenant_matches(tenant_id)
    AND public.can_access_pos_held_carts()
    AND public.pos_business_unit_row_visible(business_unit_id)
  );

DROP POLICY IF EXISTS pos_held_carts_delete ON public.pos_held_carts;
CREATE POLICY pos_held_carts_delete ON public.pos_held_carts
  AS PERMISSIVE FOR DELETE TO authenticated
  USING (
    public.tenant_matches(tenant_id)
    AND public.can_access_pos_held_carts()
    AND public.pos_business_unit_row_visible(business_unit_id)
  );

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.pos_held_carts TO authenticated;

REVOKE ALL ON FUNCTION public.current_user_active_business_unit_id() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.pos_business_unit_row_visible(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.can_access_pos_held_carts() FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.current_user_active_business_unit_id() TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.pos_business_unit_row_visible(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.can_access_pos_held_carts() TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
