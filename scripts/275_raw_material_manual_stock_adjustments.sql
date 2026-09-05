-- Raw material manual stock adjustments (opening / correction / found / write-off).
-- Marker: dfoms-rm-manual-stock-adj
-- Staging first; do not apply to production until verified.
-- Mirrors raw_material_balances RLS (tenant_matches) and balance-helper SECURITY INVOKER grants.

BEGIN;

-- =============================================================================
-- 1. Table
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.raw_material_stock_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  material_id uuid NOT NULL REFERENCES public.raw_materials(id) ON DELETE CASCADE,
  business_unit_id uuid NULL REFERENCES public.business_units(id),
  adjustment_type text NOT NULL,
  quantity_delta numeric(18,4) NOT NULL,
  cost_per_unit numeric(18,4) NULL,
  reason text NOT NULL,
  notes text NULL,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT raw_material_stock_adjustments_type_check
    CHECK (
      adjustment_type IN (
        'opening_balance',
        'correction',
        'found_stock',
        'write_off'
      )
    ),
  CONSTRAINT raw_material_stock_adjustments_reason_check
    CHECK (length(trim(reason)) > 0),
  CONSTRAINT raw_material_stock_adjustments_qty_nonzero_check
    CHECK (quantity_delta <> 0)
);

CREATE INDEX IF NOT EXISTS idx_raw_material_stock_adjustments_tenant_bu
  ON public.raw_material_stock_adjustments (tenant_id, business_unit_id);

CREATE INDEX IF NOT EXISTS idx_raw_material_stock_adjustments_material_id
  ON public.raw_material_stock_adjustments (material_id);

CREATE INDEX IF NOT EXISTS idx_raw_material_stock_adjustments_created_at
  ON public.raw_material_stock_adjustments (tenant_id, created_at DESC);

-- =============================================================================
-- 2. RLS — same pattern as raw_material_balances
-- =============================================================================
ALTER TABLE public.raw_material_stock_adjustments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS raw_material_stock_adjustments_tenant_select
  ON public.raw_material_stock_adjustments;
CREATE POLICY raw_material_stock_adjustments_tenant_select
  ON public.raw_material_stock_adjustments FOR SELECT TO authenticated
  USING (tenant_matches(tenant_id));

DROP POLICY IF EXISTS raw_material_stock_adjustments_tenant_insert
  ON public.raw_material_stock_adjustments;
CREATE POLICY raw_material_stock_adjustments_tenant_insert
  ON public.raw_material_stock_adjustments FOR INSERT TO authenticated
  WITH CHECK (tenant_matches(tenant_id));

DROP POLICY IF EXISTS raw_material_stock_adjustments_tenant_update
  ON public.raw_material_stock_adjustments;
CREATE POLICY raw_material_stock_adjustments_tenant_update
  ON public.raw_material_stock_adjustments FOR UPDATE TO authenticated
  USING (tenant_matches(tenant_id))
  WITH CHECK (tenant_matches(tenant_id));

DROP POLICY IF EXISTS raw_material_stock_adjustments_tenant_delete
  ON public.raw_material_stock_adjustments;
CREATE POLICY raw_material_stock_adjustments_tenant_delete
  ON public.raw_material_stock_adjustments FOR DELETE TO authenticated
  USING (tenant_matches(tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.raw_material_stock_adjustments TO authenticated;
GRANT ALL ON public.raw_material_stock_adjustments TO service_role;

-- =============================================================================
-- 3. RPC — SECURITY INVOKER + grants matching balance helpers
-- =============================================================================
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
  v_old_stock numeric(18,4);
  v_old_avg numeric(18,4);
  v_old_value numeric(18,4);
  v_new_stock numeric(18,4);
  v_new_value numeric(18,4);
  v_new_avg numeric(18,4);
BEGIN
  -- dfoms-rm-manual-stock-adj
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

    v_total_cost := ROUND(p_quantity_delta * p_cost_per_unit, 4);

    -- Balance-side WAC (ensure + qty + average_cost_per_unit)
    PERFORM public.apply_raw_material_balance_purchase(
      p_tenant_id,
      p_material_id,
      p_business_unit_id,
      p_quantity_delta,
      v_total_cost
    );

    -- Master-side WAC — exact formula from apply_raw_material_purchase
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
    -- correction / write_off: qty only (no WAC change)
    PERFORM public.ensure_raw_material_balance(
      p_tenant_id,
      p_material_id,
      p_business_unit_id
    );

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
    p_cost_per_unit,
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

COMMENT ON FUNCTION public.record_raw_material_manual_adjustment(
  uuid, uuid, uuid, text, numeric, numeric, text, text, uuid
) IS
  'Record opening/found (WAC) or correction/write_off (qty-only) raw material stock adjustments (dfoms-rm-manual-stock-adj).';

COMMIT;
