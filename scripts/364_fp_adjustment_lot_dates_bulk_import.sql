-- Store opening/found lot dates on finished_product_stock_adjustments;
-- bulk import opening stock no longer inserts metadata product_purchases rows.
-- Apply after 363.

BEGIN;

ALTER TABLE public.finished_product_stock_adjustments
  ADD COLUMN IF NOT EXISTS manufacturing_date date NULL,
  ADD COLUMN IF NOT EXISTS expiration_date date NULL;

DROP FUNCTION IF EXISTS public.record_finished_product_manual_adjustment(
  uuid,
  uuid,
  uuid,
  text,
  numeric,
  numeric,
  text,
  text,
  uuid
);

CREATE OR REPLACE FUNCTION public.record_finished_product_manual_adjustment(
  p_tenant_id uuid,
  p_product_id uuid,
  p_business_unit_id uuid,
  p_adjustment_type text,
  p_quantity_delta numeric,
  p_cost_per_unit numeric,
  p_reason text,
  p_notes text,
  p_created_by uuid,
  p_manufacturing_date date DEFAULT NULL,
  p_expiration_date date DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY INVOKER
AS $function$
DECLARE
  v_id uuid;
  v_reason text := trim(COALESCE(p_reason, ''));
  v_type text := trim(COALESCE(p_adjustment_type, ''));
  v_resolved_cost numeric(18,4);
BEGIN
  PERFORM public.assert_not_view_all_business_units();

  IF p_tenant_id IS NULL OR p_product_id IS NULL THEN
    RAISE EXCEPTION 'tenant_id and product_id are required';
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

  IF p_manufacturing_date IS NOT NULL OR p_expiration_date IS NOT NULL THEN
    IF v_type NOT IN ('opening_balance', 'found_stock') THEN
      RAISE EXCEPTION
        'manufacturing_date and expiration_date are only allowed for opening_balance and found_stock';
    END IF;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.finished_products
    WHERE id = p_product_id
      AND tenant_id = p_tenant_id
  ) THEN
    RAISE EXCEPTION 'Finished product % not found for tenant %',
      p_product_id, p_tenant_id;
  END IF;

  IF v_type IN ('opening_balance', 'found_stock') THEN
    IF p_cost_per_unit IS NULL THEN
      RAISE EXCEPTION '% requires cost_per_unit', v_type;
    END IF;
    v_resolved_cost := p_cost_per_unit;
  ELSE
    IF p_cost_per_unit IS NOT NULL THEN
      RAISE EXCEPTION
        '% must not supply cost_per_unit — it is captured from the current BU-scoped WAC',
        v_type;
    END IF;
    v_resolved_cost := public.finished_product_inventory_outflow_unit_cost(
      p_product_id,
      p_business_unit_id
    );
  END IF;

  INSERT INTO public.finished_product_stock_adjustments (
    tenant_id,
    product_id,
    business_unit_id,
    adjustment_type,
    quantity_delta,
    cost_per_unit,
    reason,
    notes,
    created_by,
    manufacturing_date,
    expiration_date
  )
  VALUES (
    p_tenant_id,
    p_product_id,
    p_business_unit_id,
    v_type,
    p_quantity_delta,
    v_resolved_cost,
    v_reason,
    NULLIF(trim(COALESCE(p_notes, '')), ''),
    p_created_by,
    p_manufacturing_date,
    p_expiration_date
  )
  RETURNING id INTO v_id;

  PERFORM public.ensure_finished_product_balance(
    p_tenant_id,
    p_product_id,
    p_business_unit_id
  );

  PERFORM public.adjust_finished_product_balance_qty(
    p_tenant_id,
    p_product_id,
    p_business_unit_id,
    p_quantity_delta
  );

  UPDATE public.finished_products
  SET current_stock = current_stock + p_quantity_delta,
      updated_at = now()
  WHERE id = p_product_id
    AND tenant_id = p_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Failed to update finished_products.current_stock for product %',
      p_product_id;
  END IF;

  RETURN v_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.record_finished_product_manual_adjustment(
  uuid, uuid, uuid, text, numeric, numeric, text, text, uuid, date, date
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.record_finished_product_manual_adjustment(
  uuid, uuid, uuid, text, numeric, numeric, text, text, uuid, date, date
) TO authenticated, service_role;

COMMENT ON FUNCTION public.record_finished_product_manual_adjustment(
  uuid, uuid, uuid, text, numeric, numeric, text, text, uuid, date, date
) IS
  'Record opening/found (caller cost, optional lot dates) or correction/write_off (pre-captured WAC) finished product stock adjustments.';

ALTER FUNCTION public.record_finished_product_manual_adjustment(
  p_tenant_id uuid,
  p_product_id uuid,
  p_business_unit_id uuid,
  p_adjustment_type text,
  p_quantity_delta numeric,
  p_cost_per_unit numeric,
  p_reason text,
  p_notes text,
  p_created_by uuid,
  p_manufacturing_date date,
  p_expiration_date date
) SET search_path = public, pg_temp;

CREATE OR REPLACE FUNCTION public.apply_bulk_import_finished_product_opening(
  p_tenant_id uuid,
  p_product_id uuid,
  p_business_unit_id uuid,
  p_quantity numeric,
  p_cost_per_unit numeric,
  p_lot_date date,
  p_manufacturing_date date,
  p_expiration_date date,
  p_product_code text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_qty numeric(18, 4);
  v_cost numeric(18, 4);
BEGIN
  PERFORM public.assert_caller_can_act_for_tenant(p_tenant_id);

  v_qty := round(coalesce(p_quantity, 0), 4);
  IF v_qty <= 0 THEN
    RETURN;
  END IF;

  v_cost := round(greatest(coalesce(p_cost_per_unit, 0), 0), 4);

  PERFORM public.record_finished_product_manual_adjustment(
    p_tenant_id,
    p_product_id,
    p_business_unit_id,
    'opening_balance',
    v_qty,
    v_cost,
    'Bulk import opening stock',
    format('Imported product %s', coalesce(nullif(trim(p_product_code), ''), p_product_id::text)),
    NULL,
    p_manufacturing_date,
    p_expiration_date
  );
END;
$$;

REVOKE ALL ON FUNCTION public.apply_bulk_import_finished_product_opening(
  uuid, uuid, uuid, numeric, numeric, date, date, date, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.apply_bulk_import_finished_product_opening(
  uuid, uuid, uuid, numeric, numeric, date, date, date, text
) FROM anon;
REVOKE ALL ON FUNCTION public.apply_bulk_import_finished_product_opening(
  uuid, uuid, uuid, numeric, numeric, date, date, date, text
) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.apply_bulk_import_finished_product_opening(
  uuid, uuid, uuid, numeric, numeric, date, date, date, text
) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
