BEGIN;

CREATE OR REPLACE FUNCTION public.apply_raw_material_purchase()
RETURNS trigger
LANGUAGE plpgsql
AS $function$
DECLARE
  v_old_stock NUMERIC(18,4);
  v_old_avg NUMERIC(18,4);
  v_old_value NUMERIC(18,4);
  v_new_stock NUMERIC(18,4);
  v_new_value NUMERIC(18,4);
  v_new_avg NUMERIC(18,4);
  v_material_tenant_id UUID;
BEGIN
  PERFORM public.assert_not_view_all_business_units();
  NEW.total_cost := ROUND(NEW.quantity * NEW.cost_per_unit, 4);
  SELECT current_stock, average_cost_per_unit, tenant_id
  INTO v_old_stock, v_old_avg, v_material_tenant_id
  FROM raw_materials
  WHERE id = NEW.material_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Raw material % not found for purchase', NEW.material_id;
  END IF;
  IF v_material_tenant_id IS NULL THEN
    RAISE EXCEPTION 'Raw material % has no tenant_id', NEW.material_id;
  END IF;
  v_old_value := ROUND(v_old_stock * v_old_avg, 4);
  v_new_stock := v_old_stock + NEW.quantity;
  v_new_value := v_old_value + NEW.total_cost;
  IF v_new_stock <= 0 THEN
    v_new_avg := 0;
  ELSE
    v_new_avg := ROUND(v_new_value / v_new_stock, 4);
  END IF;
  UPDATE raw_materials
  SET current_stock = v_new_stock,
      average_cost_per_unit = v_new_avg,
      updated_at = now()
  WHERE id = NEW.material_id;
  PERFORM public.apply_raw_material_balance_purchase(
    v_material_tenant_id,
    NEW.material_id,
    NEW.business_unit_id,
    NEW.quantity,
    NEW.total_cost
  );
  RETURN NEW;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.apply_raw_material_purchase() TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
