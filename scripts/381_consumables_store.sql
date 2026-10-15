BEGIN;

CREATE TABLE IF NOT EXISTS public.consumable_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  business_unit_id uuid REFERENCES public.business_units (id) ON DELETE SET NULL,
  item_code text NOT NULL,
  name text NOT NULL,
  category text,
  unit text NOT NULL,
  minimum_level numeric(14,2) NOT NULL DEFAULT 0 CHECK (minimum_level >= 0),
  is_archived boolean NOT NULL DEFAULT false,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT consumable_items_tenant_code_key UNIQUE (tenant_id, item_code)
);

CREATE UNIQUE INDEX IF NOT EXISTS consumable_items_tenant_name_key
  ON public.consumable_items (tenant_id, COALESCE(business_unit_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(btrim(name)))
  WHERE is_archived = false;
CREATE INDEX IF NOT EXISTS consumable_items_tenant_bu_idx
  ON public.consumable_items (tenant_id, business_unit_id);

CREATE TABLE IF NOT EXISTS public.consumable_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  business_unit_id uuid REFERENCES public.business_units (id) ON DELETE SET NULL,
  item_id uuid NOT NULL REFERENCES public.consumable_items (id) ON DELETE RESTRICT,
  movement_type text NOT NULL CHECK (movement_type IN ('receive', 'issue', 'return', 'adjust_in', 'adjust_out')),
  movement_date date NOT NULL,
  quantity numeric(14,2) NOT NULL CHECK (quantity > 0),
  unit_cost numeric(14,4) CHECK (unit_cost IS NULL OR unit_cost >= 0),
  site_code text,
  project_id uuid REFERENCES public.projects (id) ON DELETE SET NULL,
  expense_id uuid REFERENCES public.expense_register (id) ON DELETE SET NULL,
  accounts_payable_id uuid REFERENCES public.accounts_payable (id) ON DELETE SET NULL,
  reason text,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT consumable_movements_site_required CHECK (
    movement_type NOT IN ('issue', 'return') OR site_code IS NOT NULL
  ),
  CONSTRAINT consumable_movements_cost_required CHECK (
    movement_type <> 'receive' OR unit_cost IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS consumable_movements_tenant_date_idx
  ON public.consumable_movements (tenant_id, movement_date);
CREATE INDEX IF NOT EXISTS consumable_movements_item_idx
  ON public.consumable_movements (tenant_id, item_id, movement_date);
CREATE INDEX IF NOT EXISTS consumable_movements_site_idx
  ON public.consumable_movements (tenant_id, site_code, movement_date)
  WHERE site_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS consumable_movements_project_idx
  ON public.consumable_movements (tenant_id, project_id)
  WHERE project_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.enforce_consumable_item_refs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.business_unit_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.business_units bu
    WHERE bu.id = NEW.business_unit_id AND bu.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Business unit does not belong to this tenant';
  END IF;
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.consumable_item_on_hand(p_tenant_id uuid, p_item_id uuid, p_exclude_movement_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT COALESCE(SUM(
    CASE WHEN m.movement_type IN ('receive', 'return', 'adjust_in') THEN m.quantity ELSE -m.quantity END
  ), 0)
  FROM public.consumable_movements m
  WHERE m.tenant_id = p_tenant_id
    AND m.item_id = p_item_id
    AND (p_exclude_movement_id IS NULL OR m.id <> p_exclude_movement_id);
$$;

CREATE OR REPLACE FUNCTION public.enforce_consumable_movement_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_on_hand numeric;
  v_exclude uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.consumable_items i
    WHERE i.id = NEW.item_id AND i.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Consumable item does not belong to this tenant';
  END IF;

  IF NEW.business_unit_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.business_units bu
    WHERE bu.id = NEW.business_unit_id AND bu.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Business unit does not belong to this tenant';
  END IF;

  IF NEW.site_code IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.sites s
    WHERE s.site_code = NEW.site_code AND s.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Site does not belong to this tenant';
  END IF;

  IF NEW.project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = NEW.project_id AND p.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Project does not belong to this tenant';
  END IF;

  IF NEW.expense_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.expense_register e
    WHERE e.id = NEW.expense_id AND e.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Expense does not belong to this tenant';
  END IF;

  IF NEW.accounts_payable_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.accounts_payable a
    WHERE a.id = NEW.accounts_payable_id AND a.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Bill does not belong to this tenant';
  END IF;

  IF NEW.movement_type IN ('issue', 'adjust_out') THEN
    v_exclude := CASE WHEN TG_OP = 'UPDATE' THEN OLD.id ELSE NULL END;
    v_on_hand := public.consumable_item_on_hand(NEW.tenant_id, NEW.item_id, v_exclude);
    IF NEW.quantity > v_on_hand THEN
      RAISE EXCEPTION 'Not enough stock: % available', v_on_hand;
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_consumable_items_enforce_tenant_id ON public.consumable_items;
CREATE TRIGGER trg_consumable_items_enforce_tenant_id
  BEFORE INSERT OR UPDATE ON public.consumable_items
  FOR EACH ROW EXECUTE FUNCTION public.enforce_row_tenant_id();

DROP TRIGGER IF EXISTS trg_consumable_items_refs ON public.consumable_items;
CREATE TRIGGER trg_consumable_items_refs
  BEFORE INSERT OR UPDATE ON public.consumable_items
  FOR EACH ROW EXECUTE FUNCTION public.enforce_consumable_item_refs();

DROP TRIGGER IF EXISTS trg_consumable_movements_enforce_tenant_id ON public.consumable_movements;
CREATE TRIGGER trg_consumable_movements_enforce_tenant_id
  BEFORE INSERT OR UPDATE ON public.consumable_movements
  FOR EACH ROW EXECUTE FUNCTION public.enforce_row_tenant_id();

DROP TRIGGER IF EXISTS trg_consumable_movements_rules ON public.consumable_movements;
CREATE TRIGGER trg_consumable_movements_rules
  BEFORE INSERT OR UPDATE ON public.consumable_movements
  FOR EACH ROW EXECUTE FUNCTION public.enforce_consumable_movement_rules();

ALTER TABLE public.consumable_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consumable_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS consumable_items_tenant_select ON public.consumable_items;
CREATE POLICY consumable_items_tenant_select ON public.consumable_items
  FOR SELECT USING (public.tenant_matches(tenant_id));
DROP POLICY IF EXISTS consumable_items_tenant_insert ON public.consumable_items;
CREATE POLICY consumable_items_tenant_insert ON public.consumable_items
  FOR INSERT WITH CHECK (public.tenant_matches(tenant_id));
DROP POLICY IF EXISTS consumable_items_tenant_update ON public.consumable_items;
CREATE POLICY consumable_items_tenant_update ON public.consumable_items
  FOR UPDATE USING (public.tenant_matches(tenant_id)) WITH CHECK (public.tenant_matches(tenant_id));
DROP POLICY IF EXISTS consumable_items_tenant_delete ON public.consumable_items;
CREATE POLICY consumable_items_tenant_delete ON public.consumable_items
  FOR DELETE USING (public.tenant_matches(tenant_id));

DROP POLICY IF EXISTS consumable_movements_tenant_select ON public.consumable_movements;
CREATE POLICY consumable_movements_tenant_select ON public.consumable_movements
  FOR SELECT USING (public.tenant_matches(tenant_id));
DROP POLICY IF EXISTS consumable_movements_tenant_insert ON public.consumable_movements;
CREATE POLICY consumable_movements_tenant_insert ON public.consumable_movements
  FOR INSERT WITH CHECK (public.tenant_matches(tenant_id));
DROP POLICY IF EXISTS consumable_movements_tenant_update ON public.consumable_movements;
CREATE POLICY consumable_movements_tenant_update ON public.consumable_movements
  FOR UPDATE USING (public.tenant_matches(tenant_id)) WITH CHECK (public.tenant_matches(tenant_id));
DROP POLICY IF EXISTS consumable_movements_tenant_delete ON public.consumable_movements;
CREATE POLICY consumable_movements_tenant_delete ON public.consumable_movements
  FOR DELETE USING (public.tenant_matches(tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.consumable_items TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.consumable_movements TO authenticated;
REVOKE ALL ON FUNCTION public.consumable_item_on_hand(uuid, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consumable_item_on_hand(uuid, uuid, uuid) FROM anon, authenticated;

COMMIT;

NOTIFY pgrst, 'reload schema';

SELECT 'table' AS kind, table_name AS name
FROM information_schema.tables
WHERE table_schema = 'public' AND table_name IN ('consumable_items', 'consumable_movements')
UNION ALL
SELECT 'trigger', event_object_table || '.' || trigger_name
FROM information_schema.triggers
WHERE trigger_schema = 'public' AND event_object_table IN ('consumable_items', 'consumable_movements')
UNION ALL
SELECT 'policy', tablename || '.' || policyname
FROM pg_policies
WHERE schemaname = 'public' AND tablename IN ('consumable_items', 'consumable_movements')
ORDER BY 1, 2;
