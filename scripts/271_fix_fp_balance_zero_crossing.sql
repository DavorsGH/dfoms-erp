-- Phase 7b step 6 fix: 0→N zero-crossing in adjust_finished_product_balance_qty.
-- Already applied to staging + production — repo record only; do not re-run casually.
--
-- Bug: a single UPDATE set current_stock and average_cost_per_unit together; scoped
-- WAC still read pre-update stock (0), so first production left avg at 0.
-- Fix: qty UPDATE first, then avg UPDATE so scoped WAC sees post-delta stock.

BEGIN;

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
      updated_at = now()
  WHERE tenant_id = p_tenant_id
    AND product_id = p_product_id
    AND business_unit_id IS NOT DISTINCT FROM p_business_unit_id;

  UPDATE public.finished_product_balances
  SET average_cost_per_unit = COALESCE(
        public.finished_product_weighted_avg_cost_scoped(p_product_id, p_business_unit_id),
        0
      ),
      updated_at = now()
  WHERE tenant_id = p_tenant_id
    AND product_id = p_product_id
    AND business_unit_id IS NOT DISTINCT FROM p_business_unit_id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.adjust_finished_product_balance_qty(uuid, uuid, uuid, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.adjust_finished_product_balance_qty(uuid, uuid, uuid, numeric)
  TO authenticated, service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
