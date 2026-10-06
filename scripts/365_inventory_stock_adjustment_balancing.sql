BEGIN;

CREATE TABLE IF NOT EXISTS public.inventory_stock_adjustment_register_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  source_kind text NOT NULL CHECK (source_kind IN ('finished', 'raw')),
  adjustment_id uuid NOT NULL,
  pl_kind text NOT NULL CHECK (pl_kind IN ('gain', 'loss')),
  income_register_id uuid NULL REFERENCES public.income_register(id) ON DELETE SET NULL,
  expense_register_id uuid NULL REFERENCES public.expense_register(id) ON DELETE SET NULL,
  amount numeric(18, 4) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT inventory_stock_adjustment_register_links_source_adj_unique
    UNIQUE (source_kind, adjustment_id)
);

CREATE INDEX IF NOT EXISTS idx_inv_stock_adj_register_links_tenant
  ON public.inventory_stock_adjustment_register_links (tenant_id);

ALTER TABLE public.inventory_stock_adjustment_register_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS inventory_stock_adjustment_register_links_tenant_select
  ON public.inventory_stock_adjustment_register_links;
CREATE POLICY inventory_stock_adjustment_register_links_tenant_select
  ON public.inventory_stock_adjustment_register_links FOR SELECT TO authenticated
  USING (tenant_matches(tenant_id));

GRANT SELECT ON public.inventory_stock_adjustment_register_links TO authenticated;
GRANT ALL ON public.inventory_stock_adjustment_register_links TO service_role;

DROP TRIGGER IF EXISTS trg_inventory_stock_adjustment_register_links_enforce_tenant_id
  ON public.inventory_stock_adjustment_register_links;
CREATE TRIGGER trg_inventory_stock_adjustment_register_links_enforce_tenant_id
  BEFORE INSERT OR UPDATE OF tenant_id ON public.inventory_stock_adjustment_register_links
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_row_tenant_id();

