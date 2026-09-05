-- Finished product manual stock adjustments (opening / correction / found / write-off).
-- Marker: dfoms-fp-manual-stock-adj
-- Staging first; do not apply to production until verified.
-- Mirrors finished_product_balances RLS (tenant_matches) and balance-helper grants.
--
-- WAC extension: finished_product_weighted_avg_cost_scoped gains one numerator term
-- for finished_product_stock_adjustments (quantity_delta * cost_per_unit). Existing
-- four terms and the denominator are unchanged.

BEGIN;

-- =============================================================================
-- 1. Table
-- =============================================================================
CREATE TABLE IF NOT EXISTS public.finished_product_stock_adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants(id),
  product_id uuid NOT NULL REFERENCES public.finished_products(id) ON DELETE CASCADE,
  business_unit_id uuid NULL REFERENCES public.business_units(id),
  adjustment_type text NOT NULL,
  quantity_delta numeric(18,4) NOT NULL,
  cost_per_unit numeric(18,4) NULL,
  reason text NOT NULL,
  notes text NULL,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT finished_product_stock_adjustments_type_check
    CHECK (
      adjustment_type IN (
        'opening_balance',
        'correction',
        'found_stock',
        'write_off'
      )
    ),
  CONSTRAINT finished_product_stock_adjustments_reason_check
    CHECK (length(trim(reason)) > 0),
  CONSTRAINT finished_product_stock_adjustments_qty_nonzero_check
    CHECK (quantity_delta <> 0)
);

CREATE INDEX IF NOT EXISTS idx_finished_product_stock_adjustments_tenant_bu
  ON public.finished_product_stock_adjustments (tenant_id, business_unit_id);

CREATE INDEX IF NOT EXISTS idx_finished_product_stock_adjustments_product_id
  ON public.finished_product_stock_adjustments (product_id);

CREATE INDEX IF NOT EXISTS idx_finished_product_stock_adjustments_created_at
  ON public.finished_product_stock_adjustments (tenant_id, created_at DESC);

-- =============================================================================
-- 2. RLS — match finished_product_balances (tenant_matches, authenticated)
-- =============================================================================
ALTER TABLE public.finished_product_stock_adjustments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS finished_product_stock_adjustments_tenant_select
  ON public.finished_product_stock_adjustments;
CREATE POLICY finished_product_stock_adjustments_tenant_select
  ON public.finished_product_stock_adjustments FOR SELECT TO authenticated
  USING (tenant_matches(tenant_id));

DROP POLICY IF EXISTS finished_product_stock_adjustments_tenant_insert
  ON public.finished_product_stock_adjustments;
CREATE POLICY finished_product_stock_adjustments_tenant_insert
  ON public.finished_product_stock_adjustments FOR INSERT TO authenticated
  WITH CHECK (tenant_matches(tenant_id));

DROP POLICY IF EXISTS finished_product_stock_adjustments_tenant_update
  ON public.finished_product_stock_adjustments;
CREATE POLICY finished_product_stock_adjustments_tenant_update
  ON public.finished_product_stock_adjustments FOR UPDATE TO authenticated
  USING (tenant_matches(tenant_id))
  WITH CHECK (tenant_matches(tenant_id));

DROP POLICY IF EXISTS finished_product_stock_adjustments_tenant_delete
  ON public.finished_product_stock_adjustments;
CREATE POLICY finished_product_stock_adjustments_tenant_delete
  ON public.finished_product_stock_adjustments FOR DELETE TO authenticated
  USING (tenant_matches(tenant_id));

GRANT SELECT, INSERT, UPDATE, DELETE
  ON public.finished_product_stock_adjustments TO authenticated;
GRANT ALL ON public.finished_product_stock_adjustments TO service_role;

