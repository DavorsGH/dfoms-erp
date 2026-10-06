BEGIN;

CREATE OR REPLACE FUNCTION public.record_raw_material_manual_adjustment(
  p_tenant_id uuid,
  p_material_id uuid,
  p_business_unit_id uuid,
  p_adjustment_type text,
  p_quantity_delta numeric,
  p_cost_per_unit numeric,
  p_reason text,
  p_notes text,
  p_created_by uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
AS $function$
DECLARE
  v_id uuid;
  v_reason text := trim(COALESCE(p_reason, ''));
  v_type text := trim(COALESCE(p_adjustment_type, ''));
  v_total_cost numeric(18,4);
  v_resolved_cost numeric(18,4);
  v_old_stock numeric(18,4);
  v_old_avg numeric(18,4);
  v_old_value numeric(18,4);
  v_new_stock numeric(18,4);
  v_new_value numeric(18,4);
  v_new_avg numeric(18,4);
BEGIN
  PERFORM public.assert_not_view_all_business_units();

  IF p_tenant_id IS NULL OR p_material_id IS NULL THEN
    RAISE EXCEPTION 'tenant_id and material_id are required';
  END IF;

  IF v_type NOT IN (
    'opening_balance',
    'correction',
    'found_stock',
    'write_off'
  ) THEN
    RAISE EXCEPTION 'Invalid adjustment_type: %', p_adjustment_type;
  END IF;

  IF p_quantity_delta IS NULL OR p_quantity_delta = 0 THEN
    RAISE EXCEPTION 'quantity_delta must be a non-zero number';
  END IF;

  IF v_type IN ('opening_balance', 'found_stock') AND p_quantity_delta <= 0 THEN
    RAISE EXCEPTION
      '% requires a positive quantity_delta (got %)',
      v_type,
      p_quantity_delta;
  END IF;

  IF v_type = 'write_off' AND p_quantity_delta >= 0 THEN
    RAISE EXCEPTION
      'write_off requires a negative quantity_delta (got %)',
      p_quantity_delta;
  END IF;

  IF length(v_reason) = 0 THEN
    RAISE EXCEPTION 'reason is required';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.raw_materials
    WHERE id = p_material_id
      AND tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'Raw material % not found for tenant %',
      p_material_id, p_tenant_id;
  END IF;

  IF v_type IN ('opening_balance', 'found_stock') THEN
    IF p_cost_per_unit IS NULL THEN
      RAISE EXCEPTION '% requires cost_per_unit', v_type;
    END IF;
    v_resolved_cost := p_cost_per_unit;
    v_total_cost := ROUND(p_quantity_delta * p_cost_per_unit, 4);

    PERFORM public.apply_raw_material_balance_purchase(
      p_tenant_id,
      p_material_id,
      p_business_unit_id,
      p_quantity_delta,
      v_total_cost
    );

    SELECT current_stock, average_cost_per_unit
    INTO v_old_stock, v_old_avg
    FROM public.raw_materials
    WHERE id = p_material_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Raw material % not found for purchase', p_material_id;
    END IF;

    v_old_value := ROUND(v_old_stock * v_old_avg, 4);
    v_new_stock := v_old_stock + p_quantity_delta;
    v_new_value := v_old_value + v_total_cost;
    IF v_new_stock <= 0 THEN
      v_new_avg := 0;
    ELSE
      v_new_avg := ROUND(v_new_value / v_new_stock, 4);
    END IF;

    UPDATE public.raw_materials
    SET current_stock = v_new_stock,
        average_cost_per_unit = v_new_avg,
        updated_at = now()
    WHERE id = p_material_id;
  ELSE
    PERFORM public.ensure_raw_material_balance(
      p_tenant_id,
      p_material_id,
      p_business_unit_id
    );

    SELECT average_cost_per_unit
    INTO v_resolved_cost
    FROM public.raw_material_balances
    WHERE tenant_id = p_tenant_id
      AND material_id = p_material_id
      AND business_unit_id IS NOT DISTINCT FROM p_business_unit_id;

    IF v_resolved_cost IS NULL THEN
      SELECT average_cost_per_unit
      INTO v_resolved_cost
      FROM public.raw_materials
      WHERE id = p_material_id;
    END IF;

    v_resolved_cost := coalesce(v_resolved_cost, 0);

    PERFORM public.adjust_raw_material_balance_qty(
      p_tenant_id,
      p_material_id,
      p_business_unit_id,
      p_quantity_delta
    );

    UPDATE public.raw_materials
    SET current_stock = current_stock + p_quantity_delta,
        updated_at = now()
    WHERE id = p_material_id
      AND tenant_id = p_tenant_id;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Failed to update raw_materials.current_stock for material %',
        p_material_id;
    END IF;
  END IF;

  INSERT INTO public.raw_material_stock_adjustments (
    tenant_id,
    material_id,
    business_unit_id,
    adjustment_type,
    quantity_delta,
    cost_per_unit,
    reason,
    notes,
    created_by
  )
  VALUES (
    p_tenant_id,
    p_material_id,
    p_business_unit_id,
    v_type,
    p_quantity_delta,
    v_resolved_cost,
    v_reason,
    NULLIF(trim(COALESCE(p_notes, '')), ''),
    p_created_by
  )
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.record_raw_material_manual_adjustment(
  uuid, uuid, uuid, text, numeric, numeric, text, text, uuid
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.record_raw_material_manual_adjustment(
  uuid, uuid, uuid, text, numeric, numeric, text, text, uuid
) TO authenticated, service_role;

ALTER FUNCTION public.record_raw_material_manual_adjustment(
  p_tenant_id uuid,
  p_material_id uuid,
  p_business_unit_id uuid,
  p_adjustment_type text,
  p_quantity_delta numeric,
  p_cost_per_unit numeric,
  p_reason text,
  p_notes text,
  p_created_by uuid
) SET search_path = public, extensions, pg_temp;

COMMIT;

NOTIFY pgrst, 'reload schema';
