-- Bulk import: opening finished-product stock via opening_balance adjustment + optional lot dates.
-- Apply after 276 (record_finished_product_manual_adjustment) and lot columns on product_purchases.

BEGIN;

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
  v_lot_date date;
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
    NULL
  );

  IF p_manufacturing_date IS NULL AND p_expiration_date IS NULL THEN
    RETURN;
  END IF;

  v_lot_date := coalesce(p_lot_date, current_date);

  INSERT INTO public.product_purchases (
    tenant_id,
    product_id,
    purchase_date,
    quantity,
    cost_per_unit,
    total_cost,
    supplier_id,
    payment_method,
    notes,
    manufacturing_date,
    expiration_date,
    business_unit_id,
    remaining_quantity
  )
  VALUES (
    p_tenant_id,
    p_product_id,
    v_lot_date,
    v_qty,
    0,
    0,
    NULL,
    'Cash',
    'Bulk import opening lot dates (stock recorded via opening balance adjustment)',
    p_manufacturing_date,
    p_expiration_date,
    p_business_unit_id,
    v_qty
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