CREATE OR REPLACE FUNCTION public.reverse_inventory_stock_adjustment_register_link(
  p_tenant_id uuid,
  p_source_kind text,
  p_adjustment_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_link public.inventory_stock_adjustment_register_links%ROWTYPE;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'p_tenant_id is required';
  END IF;

  SELECT *
  INTO v_link
  FROM public.inventory_stock_adjustment_register_links
  WHERE tenant_id = p_tenant_id
    AND source_kind = p_source_kind
    AND adjustment_id = p_adjustment_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_link.income_register_id IS NOT NULL THEN
    DELETE FROM public.income_register
    WHERE id = v_link.income_register_id
      AND tenant_id = p_tenant_id;
  END IF;

  IF v_link.expense_register_id IS NOT NULL THEN
    DELETE FROM public.expense_register
    WHERE id = v_link.expense_register_id
      AND tenant_id = p_tenant_id;
  END IF;

  DELETE FROM public.inventory_stock_adjustment_register_links
  WHERE id = v_link.id
    AND tenant_id = p_tenant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.reverse_inventory_stock_adjustment_register_link(uuid, text, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reverse_inventory_stock_adjustment_register_link(uuid, text, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.reverse_inventory_stock_adjustment_register_link(uuid, text, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.post_inventory_stock_adjustment_register_link(
  p_tenant_id uuid,
  p_source_kind text,
  p_adjustment_id uuid,
  p_business_unit_id uuid,
  p_adjustment_type text,
  p_quantity_delta numeric,
  p_cost_per_unit numeric,
  p_effective_date date,
  p_item_label text
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_go_live date;
  v_type text := trim(coalesce(p_adjustment_type, ''));
  v_signed numeric(18, 4);
  v_amount numeric(18, 4);
  v_pl_kind text;
  v_income_id uuid;
  v_expense_id uuid;
  v_invoice text;
  v_receipt text;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'p_tenant_id is required';
  END IF;

  IF v_type = 'opening_balance' THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.inventory_stock_adjustment_register_links
    WHERE tenant_id = p_tenant_id
      AND source_kind = p_source_kind
      AND adjustment_id = p_adjustment_id
  ) THEN
    RETURN;
  END IF;

  SELECT go_live_date
  INTO v_go_live
  FROM public.inventory_balance_config
  WHERE tenant_id = p_tenant_id;

  IF v_go_live IS NULL OR p_effective_date < v_go_live THEN
    RETURN;
  END IF;

  v_signed := round(coalesce(p_quantity_delta, 0) * coalesce(p_cost_per_unit, 0), 4);
  IF v_signed = 0 THEN
    RETURN;
  END IF;

  IF v_signed > 0 THEN
    v_pl_kind := 'gain';
    v_amount := abs(v_signed);
  ELSE
    v_pl_kind := 'loss';
    v_amount := abs(v_signed);
  END IF;

  IF v_pl_kind = 'gain' THEN
    v_invoice := public.generate_next_code(p_tenant_id, 'INC', 4);
    INSERT INTO public.income_register (
      tenant_id,
      date,
      invoice_no,
      entry_type,
      service_category,
      description,
      amount,
      amount_received,
      outstanding_balance,
      payment_status,
      notes,
      business_unit_id
    )
    VALUES (
      p_tenant_id,
      p_effective_date,
      v_invoice,
      'service'::public.income_entry_type,
      'Other Income',
      'Inventory gain (stock adjustment)',
      v_amount,
      v_amount,
      0,
      'Non-Cash',
      format(
        'Linked to %s stock adjustment %s (%s)',
        p_source_kind,
        p_adjustment_id::text,
        coalesce(nullif(trim(p_item_label), ''), 'item')
      ),
      p_business_unit_id
    )
    RETURNING id INTO v_income_id;

    INSERT INTO public.inventory_stock_adjustment_register_links (
      tenant_id,
      source_kind,
      adjustment_id,
      pl_kind,
      income_register_id,
      amount
    )
    VALUES (
      p_tenant_id,
      p_source_kind,
      p_adjustment_id,
      v_pl_kind,
      v_income_id,
      v_amount
    );
    RETURN;
  END IF;

  v_receipt := 'STKADJ-' || upper(left(p_adjustment_id::text, 8));
  INSERT INTO public.expense_register (
    tenant_id,
    date,
    expense_category,
    sub_category,
    description,
    vendor,
    price,
    quantity,
    amount,
    payment_method,
    approved_by,
    receipt_no,
    payment_status,
    notes,
    business_unit_id
  )
  VALUES (
    p_tenant_id,
    p_effective_date,
    'Direct Operational',
    'Inventory loss',
    'Inventory loss (stock adjustment)',
    'Internal',
    coalesce(p_cost_per_unit, 0),
    abs(coalesce(p_quantity_delta, 0)),
    v_amount,
    'Internal',
    'System',
    v_receipt,
    'Non-Cash',
    format(
      'Linked to %s stock adjustment %s (%s)',
      p_source_kind,
      p_adjustment_id::text,
      coalesce(nullif(trim(p_item_label), ''), 'item')
    ),
    p_business_unit_id
  )
  RETURNING id INTO v_expense_id;

  INSERT INTO public.inventory_stock_adjustment_register_links (
    tenant_id,
    source_kind,
    adjustment_id,
    pl_kind,
    expense_register_id,
    amount
  )
  VALUES (
    p_tenant_id,
    p_source_kind,
    p_adjustment_id,
    v_pl_kind,
    v_expense_id,
    v_amount
  );
END;
$$;

REVOKE ALL ON FUNCTION public.post_inventory_stock_adjustment_register_link(uuid, text, uuid, uuid, text, numeric, numeric, date, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.post_inventory_stock_adjustment_register_link(uuid, text, uuid, uuid, text, numeric, numeric, date, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.post_inventory_stock_adjustment_register_link(uuid, text, uuid, uuid, text, numeric, numeric, date, text) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.repair_tenant_inventory_stock_adjustment_register_links(
  p_tenant_id uuid,
  p_dry_run boolean DEFAULT true
)
RETURNS TABLE (
  source_kind text,
  adjustment_id uuid,
  adjustment_type text,
  business_unit_id uuid,
  effective_date date,
  pl_kind text,
  amount numeric,
  item_label text,
  posted boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_row record;
  v_go_live date;
  v_signed numeric(18, 4);
  v_amount numeric(18, 4);
  v_pl_kind text;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'p_tenant_id is required';
  END IF;

  IF NOT coalesce(p_dry_run, true) THEN
    PERFORM public.assert_caller_can_act_for_tenant(p_tenant_id);
  END IF;

  SELECT go_live_date
  INTO v_go_live
  FROM public.inventory_balance_config
  WHERE tenant_id = p_tenant_id;

  FOR v_row IN
    SELECT
      'finished'::text AS source_kind,
      fsa.id AS adjustment_id,
      fsa.business_unit_id,
      fsa.adjustment_type,
      fsa.quantity_delta,
      fsa.cost_per_unit,
      (fsa.created_at AT TIME ZONE 'UTC')::date AS effective_date,
      coalesce(fp.product_code, fp.product_name, fsa.product_id::text) AS item_label
    FROM public.finished_product_stock_adjustments fsa
    JOIN public.finished_products fp ON fp.id = fsa.product_id
    WHERE fsa.tenant_id = p_tenant_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.inventory_stock_adjustment_register_links l
        WHERE l.tenant_id = p_tenant_id
          AND l.source_kind = 'finished'
          AND l.adjustment_id = fsa.id
      )
    UNION ALL
    SELECT
      'raw'::text,
      rsa.id,
      rsa.business_unit_id,
      rsa.adjustment_type,
      rsa.quantity_delta,
      rsa.cost_per_unit,
      (rsa.created_at AT TIME ZONE 'UTC')::date,
      coalesce(rm.material_code, rm.material_name, rsa.material_id::text)
    FROM public.raw_material_stock_adjustments rsa
    JOIN public.raw_materials rm ON rm.id = rsa.material_id
    WHERE rsa.tenant_id = p_tenant_id
      AND NOT EXISTS (
        SELECT 1
        FROM public.inventory_stock_adjustment_register_links l
        WHERE l.tenant_id = p_tenant_id
          AND l.source_kind = 'raw'
          AND l.adjustment_id = rsa.id
      )
  LOOP
    source_kind := v_row.source_kind;
    adjustment_id := v_row.adjustment_id;
    adjustment_type := v_row.adjustment_type;
    business_unit_id := v_row.business_unit_id;
    effective_date := v_row.effective_date;
    item_label := v_row.item_label;
    posted := false;
    pl_kind := 'none';
    amount := 0;

    IF trim(coalesce(v_row.adjustment_type, '')) = 'opening_balance' THEN
      CONTINUE;
    END IF;

    IF v_go_live IS NULL OR v_row.effective_date < v_go_live THEN
      CONTINUE;
    END IF;

    v_signed := round(
      coalesce(v_row.quantity_delta, 0) * coalesce(v_row.cost_per_unit, 0),
      4
    );
    IF v_signed = 0 THEN
      CONTINUE;
    END IF;

    IF v_signed > 0 THEN
      v_pl_kind := 'gain';
      v_amount := abs(v_signed);
    ELSE
      v_pl_kind := 'loss';
      v_amount := abs(v_signed);
    END IF;

    pl_kind := v_pl_kind;
    amount := v_amount;

    IF coalesce(p_dry_run, true) THEN
      RETURN NEXT;
      CONTINUE;
    END IF;

    PERFORM public.post_inventory_stock_adjustment_register_link(
      p_tenant_id,
      v_row.source_kind,
      v_row.adjustment_id,
      v_row.business_unit_id,
      v_row.adjustment_type,
      v_row.quantity_delta,
      v_row.cost_per_unit,
      v_row.effective_date,
      v_row.item_label
    );
    posted := true;
    RETURN NEXT;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.repair_tenant_inventory_stock_adjustment_register_links(uuid, boolean) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.repair_tenant_inventory_stock_adjustment_register_links(uuid, boolean) FROM anon;
REVOKE ALL ON FUNCTION public.repair_tenant_inventory_stock_adjustment_register_links(uuid, boolean) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.repair_tenant_inventory_stock_adjustment_register_links(uuid, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.trg_post_finished_product_stock_adjustment_register()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_label text;
BEGIN
  SELECT coalesce(product_code, product_name, id::text)
  INTO v_label
  FROM public.finished_products
  WHERE id = NEW.product_id;

  PERFORM public.post_inventory_stock_adjustment_register_link(
    NEW.tenant_id,
    'finished',
    NEW.id,
    NEW.business_unit_id,
    NEW.adjustment_type,
    NEW.quantity_delta,
    NEW.cost_per_unit,
    (NEW.created_at AT TIME ZONE 'UTC')::date,
    v_label
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS finished_product_stock_adjustments_post_register
  ON public.finished_product_stock_adjustments;
CREATE TRIGGER finished_product_stock_adjustments_post_register
  AFTER INSERT ON public.finished_product_stock_adjustments
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_post_finished_product_stock_adjustment_register();

CREATE OR REPLACE FUNCTION public.trg_reverse_finished_product_stock_adjustment_register()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  PERFORM public.reverse_inventory_stock_adjustment_register_link(
    OLD.tenant_id,
    'finished',
    OLD.id
  );
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS finished_product_stock_adjustments_reverse_register
  ON public.finished_product_stock_adjustments;
CREATE TRIGGER finished_product_stock_adjustments_reverse_register
  BEFORE DELETE ON public.finished_product_stock_adjustments
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_reverse_finished_product_stock_adjustment_register();

CREATE OR REPLACE FUNCTION public.trg_post_raw_material_stock_adjustment_register()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_label text;
BEGIN
  SELECT coalesce(material_code, material_name, id::text)
  INTO v_label
  FROM public.raw_materials
  WHERE id = NEW.material_id;

  PERFORM public.post_inventory_stock_adjustment_register_link(
    NEW.tenant_id,
    'raw',
    NEW.id,
    NEW.business_unit_id,
    NEW.adjustment_type,
    NEW.quantity_delta,
    NEW.cost_per_unit,
    (NEW.created_at AT TIME ZONE 'UTC')::date,
    v_label
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS raw_material_stock_adjustments_post_register
  ON public.raw_material_stock_adjustments;
CREATE TRIGGER raw_material_stock_adjustments_post_register
  AFTER INSERT ON public.raw_material_stock_adjustments
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_post_raw_material_stock_adjustment_register();

CREATE OR REPLACE FUNCTION public.trg_reverse_raw_material_stock_adjustment_register()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  PERFORM public.reverse_inventory_stock_adjustment_register_link(
    OLD.tenant_id,
    'raw',
    OLD.id
  );
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS raw_material_stock_adjustments_reverse_register
  ON public.raw_material_stock_adjustments;
CREATE TRIGGER raw_material_stock_adjustments_reverse_register
  BEFORE DELETE ON public.raw_material_stock_adjustments
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_reverse_raw_material_stock_adjustment_register();

COMMIT;

NOTIFY pgrst, 'reload schema';
