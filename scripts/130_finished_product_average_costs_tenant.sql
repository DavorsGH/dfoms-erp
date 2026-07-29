-- Script 130: Make get_finished_product_average_costs tenant-safe
--
-- The original no-arg RPC (script 93) returned weighted average costs for ALL
-- tenants. App loaders filtered by product id after the fact (P0 mitigation).
-- This replaces the function so any caller must pass p_tenant_id and only
-- receives that tenant's rows.
--
-- Safe to re-run. Apply on staging first.

BEGIN;

DROP FUNCTION IF EXISTS public.get_finished_product_average_costs();
DROP FUNCTION IF EXISTS public.get_finished_product_average_costs(uuid);

CREATE OR REPLACE FUNCTION public.get_finished_product_average_costs(
  p_tenant_id uuid
)
RETURNS TABLE(product_id UUID, average_cost NUMERIC)
LANGUAGE sql
STABLE
AS $function$
  SELECT
    combined.product_id,
    COALESCE(
      ROUND(SUM(combined.total_cost) / NULLIF(SUM(combined.qty), 0), 4),
      0
    ) AS average_cost
  FROM (
    SELECT
      finished_product_id AS product_id,
      total_batch_cost AS total_cost,
      quantity_produced AS qty
    FROM production_batches
    WHERE tenant_id = p_tenant_id
    UNION ALL
    SELECT
      product_id,
      total_cost,
      quantity AS qty
    FROM product_purchases
    WHERE tenant_id = p_tenant_id
  ) combined
  GROUP BY combined.product_id;
$function$;

REVOKE ALL ON FUNCTION public.get_finished_product_average_costs(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_finished_product_average_costs(uuid)
  TO authenticated, service_role;

COMMIT;
