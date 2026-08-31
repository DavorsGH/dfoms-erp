BEGIN;

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

CREATE OR REPLACE FUNCTION public.get_finished_product_average_costs_scoped(
  p_tenant_id uuid,
  p_business_unit_id uuid
)
RETURNS TABLE(product_id UUID, average_cost NUMERIC)
LANGUAGE sql
STABLE
AS $function$
  SELECT
    fp.id AS product_id,
    public.finished_product_weighted_avg_cost_scoped(fp.id, p_business_unit_id) AS average_cost
  FROM finished_products fp
  WHERE fp.tenant_id = p_tenant_id
    AND (
      EXISTS (
        SELECT 1 FROM production_batches pb
        WHERE pb.finished_product_id = fp.id
          AND pb.business_unit_id IS NOT DISTINCT FROM p_business_unit_id
      )
      OR EXISTS (
        SELECT 1 FROM product_purchases pp
        WHERE pp.product_id = fp.id
          AND pp.business_unit_id IS NOT DISTINCT FROM p_business_unit_id
      )
      OR EXISTS (
        SELECT 1 FROM finished_product_balances fpb
        WHERE fpb.product_id = fp.id
          AND fpb.tenant_id = p_tenant_id
          AND fpb.business_unit_id IS NOT DISTINCT FROM p_business_unit_id
          AND COALESCE(fpb.current_stock, 0) <> 0
      )
    );
$function$;

CREATE OR REPLACE FUNCTION public.adjust_finished_product_balance_qty(
  p_tenant_id uuid,
  p_product_id uuid,
  p_business_unit_id uuid,
  p_qty_delta numeric
)
RETURNS void
LANGUAGE plpgsql
AS $function$
BEGIN
  PERFORM public.ensure_finished_product_balance(p_tenant_id, p_product_id, p_business_unit_id);

  UPDATE public.finished_product_balances
  SET current_stock = current_stock + p_qty_delta,
      average_cost_per_unit = COALESCE(
        public.finished_product_weighted_avg_cost_scoped(p_product_id, p_business_unit_id),
        0
      ),
      updated_at = now()
  WHERE tenant_id = p_tenant_id
    AND product_id = p_product_id
    AND business_unit_id IS NOT DISTINCT FROM p_business_unit_id;
END;
$function$;

REVOKE ALL ON FUNCTION public.finished_product_weighted_avg_cost_scoped(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.finished_product_weighted_avg_cost_scoped(uuid, uuid)
  TO authenticated, service_role;

REVOKE ALL ON FUNCTION public.get_finished_product_average_costs_scoped(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_finished_product_average_costs_scoped(uuid, uuid)
  TO authenticated, service_role;

REVOKE EXECUTE ON FUNCTION public.adjust_finished_product_balance_qty(uuid, uuid, uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.adjust_finished_product_balance_qty(uuid, uuid, uuid, numeric)
  TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