-- =============================================================================
-- 3. Extend finished_product_weighted_avg_cost_scoped (one new numerator term)
-- =============================================================================
-- BEFORE (unchanged four terms + denominator):
--   + production_batches.total_batch_cost
--   + product_purchases.total_cost
--   - sale COGS / COGS reversal expense amounts
--   - internal_consumption expense amounts
--   / finished_product_balances.current_stock
--
-- AFTER: same four terms, plus
--   + SUM(fsa.quantity_delta * fsa.cost_per_unit) from finished_product_stock_adjustments
CREATE OR REPLACE FUNCTION public.finished_product_weighted_avg_cost_scoped(
  p_product_id uuid,
  p_business_unit_id uuid
)
RETURNS numeric
LANGUAGE sql
STABLE
AS $function$
  SELECT COALESCE(
    ROUND(
      (
        COALESCE((
          SELECT SUM(pb.total_batch_cost)
          FROM production_batches pb
          WHERE pb.finished_product_id = p_product_id
            AND pb.business_unit_id IS NOT DISTINCT FROM p_business_unit_id
        ), 0)
        + COALESCE((
          SELECT SUM(pp.total_cost)
          FROM product_purchases pp
          WHERE pp.product_id = p_product_id
            AND pp.business_unit_id IS NOT DISTINCT FROM p_business_unit_id
        ), 0)
        - COALESCE((
          SELECT SUM(e.amount)
          FROM income_register i
          JOIN expense_register e
            ON e.id = i.cogs_expense_id
            OR e.id = i.cogs_reversal_expense_id
          WHERE i.product_id = p_product_id
            AND i.entry_type = 'product_sale'
            AND i.business_unit_id IS NOT DISTINCT FROM p_business_unit_id
        ), 0)
        - COALESCE((
          SELECT SUM(e.amount)
          FROM internal_consumption ic
          JOIN expense_register e ON e.id = ic.expense_register_id
          WHERE ic.product_id = p_product_id
            AND ic.business_unit_id IS NOT DISTINCT FROM p_business_unit_id
        ), 0)
        + COALESCE((
          SELECT SUM(fsa.quantity_delta * fsa.cost_per_unit)
          FROM finished_product_stock_adjustments fsa
          WHERE fsa.product_id = p_product_id
            AND fsa.business_unit_id IS NOT DISTINCT FROM p_business_unit_id
        ), 0)
      ) / NULLIF((
        SELECT fpb.current_stock
        FROM finished_product_balances fpb
        WHERE fpb.product_id = p_product_id
          AND fpb.business_unit_id IS NOT DISTINCT FROM p_business_unit_id
      ), 0),
      4
    ),
    0
  );
$function$;

COMMENT ON FUNCTION public.finished_product_weighted_avg_cost_scoped(uuid, uuid) IS
  'BU-scoped FP WAC from batches + purchases - sale COGS - IC + manual stock adjustments (dfoms-fp-manual-stock-adj).';

-- =============================================================================
-- 4. RPC — SECURITY INVOKER + grants matching ensure/adjust helpers
-- =============================================================================
CREATE OR REPLACE FUNCTION public.record_finished_product_manual_adjustment(
  p_tenant_id uuid,
  p_product_id uuid,
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
  v_resolved_cost numeric(18,4);
BEGIN
  -- dfoms-fp-manual-stock-adj
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
    -- correction / write_off: refuse caller-supplied cost; capture pre-change WAC
    IF p_cost_per_unit IS NOT NULL THEN
      RAISE EXCEPTION
        '% must not supply cost_per_unit — it is captured from the current BU-scoped WAC',
        v_type;
    END IF;
    v_resolved_cost := public.finished_product_weighted_avg_cost_scoped(
      p_product_id,
      p_business_unit_id
    );
  END IF;

  -- Insert first so adjust_finished_product_balance_qty's WAC recompute sees this row
  INSERT INTO public.finished_product_stock_adjustments (
    tenant_id,
    product_id,
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
    p_product_id,
    p_business_unit_id,
    v_type,
    p_quantity_delta,
    v_resolved_cost,
    v_reason,
    NULLIF(trim(COALESCE(p_notes, '')), ''),
    p_created_by
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

  -- Master qty-only dual-write (no average_cost_per_unit column on finished_products)
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
  uuid, uuid, uuid, text, numeric, numeric, text, text, uuid
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.record_finished_product_manual_adjustment(
  uuid, uuid, uuid, text, numeric, numeric, text, text, uuid
) TO authenticated, service_role;

COMMENT ON FUNCTION public.record_finished_product_manual_adjustment(
  uuid, uuid, uuid, text, numeric, numeric, text, text, uuid
) IS
  'Record opening/found (caller cost) or correction/write_off (pre-captured WAC) finished product stock adjustments (dfoms-fp-manual-stock-adj).';

COMMIT;
