BEGIN;

ALTER TABLE public.production_batches
  ADD COLUMN IF NOT EXISTS remaining_quantity numeric(18, 4);

UPDATE public.production_batches
SET remaining_quantity = quantity_produced
WHERE remaining_quantity IS NULL;

CREATE OR REPLACE FUNCTION public.assert_inventory_month_open(
  p_tenant_id uuid,
  p_business_unit_id uuid,
  p_activity_date date
)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_status text;
  v_month date;
BEGIN
  IF p_activity_date IS NULL THEN
    RETURN;
  END IF;

  v_month := date_trunc('month', p_activity_date)::date;

  SELECT m.lock_status
  INTO v_status
  FROM public.month_end_close m
  WHERE m.tenant_id = p_tenant_id
    AND m.business_unit_id IS NOT DISTINCT FROM p_business_unit_id
    AND m.month = v_month
  LIMIT 1;

  IF v_status IN ('Locked', 'Partially Locked') THEN
    RAISE EXCEPTION
      'This month is closed in Month-End Close. Reopen the month before changing inventory for this date.';
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_inventory_month_open(uuid, uuid, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_inventory_month_open(uuid, uuid, date) FROM anon;
REVOKE ALL ON FUNCTION public.assert_inventory_month_open(uuid, uuid, date) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.assert_inventory_month_open(uuid, uuid, date) TO service_role;

CREATE OR REPLACE FUNCTION public.production_batch_consumed_stats(p_batch_id uuid)
RETURNS TABLE (
  consumed_quantity numeric,
  sale_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_batch public.production_batches%ROWTYPE;
  v_from_remaining numeric := 0;
  v_from_alloc numeric := 0;
  v_sales bigint := 0;
BEGIN
  SELECT *
  INTO v_batch
  FROM public.production_batches
  WHERE id = p_batch_id;

  IF NOT FOUND THEN
    consumed_quantity := 0;
    sale_count := 0;
    RETURN NEXT;
    RETURN;
  END IF;

  IF v_batch.remaining_quantity IS NOT NULL THEN
    v_from_remaining := GREATEST(
      0,
      v_batch.quantity_produced - v_batch.remaining_quantity
    );
  END IF;

  IF to_regclass('public.sale_batch_allocations') IS NOT NULL THEN
    SELECT
      GREATEST(0, COALESCE(SUM(sba.quantity_allocated), 0)),
      COUNT(DISTINCT sba.sale_id) FILTER (WHERE sba.quantity_allocated > 0)
    INTO v_from_alloc, v_sales
    FROM public.sale_batch_allocations sba
    WHERE sba.batch_source = 'production_batch'
      AND sba.batch_id = p_batch_id;
  END IF;

  consumed_quantity := GREATEST(v_from_remaining, v_from_alloc);
  sale_count := COALESCE(v_sales, 0);
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.production_batch_consumed_stats(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.production_batch_consumed_stats(uuid) TO authenticated, service_role;

-- Outbound finished-product stock ledger rows that block batch edit (excludes this batch's production_in).
CREATE OR REPLACE FUNCTION public.production_batch_stock_movement_is_outbound(
  p_movement_type public.stock_movement_type,
  p_notes text,
  p_reference_id uuid,
  p_batch_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  v_notes text := lower(coalesce(p_notes, ''));
  v_type text := p_movement_type::text;
BEGIN
  IF v_type = 'production_in' THEN
    IF p_reference_id IS NOT DISTINCT FROM p_batch_id THEN
      RETURN false;
    END IF;
    RETURN false;
  END IF;

  IF v_type = 'purchase_in' THEN
    RETURN false;
  END IF;

  IF v_type = 'sale_out' THEN
    RETURN true;
  END IF;

  IF v_type = 'internal_consumption_out' THEN
    RETURN true;
  END IF;

  IF v_type = 'return_writeoff' THEN
    RETURN true;
  END IF;

  IF v_type = 'adjustment' THEN
    IF v_notes LIKE '%reversal of voided sale%' THEN
      RETURN false;
    END IF;
    IF v_notes LIKE '%return (restocked)%' THEN
      RETURN false;
    END IF;
    RETURN true;
  END IF;

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.production_batch_outbound_usage_stats(p_batch_id uuid)
RETURNS TABLE (
  sale_count bigint,
  internal_use_count bigint,
  adjustment_down_count bigint,
  other_outbound_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_batch public.production_batches%ROWTYPE;
BEGIN
  SELECT *
  INTO v_batch
  FROM public.production_batches
  WHERE id = p_batch_id;

  IF NOT FOUND THEN
    sale_count := 0;
    internal_use_count := 0;
    adjustment_down_count := 0;
    other_outbound_count := 0;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE sm.movement_type::text = 'sale_out'),
    COUNT(*) FILTER (WHERE sm.movement_type::text = 'internal_consumption_out'),
    COUNT(*) FILTER (
      WHERE sm.movement_type::text = 'adjustment'
        AND public.production_batch_stock_movement_is_outbound(
          sm.movement_type,
          sm.notes,
          sm.reference_id,
          p_batch_id
        )
    ),
    COUNT(*) FILTER (
      WHERE sm.movement_type::text NOT IN ('sale_out', 'internal_consumption_out', 'adjustment')
        AND public.production_batch_stock_movement_is_outbound(
          sm.movement_type,
          sm.notes,
          sm.reference_id,
          p_batch_id
        )
    )
  INTO sale_count, internal_use_count, adjustment_down_count, other_outbound_count
  FROM public.stock_movements sm
  WHERE sm.product_id = v_batch.finished_product_id
    AND sm.tenant_id = v_batch.tenant_id
    AND sm.business_unit_id IS NOT DISTINCT FROM v_batch.business_unit_id
    AND sm.movement_date >= v_batch.production_date
    AND sm.created_at > v_batch.created_at
    AND public.production_batch_stock_movement_is_outbound(
      sm.movement_type,
      sm.notes,
      sm.reference_id,
      p_batch_id
    );

  IF to_regclass('public.finished_product_stock_adjustments') IS NOT NULL THEN
    adjustment_down_count := adjustment_down_count + (
      SELECT COUNT(*)::bigint
      FROM public.finished_product_stock_adjustments fsa
      WHERE fsa.product_id = v_batch.finished_product_id
        AND fsa.tenant_id = v_batch.tenant_id
        AND fsa.business_unit_id IS NOT DISTINCT FROM v_batch.business_unit_id
        AND fsa.created_at > v_batch.created_at
        AND fsa.created_at::date >= v_batch.production_date
        AND fsa.quantity_delta < 0
    );
  END IF;

  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.production_batch_outbound_usage_stats(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.production_batch_outbound_usage_stats(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.production_batch_edit_block_reason(p_batch_id uuid)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_batch public.production_batches%ROWTYPE;
  v_stats record;
  v_usage record;
  v_product_name text;
  v_parts text[] := ARRAY[]::text[];
  v_detail text;
  v_date_label text;
BEGIN
  SELECT *
  INTO v_batch
  FROM public.production_batches
  WHERE id = p_batch_id;

  IF NOT FOUND THEN
    RETURN 'Production batch not found.';
  END IF;

  SELECT fp.product_name
  INTO v_product_name
  FROM public.finished_products fp
  WHERE fp.id = v_batch.finished_product_id;

  v_product_name := COALESCE(NULLIF(trim(v_product_name), ''), 'This product');

  SELECT *
  INTO v_stats
  FROM public.production_batch_consumed_stats(p_batch_id);

  SELECT *
  INTO v_usage
  FROM public.production_batch_outbound_usage_stats(p_batch_id);

  IF COALESCE(v_usage.sale_count, 0) > 0 THEN
    v_parts := v_parts || (
      CASE
        WHEN v_usage.sale_count = 1 THEN '1 sale'
        ELSE v_usage.sale_count::text || ' sales'
      END
    );
  END IF;

  IF COALESCE(v_usage.internal_use_count, 0) > 0 THEN
    v_parts := v_parts || (
      CASE
        WHEN v_usage.internal_use_count = 1 THEN '1 internal use'
        ELSE v_usage.internal_use_count::text || ' internal uses'
      END
    );
  END IF;

  IF COALESCE(v_usage.adjustment_down_count, 0) > 0 THEN
    v_parts := v_parts || (
      CASE
        WHEN v_usage.adjustment_down_count = 1 THEN '1 stock adjustment down'
        ELSE v_usage.adjustment_down_count::text || ' stock adjustments down'
      END
    );
  END IF;

  IF COALESCE(v_usage.other_outbound_count, 0) > 0 THEN
    v_parts := v_parts || (
      CASE
        WHEN v_usage.other_outbound_count = 1 THEN '1 other stock movement out'
        ELSE v_usage.other_outbound_count::text || ' other stock movements out'
      END
    );
  END IF;

  v_date_label := to_char(v_batch.production_date, 'FMDD Mon YYYY');

  IF cardinality(v_parts) > 0 THEN
    v_detail := array_to_string(v_parts, ', ');
    RETURN format(
      'This batch can''t be edited because %s stock has been used since it was produced (%s on or after %s).',
      v_product_name,
      v_detail,
      v_date_label
    );
  END IF;

  IF COALESCE(v_stats.consumed_quantity, 0) > 0 THEN
    v_detail := CASE
      WHEN COALESCE(v_stats.sale_count, 0) = 1 THEN '1 sale'
      WHEN COALESCE(v_stats.sale_count, 0) > 1 THEN v_stats.sale_count::text || ' sales'
      ELSE trim(trailing '.' from trim(trailing '0' from v_stats.consumed_quantity::text)) || ' units allocated from this batch'
    END;
    RETURN format(
      'This batch can''t be edited because %s stock has been used since it was produced (%s on or after %s).',
      v_product_name,
      v_detail,
      v_date_label
    );
  END IF;

  RETURN NULL;
END;
$$;

REVOKE ALL ON FUNCTION public.production_batch_edit_block_reason(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.production_batch_edit_block_reason(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.assert_production_batch_editable(p_batch_id uuid)
RETURNS void
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_reason text;
BEGIN
  v_reason := public.production_batch_edit_block_reason(p_batch_id);
  IF v_reason IS NOT NULL THEN
    RAISE EXCEPTION '%', v_reason;
  END IF;
END;
$$;

REVOKE ALL ON FUNCTION public.assert_production_batch_editable(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.assert_production_batch_editable(uuid) FROM anon;
REVOKE ALL ON FUNCTION public.assert_production_batch_editable(uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.assert_production_batch_editable(uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.preview_production_batch_edit(p_batch_id uuid)
RETURNS TABLE (
  can_edit boolean,
  block_reason text,
  consumed_quantity numeric,
  sale_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_batch public.production_batches%ROWTYPE;
  v_stats record;
  v_usage record;
  v_block text;
BEGIN
  SELECT *
  INTO v_batch
  FROM public.production_batches
  WHERE id = p_batch_id
    AND tenant_id = public.current_user_tenant_id();

  IF NOT FOUND THEN
    can_edit := false;
    block_reason := 'Production batch not found.';
    consumed_quantity := 0;
    sale_count := 0;
    RETURN NEXT;
    RETURN;
  END IF;

  SELECT *
  INTO v_stats
  FROM public.production_batch_consumed_stats(p_batch_id);

  SELECT *
  INTO v_usage
  FROM public.production_batch_outbound_usage_stats(p_batch_id);

  consumed_quantity := COALESCE(v_stats.consumed_quantity, 0);
  sale_count := COALESCE(v_usage.sale_count, v_stats.sale_count, 0);

  v_block := public.production_batch_edit_block_reason(p_batch_id);

  IF v_block IS NOT NULL THEN
    can_edit := false;
    block_reason := v_block;
    RETURN NEXT;
    RETURN;
  END IF;

  can_edit := true;
  block_reason := NULL;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.preview_production_batch_edit(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.preview_production_batch_edit(uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.update_production_batch(
  p_tenant_id uuid,
  p_batch_id uuid,
  p_production_date date,
  p_finished_product_id uuid,
  p_quantity_produced numeric,
  p_notes text,
  p_materials jsonb,
  p_manufacturing_date date DEFAULT NULL,
  p_expiration_date date DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_batch public.production_batches%ROWTYPE;
  v_material jsonb;
  v_material_id uuid;
  v_quantity_used numeric(18, 4);
  v_cost_at_time numeric(18, 4);
  v_bu_material_stock numeric(18, 4);
  v_total_batch_cost numeric(18, 4) := 0;
  v_cost_per_unit numeric(18, 4);
  v_material_tenant_id uuid;
  v_product_tenant_id uuid;
  v_material_ids uuid[];
  v_material_id_loop uuid;
  v_material_name text;
BEGIN
  PERFORM public.assert_caller_can_act_for_tenant(p_tenant_id);

  SELECT *
  INTO v_batch
  FROM public.production_batches
  WHERE id = p_batch_id
    AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Production batch not found.';
  END IF;

  PERFORM public.assert_production_batch_editable(p_batch_id);

  PERFORM public.assert_inventory_month_open(
    p_tenant_id,
    v_batch.business_unit_id,
    v_batch.production_date
  );
  PERFORM public.assert_inventory_month_open(
    p_tenant_id,
    v_batch.business_unit_id,
    p_production_date
  );

  IF p_quantity_produced IS NULL OR p_quantity_produced <= 0 THEN
    RAISE EXCEPTION 'Quantity produced must be greater than zero.';
  END IF;

  IF p_materials IS NULL OR jsonb_array_length(p_materials) = 0 THEN
    RAISE EXCEPTION 'At least one raw material is required for a production batch.';
  END IF;

  SELECT tenant_id
  INTO v_product_tenant_id
  FROM public.finished_products
  WHERE id = p_finished_product_id;

  IF NOT FOUND OR v_product_tenant_id IS DISTINCT FROM p_tenant_id THEN
    RAISE EXCEPTION 'Finished product not found.';
  END IF;

  FOR v_material IN SELECT value FROM jsonb_array_elements(p_materials)
  LOOP
    v_material_id := (v_material ->> 'material_id')::uuid;
    v_quantity_used := (v_material ->> 'quantity_used')::numeric(18, 4);

    IF v_material_id IS NULL OR v_quantity_used IS NULL OR v_quantity_used <= 0 THEN
      RAISE EXCEPTION 'Each material line requires a material and quantity greater than zero.';
    END IF;

    SELECT rm.tenant_id, rm.material_name
    INTO v_material_tenant_id, v_material_name
    FROM public.raw_materials rm
    WHERE rm.id = v_material_id
    FOR UPDATE;

    IF NOT FOUND OR v_material_tenant_id IS DISTINCT FROM p_tenant_id THEN
      RAISE EXCEPTION 'Raw material not found.';
    END IF;

    PERFORM public.ensure_raw_material_balance(
      v_material_tenant_id,
      v_material_id,
      v_batch.business_unit_id
    );

    SELECT rmb.current_stock, rmb.average_cost_per_unit
    INTO v_bu_material_stock, v_cost_at_time
    FROM public.raw_material_balances rmb
    WHERE rmb.material_id = v_material_id
      AND rmb.business_unit_id IS NOT DISTINCT FROM v_batch.business_unit_id
    FOR UPDATE;

    IF v_bu_material_stock < v_quantity_used THEN
      RAISE EXCEPTION
        'Insufficient stock for %. Available: %, required: %.',
        v_material_name,
        trim(trailing '.' from trim(trailing '0' from v_bu_material_stock::text)),
        trim(trailing '.' from trim(trailing '0' from v_quantity_used::text));
    END IF;

    v_total_batch_cost := v_total_batch_cost + round(v_quantity_used * v_cost_at_time, 4);
  END LOOP;

  v_cost_per_unit := round(v_total_batch_cost / p_quantity_produced, 4);

  SELECT coalesce(array_agg(DISTINCT material_id), array[]::uuid[])
  INTO v_material_ids
  FROM public.production_batch_materials
  WHERE batch_id = v_batch.id;

  DELETE FROM public.stock_movements
  WHERE reference_id = v_batch.id
    AND movement_type = 'production_in';

  UPDATE public.finished_products
  SET
    current_stock = current_stock - v_batch.quantity_produced,
    updated_at = now()
  WHERE id = v_batch.finished_product_id
    AND tenant_id = p_tenant_id;

  PERFORM public.adjust_finished_product_balance_qty(
    p_tenant_id,
    v_batch.finished_product_id,
    v_batch.business_unit_id,
    -v_batch.quantity_produced
  );

  DELETE FROM public.production_batch_materials
  WHERE batch_id = v_batch.id;

  IF v_material_ids IS NOT NULL THEN
    FOREACH v_material_id_loop IN ARRAY v_material_ids
    LOOP
      PERFORM public.recalculate_raw_material_inventory(v_material_id_loop);
      PERFORM public.recalculate_raw_material_inventory_scoped(
        v_material_id_loop,
        v_batch.business_unit_id
      );
    END LOOP;
  END IF;

  UPDATE public.production_batches
  SET
    production_date = p_production_date,
    finished_product_id = p_finished_product_id,
    quantity_produced = p_quantity_produced,
    cost_per_unit_produced = v_cost_per_unit,
    total_batch_cost = v_total_batch_cost,
    notes = NULLIF(trim(p_notes), ''),
    manufacturing_date = p_manufacturing_date,
    expiration_date = p_expiration_date,
    remaining_quantity = p_quantity_produced
  WHERE id = p_batch_id
    AND tenant_id = p_tenant_id;

  FOR v_material IN SELECT value FROM jsonb_array_elements(p_materials)
  LOOP
    v_material_id := (v_material ->> 'material_id')::uuid;
    v_quantity_used := (v_material ->> 'quantity_used')::numeric(18, 4);

    SELECT rm.tenant_id
    INTO v_material_tenant_id
    FROM public.raw_materials rm
    WHERE rm.id = v_material_id;

    SELECT rmb.average_cost_per_unit
    INTO v_cost_at_time
    FROM public.raw_material_balances rmb
    WHERE rmb.material_id = v_material_id
      AND rmb.business_unit_id IS NOT DISTINCT FROM v_batch.business_unit_id;

    INSERT INTO public.production_batch_materials (
      batch_id, material_id, quantity_used, cost_at_time
    )
    VALUES (v_batch.id, v_material_id, v_quantity_used, v_cost_at_time);

    UPDATE public.raw_materials
    SET current_stock = current_stock - v_quantity_used, updated_at = now()
    WHERE id = v_material_id;

    PERFORM public.adjust_raw_material_balance_qty(
      v_material_tenant_id,
      v_material_id,
      v_batch.business_unit_id,
      -v_quantity_used
    );
  END LOOP;

  UPDATE public.finished_products
  SET current_stock = current_stock + p_quantity_produced, updated_at = now()
  WHERE id = p_finished_product_id
    AND tenant_id = p_tenant_id;

  PERFORM public.adjust_finished_product_balance_qty(
    p_tenant_id,
    p_finished_product_id,
    v_batch.business_unit_id,
    p_quantity_produced
  );

  INSERT INTO public.stock_movements (
    tenant_id,
    product_id,
    movement_type,
    quantity,
    reference_id,
    movement_date,
    notes,
    business_unit_id
  )
  VALUES (
    p_tenant_id,
    p_finished_product_id,
    'production_in',
    p_quantity_produced,
    v_batch.id,
    p_production_date,
    coalesce(NULLIF(trim(p_notes), ''), 'Production batch ' || v_batch.batch_number),
    v_batch.business_unit_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.update_production_batch(uuid, uuid, date, uuid, numeric, text, jsonb, date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_production_batch(uuid, uuid, date, uuid, numeric, text, jsonb, date, date) FROM anon;
REVOKE ALL ON FUNCTION public.update_production_batch(uuid, uuid, date, uuid, numeric, text, jsonb, date, date) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.update_production_batch(uuid, uuid, date, uuid, numeric, text, jsonb, date, date) TO service_role;

CREATE OR REPLACE FUNCTION public.delete_internal_consumption_entry(
  p_tenant_id uuid,
  p_entry_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_row public.internal_consumption%ROWTYPE;
BEGIN
  PERFORM public.assert_caller_can_act_for_tenant(p_tenant_id);

  SELECT *
  INTO v_row
  FROM public.internal_consumption
  WHERE id = p_entry_id
    AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Internal consumption entry not found.';
  END IF;

  PERFORM public.assert_inventory_month_open(
    p_tenant_id,
    v_row.business_unit_id,
    v_row.consumption_date
  );

  DELETE FROM public.stock_movements
  WHERE reference_id = v_row.id
    AND movement_type = 'internal_consumption_out';

  UPDATE public.finished_products
  SET
    current_stock = current_stock + v_row.quantity,
    updated_at = now()
  WHERE id = v_row.product_id
    AND tenant_id = p_tenant_id;

  PERFORM public.adjust_finished_product_balance_qty(
    p_tenant_id,
    v_row.product_id,
    v_row.business_unit_id,
    v_row.quantity
  );

  IF v_row.expense_register_id IS NOT NULL THEN
    DELETE FROM public.expense_register
    WHERE id = v_row.expense_register_id
      AND tenant_id = p_tenant_id;
  END IF;

  DELETE FROM public.internal_consumption
  WHERE id = p_entry_id
    AND tenant_id = p_tenant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.delete_internal_consumption_entry(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_internal_consumption_entry(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public.delete_internal_consumption_entry(uuid, uuid) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.delete_internal_consumption_entry(uuid, uuid) TO service_role;

CREATE OR REPLACE FUNCTION public.update_internal_consumption_entry(
  p_tenant_id uuid,
  p_entry_id uuid,
  p_consumption_date date,
  p_product_id uuid,
  p_quantity numeric,
  p_reason text,
  p_notes text,
  p_site_id text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_old public.internal_consumption%ROWTYPE;
  v_go_live date;
  v_product_name text;
  v_unit_of_measure text;
  v_unit_cost numeric(18, 4);
  v_expense_amount numeric(18, 4);
  v_expense_id uuid;
  v_bu_stock numeric(18, 4);
BEGIN
  PERFORM public.assert_caller_can_act_for_tenant(p_tenant_id);

  SELECT *
  INTO v_old
  FROM public.internal_consumption
  WHERE id = p_entry_id
    AND tenant_id = p_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Internal consumption entry not found.';
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than zero.';
  END IF;

  PERFORM public.assert_inventory_month_open(
    p_tenant_id,
    v_old.business_unit_id,
    v_old.consumption_date
  );
  PERFORM public.assert_inventory_month_open(
    p_tenant_id,
    v_old.business_unit_id,
    p_consumption_date
  );

  DELETE FROM public.stock_movements
  WHERE reference_id = v_old.id
    AND movement_type = 'internal_consumption_out';

  UPDATE public.finished_products
  SET
    current_stock = current_stock + v_old.quantity,
    updated_at = now()
  WHERE id = v_old.product_id
    AND tenant_id = p_tenant_id;

  PERFORM public.adjust_finished_product_balance_qty(
    p_tenant_id,
    v_old.product_id,
    v_old.business_unit_id,
    v_old.quantity
  );

  IF v_old.expense_register_id IS NOT NULL THEN
    DELETE FROM public.expense_register
    WHERE id = v_old.expense_register_id
      AND tenant_id = p_tenant_id;
  END IF;

  UPDATE public.internal_consumption
  SET
    consumption_date = p_consumption_date,
    product_id = p_product_id,
    quantity = p_quantity,
    reason = NULLIF(trim(p_reason), ''),
    notes = NULLIF(trim(p_notes), ''),
    site_id = p_site_id,
    expense_register_id = NULL
  WHERE id = p_entry_id
    AND tenant_id = p_tenant_id;

  SELECT go_live_date
  INTO v_go_live
  FROM public.inventory_balance_config
  WHERE tenant_id = p_tenant_id;

  SELECT product_name, unit_of_measure
  INTO v_product_name, v_unit_of_measure
  FROM public.finished_products
  WHERE id = p_product_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Finished product not found.';
  END IF;

  v_unit_cost := 0;
  v_expense_amount := 0;
  IF v_go_live IS NOT NULL AND p_consumption_date >= v_go_live THEN
    v_unit_cost := public.finished_product_weighted_avg_cost_scoped(
      p_product_id,
      v_old.business_unit_id
    );
    v_expense_amount := round(p_quantity * v_unit_cost, 4);
  END IF;

  PERFORM public.ensure_finished_product_balance(
    p_tenant_id,
    p_product_id,
    v_old.business_unit_id
  );

  SELECT current_stock
  INTO v_bu_stock
  FROM public.finished_product_balances
  WHERE product_id = p_product_id
    AND business_unit_id IS NOT DISTINCT FROM v_old.business_unit_id
  FOR UPDATE;

  IF v_bu_stock < p_quantity THEN
    RAISE EXCEPTION
      'Only % % of % in stock, cannot consume %.',
      trim(trailing '.' from trim(trailing '0' from v_bu_stock::text)),
      v_unit_of_measure,
      v_product_name,
      trim(trailing '.' from trim(trailing '0' from p_quantity::text));
  END IF;

  UPDATE public.finished_products
  SET
    current_stock = current_stock - p_quantity,
    updated_at = now()
  WHERE id = p_product_id
    AND tenant_id = p_tenant_id;

  PERFORM public.adjust_finished_product_balance_qty(
    p_tenant_id,
    p_product_id,
    v_old.business_unit_id,
    -p_quantity
  );

  INSERT INTO public.stock_movements (
    tenant_id,
    product_id,
    movement_type,
    quantity,
    reference_id,
    movement_date,
    notes,
    business_unit_id
  )
  VALUES (
    p_tenant_id,
    p_product_id,
    'internal_consumption_out',
    p_quantity,
    p_entry_id,
    p_consumption_date,
    coalesce(
      NULLIF(trim(p_notes), ''),
      NULLIF(trim(p_reason), ''),
      'Internal consumption'
    ),
    v_old.business_unit_id
  );

  IF v_go_live IS NULL OR p_consumption_date < v_go_live THEN
    RETURN;
  END IF;

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
    p_consumption_date,
    'Direct Operational',
    'Finished Goods - Internal Use',
    'Auto-posted internal consumption of ' || v_product_name,
    'Internal',
    v_unit_cost,
    p_quantity,
    v_expense_amount,
    'Internal',
    'System',
    'IC-' || left(p_entry_id::text, 8),
    'Non-Cash',
    'Linked to internal_consumption ' || p_entry_id::text,
    v_old.business_unit_id
  )
  RETURNING id INTO v_expense_id;

  UPDATE public.internal_consumption
  SET expense_register_id = v_expense_id
  WHERE id = p_entry_id
    AND tenant_id = p_tenant_id;
END;
$$;

REVOKE ALL ON FUNCTION public.update_internal_consumption_entry(uuid, uuid, date, uuid, numeric, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_internal_consumption_entry(uuid, uuid, date, uuid, numeric, text, text, text) FROM anon;
REVOKE ALL ON FUNCTION public.update_internal_consumption_entry(uuid, uuid, date, uuid, numeric, text, text, text) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.update_internal_consumption_entry(uuid, uuid, date, uuid, numeric, text, text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.create_production_batch(
  p_batch_number text,
  p_production_date date,
  p_finished_product_id uuid,
  p_quantity_produced numeric,
  p_notes text,
  p_materials jsonb,
  p_manufacturing_date date DEFAULT NULL,
  p_expiration_date date DEFAULT NULL,
  p_business_unit_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
AS $function$
DECLARE
  v_batch_id uuid;
  v_material jsonb;
  v_material_id uuid;
  v_quantity_used numeric(18, 4);
  v_cost_at_time numeric(18, 4);
  v_bu_material_stock numeric(18, 4);
  v_total_batch_cost numeric(18, 4) := 0;
  v_cost_per_unit numeric(18, 4);
  v_material_tenant_id uuid;
  v_product_tenant_id uuid;
BEGIN
  PERFORM public.assert_not_view_all_business_units();
  IF p_quantity_produced IS NULL OR p_quantity_produced <= 0 THEN
    RAISE EXCEPTION 'quantity_produced must be greater than zero';
  END IF;

  IF p_materials IS NULL OR jsonb_array_length(p_materials) = 0 THEN
    RAISE EXCEPTION 'At least one raw material is required for a production batch';
  END IF;

  SELECT tenant_id INTO v_product_tenant_id
  FROM finished_products
  WHERE id = p_finished_product_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Finished product not found';
  END IF;

  FOR v_material IN SELECT value FROM jsonb_array_elements(p_materials)
  LOOP
    v_material_id := (v_material ->> 'material_id')::uuid;
    v_quantity_used := (v_material ->> 'quantity_used')::numeric(18, 4);

    IF v_material_id IS NULL OR v_quantity_used IS NULL OR v_quantity_used <= 0 THEN
      RAISE EXCEPTION 'Each material line requires material_id and quantity_used > 0';
    END IF;

    SELECT tenant_id
    INTO v_material_tenant_id
    FROM raw_materials
    WHERE id = v_material_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Raw material % not found', v_material_id;
    END IF;

    PERFORM public.ensure_raw_material_balance(
      v_material_tenant_id,
      v_material_id,
      p_business_unit_id
    );

    SELECT current_stock, average_cost_per_unit
    INTO v_bu_material_stock, v_cost_at_time
    FROM raw_material_balances
    WHERE material_id = v_material_id
      AND business_unit_id IS NOT DISTINCT FROM p_business_unit_id
    FOR UPDATE;

    IF v_bu_material_stock < v_quantity_used THEN
      RAISE EXCEPTION 'Insufficient stock for material %. Available: %, required: %',
        v_material_id, v_bu_material_stock, v_quantity_used;
    END IF;

    v_total_batch_cost := v_total_batch_cost + round(v_quantity_used * v_cost_at_time, 4);
  END LOOP;

  v_cost_per_unit := round(v_total_batch_cost / p_quantity_produced, 4);

  INSERT INTO production_batches (
    batch_number,
    production_date,
    finished_product_id,
    quantity_produced,
    cost_per_unit_produced,
    total_batch_cost,
    notes,
    manufacturing_date,
    expiration_date,
    business_unit_id,
    remaining_quantity
  )
  VALUES (
    p_batch_number,
    p_production_date,
    p_finished_product_id,
    p_quantity_produced,
    v_cost_per_unit,
    v_total_batch_cost,
    p_notes,
    p_manufacturing_date,
    p_expiration_date,
    p_business_unit_id,
    p_quantity_produced
  )
  RETURNING id INTO v_batch_id;

  FOR v_material IN SELECT value FROM jsonb_array_elements(p_materials)
  LOOP
    v_material_id := (v_material ->> 'material_id')::uuid;
    v_quantity_used := (v_material ->> 'quantity_used')::numeric(18, 4);

    SELECT tenant_id
    INTO v_material_tenant_id
    FROM raw_materials
    WHERE id = v_material_id;

    SELECT average_cost_per_unit
    INTO v_cost_at_time
    FROM raw_material_balances
    WHERE material_id = v_material_id
      AND business_unit_id IS NOT DISTINCT FROM p_business_unit_id;

    INSERT INTO production_batch_materials (
      batch_id, material_id, quantity_used, cost_at_time
    )
    VALUES (v_batch_id, v_material_id, v_quantity_used, v_cost_at_time);

    UPDATE raw_materials
    SET current_stock = current_stock - v_quantity_used, updated_at = now()
    WHERE id = v_material_id;

    PERFORM public.adjust_raw_material_balance_qty(
      v_material_tenant_id,
      v_material_id,
      p_business_unit_id,
      -v_quantity_used
    );
  END LOOP;

  UPDATE finished_products
  SET current_stock = current_stock + p_quantity_produced, updated_at = now()
  WHERE id = p_finished_product_id;

  PERFORM public.adjust_finished_product_balance_qty(
    v_product_tenant_id,
    p_finished_product_id,
    p_business_unit_id,
    p_quantity_produced
  );

  INSERT INTO stock_movements (
    product_id, movement_type, quantity, reference_id, movement_date, notes,
    business_unit_id
  )
  VALUES (
    p_finished_product_id,
    'production_in',
    p_quantity_produced,
    v_batch_id,
    p_production_date,
    coalesce(p_notes, 'Production batch ' || p_batch_number),
    p_business_unit_id
  );

  RETURN v_batch_id;
END;
$function$;

NOTIFY pgrst, 'reload schema';

COMMIT;
