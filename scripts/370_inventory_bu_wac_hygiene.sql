BEGIN;

CREATE OR REPLACE FUNCTION public.resolve_business_unit_for_inventory_mutation(
  p_tenant_id uuid,
  p_business_unit_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path = public, extensions, pg_temp
AS $function$
DECLARE
  v_bu_count integer;
BEGIN
  IF p_business_unit_id IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.business_units bu
      WHERE bu.id = p_business_unit_id AND bu.tenant_id = p_tenant_id
    ) THEN
      RAISE EXCEPTION 'Invalid business unit for this workspace.'
        USING ERRCODE = 'P0001';
    END IF;
    RETURN p_business_unit_id;
  END IF;

  SELECT count(*)::integer INTO v_bu_count
  FROM public.business_units bu
  WHERE bu.tenant_id = p_tenant_id;

  IF v_bu_count = 0 THEN
    RETURN NULL;
  END IF;

  IF v_bu_count = 1 THEN
    RETURN (
      SELECT bu.id FROM public.business_units bu
      WHERE bu.tenant_id = p_tenant_id
      LIMIT 1
    );
  END IF;

  RAISE EXCEPTION 'Choose a business before saving.'
    USING ERRCODE = 'P0001';
END;
$function$;

REVOKE ALL ON FUNCTION public.resolve_business_unit_for_inventory_mutation(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_business_unit_for_inventory_mutation(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.ensure_raw_material_balance(
  p_tenant_id uuid,
  p_material_id uuid,
  p_business_unit_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $function$
DECLARE
  v_bu uuid;
BEGIN
  v_bu := public.resolve_business_unit_for_inventory_mutation(p_tenant_id, p_business_unit_id);
  INSERT INTO public.raw_material_balances (
    tenant_id, material_id, business_unit_id,
    current_stock, average_cost_per_unit, reorder_level
  )
  VALUES (p_tenant_id, p_material_id, v_bu, 0, 0, NULL)
  ON CONFLICT ON CONSTRAINT raw_material_balances_tenant_material_bu_unique
  DO NOTHING;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ensure_finished_product_balance(
  p_tenant_id uuid,
  p_product_id uuid,
  p_business_unit_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $function$
DECLARE
  v_bu uuid;
BEGIN
  v_bu := public.resolve_business_unit_for_inventory_mutation(p_tenant_id, p_business_unit_id);
  INSERT INTO public.finished_product_balances (
    tenant_id, product_id, business_unit_id,
    current_stock, average_cost_per_unit
  )
  VALUES (p_tenant_id, p_product_id, v_bu, 0, 0)
  ON CONFLICT ON CONSTRAINT finished_product_balances_tenant_product_bu_unique
  DO NOTHING;
END;
$function$;

CREATE OR REPLACE FUNCTION public.finished_product_weighted_avg_cost_scoped(
  p_product_id uuid,
  p_business_unit_id uuid
)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public, extensions, pg_temp
AS $function$
  SELECT CASE
    WHEN p_business_unit_id IS NULL
      AND (
        SELECT count(*)::integer
        FROM public.business_units bu
        WHERE bu.tenant_id = (
          SELECT fp.tenant_id FROM public.finished_products fp WHERE fp.id = p_product_id
        )
      ) = 0
    THEN COALESCE(public.finished_product_weighted_avg_cost(p_product_id), 0)
    ELSE COALESCE(
      ROUND(
        GREATEST(
          (
            COALESCE((
              SELECT SUM(pb.total_batch_cost)
              FROM public.production_batches pb
              WHERE pb.finished_product_id = p_product_id
                AND pb.business_unit_id IS NOT DISTINCT FROM p_business_unit_id
            ), 0)
            + COALESCE((
              SELECT SUM(pp.total_cost)
              FROM public.product_purchases pp
              WHERE pp.product_id = p_product_id
                AND pp.business_unit_id IS NOT DISTINCT FROM p_business_unit_id
            ), 0)
            - COALESCE((
              SELECT SUM(e.amount)
              FROM public.income_register i
              JOIN public.expense_register e
                ON e.id = i.cogs_expense_id
                OR e.id = i.cogs_reversal_expense_id
              WHERE i.product_id = p_product_id
                AND i.entry_type = 'product_sale'
                AND i.business_unit_id IS NOT DISTINCT FROM p_business_unit_id
            ), 0)
            - COALESCE((
              SELECT SUM(e.amount)
              FROM public.internal_consumption ic
              JOIN public.expense_register e ON e.id = ic.expense_register_id
              WHERE ic.product_id = p_product_id
                AND ic.business_unit_id IS NOT DISTINCT FROM p_business_unit_id
            ), 0)
            + COALESCE((
              SELECT SUM(fsa.quantity_delta * fsa.cost_per_unit)
              FROM public.finished_product_stock_adjustments fsa
              WHERE fsa.product_id = p_product_id
                AND fsa.business_unit_id IS NOT DISTINCT FROM p_business_unit_id
            ), 0)
          ),
          0
        ) / NULLIF((
          SELECT fpb.current_stock
          FROM public.finished_product_balances fpb
          WHERE fpb.product_id = p_product_id
            AND fpb.business_unit_id IS NOT DISTINCT FROM p_business_unit_id
        ), 0),
        4
      ),
      0
    )
  END;
$function$;

REVOKE ALL ON FUNCTION public.finished_product_weighted_avg_cost_scoped(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finished_product_weighted_avg_cost_scoped(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.get_finished_product_average_costs_scoped(
  p_tenant_id uuid,
  p_business_unit_id uuid
)
RETURNS TABLE(product_id uuid, average_cost numeric)
LANGUAGE sql
STABLE
SET search_path = public, extensions, pg_temp
AS $function$
  SELECT
    fp.id AS product_id,
    CASE
      WHEN p_business_unit_id IS NULL
        AND (SELECT count(*)::integer FROM public.business_units bu WHERE bu.tenant_id = p_tenant_id) = 0
      THEN COALESCE(public.finished_product_weighted_avg_cost(fp.id), 0)
      ELSE COALESCE(
        public.finished_product_weighted_avg_cost_scoped(fp.id, p_business_unit_id),
        0
      )
    END AS average_cost
  FROM public.finished_products fp
  WHERE fp.tenant_id = p_tenant_id
    AND (
      EXISTS (
        SELECT 1 FROM public.production_batches pb
        WHERE pb.finished_product_id = fp.id
          AND pb.business_unit_id IS NOT DISTINCT FROM p_business_unit_id
      )
      OR EXISTS (
        SELECT 1 FROM public.product_purchases pp
        WHERE pp.product_id = fp.id
          AND pp.business_unit_id IS NOT DISTINCT FROM p_business_unit_id
      )
      OR EXISTS (
        SELECT 1 FROM public.finished_product_balances fpb
        WHERE fpb.product_id = fp.id
          AND fpb.tenant_id = p_tenant_id
          AND fpb.business_unit_id IS NOT DISTINCT FROM p_business_unit_id
          AND COALESCE(fpb.current_stock, 0) <> 0
      )
    );
$function$;

REVOKE ALL ON FUNCTION public.get_finished_product_average_costs_scoped(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_finished_product_average_costs_scoped(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.recalculate_raw_material_inventory_scoped(
  p_material_id uuid,
  p_business_unit_id uuid
)
RETURNS TABLE(current_stock numeric, average_cost_per_unit numeric)
LANGUAGE plpgsql
SET search_path = public, extensions, pg_temp
AS $function$
DECLARE
  v_tenant_id uuid;
  v_bu_count integer;
  v_purchased_qty numeric(18, 4) := 0;
  v_purchased_value numeric(18, 4) := 0;
  v_consumed_qty numeric(18, 4) := 0;
  v_new_stock numeric(18, 4) := 0;
  v_new_avg numeric(18, 4) := 0;
  v_purchase record;
BEGIN
  SELECT tenant_id
  INTO v_tenant_id
  FROM public.raw_materials
  WHERE id = p_material_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Raw material % not found', p_material_id;
  END IF;

  SELECT count(*)::integer INTO v_bu_count
  FROM public.business_units bu
  WHERE bu.tenant_id = v_tenant_id;

  IF v_bu_count = 0 AND p_business_unit_id IS NULL THEN
    SELECT
      COALESCE(rm.current_stock, 0),
      COALESCE(rm.average_cost_per_unit, 0)
    INTO v_new_stock, v_new_avg
    FROM public.raw_materials rm
    WHERE rm.id = p_material_id;

    PERFORM public.ensure_raw_material_balance(v_tenant_id, p_material_id, NULL);

    UPDATE public.raw_material_balances
    SET current_stock = v_new_stock,
        average_cost_per_unit = v_new_avg,
        updated_at = now()
    WHERE tenant_id = v_tenant_id
      AND material_id = p_material_id
      AND business_unit_id IS NULL;

    current_stock := v_new_stock;
    average_cost_per_unit := v_new_avg;
    RETURN NEXT;
    RETURN;
  END IF;

  FOR v_purchase IN
    SELECT quantity, cost_per_unit
    FROM public.raw_material_purchases
    WHERE material_id = p_material_id
      AND business_unit_id IS NOT DISTINCT FROM p_business_unit_id
    ORDER BY created_at, id
  LOOP
    v_purchased_qty := v_purchased_qty + v_purchase.quantity;
    v_purchased_value := v_purchased_value
      + ROUND(v_purchase.quantity * v_purchase.cost_per_unit, 4);
  END LOOP;

  SELECT COALESCE(SUM(pbm.quantity_used), 0)
  INTO v_consumed_qty
  FROM public.production_batch_materials pbm
  JOIN public.production_batches pb ON pb.id = pbm.batch_id
  WHERE pbm.material_id = p_material_id
    AND pb.business_unit_id IS NOT DISTINCT FROM p_business_unit_id;

  v_new_stock := v_purchased_qty - v_consumed_qty;

  IF v_purchased_qty > 0 THEN
    v_new_avg := ROUND(v_purchased_value / v_purchased_qty, 4);
  ELSE
    v_new_avg := 0;
  END IF;

  PERFORM public.ensure_raw_material_balance(
    v_tenant_id,
    p_material_id,
    p_business_unit_id
  );

  UPDATE public.raw_material_balances
  SET current_stock = v_new_stock,
      average_cost_per_unit = v_new_avg,
      updated_at = now()
  WHERE tenant_id = v_tenant_id
    AND material_id = p_material_id
    AND business_unit_id IS NOT DISTINCT FROM p_business_unit_id;

  current_stock := v_new_stock;
  average_cost_per_unit := v_new_avg;
  RETURN NEXT;
END;
$function$;

REVOKE ALL ON FUNCTION public.recalculate_raw_material_inventory_scoped(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recalculate_raw_material_inventory_scoped(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.recompute_finished_product_balance_wac_for_tenant(p_tenant_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $function$
DECLARE
  v_updated integer := 0;
BEGIN
  PERFORM public.assert_caller_can_act_for_tenant(p_tenant_id);
  UPDATE public.finished_product_balances fpb
  SET average_cost_per_unit = round(
    greatest(
      coalesce(
        public.finished_product_weighted_avg_cost_scoped(fpb.product_id, fpb.business_unit_id),
        0
      ),
      0
    ),
    4
  ),
  updated_at = now()
  WHERE fpb.tenant_id = p_tenant_id
    AND fpb.current_stock > 0
    AND abs(
      coalesce(fpb.average_cost_per_unit, 0)
      - coalesce(
        public.finished_product_weighted_avg_cost_scoped(fpb.product_id, fpb.business_unit_id),
        0
      )
    ) > 0.01;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated;
END;
$function$;

REVOKE ALL ON FUNCTION public.recompute_finished_product_balance_wac_for_tenant(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.recompute_finished_product_balance_wac_for_tenant(uuid) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
