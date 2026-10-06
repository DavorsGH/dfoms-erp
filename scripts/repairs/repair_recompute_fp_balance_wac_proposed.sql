UPDATE public.finished_product_balances fpb
SET average_cost_per_unit = round(
  greatest(
    coalesce(public.finished_product_weighted_avg_cost_scoped(fpb.product_id, fpb.business_unit_id), 0),
    0
  ),
  4
),
updated_at = now()
WHERE fpb.tenant_id = '00000001-0000-4000-8000-000000000001'::uuid
  AND fpb.current_stock > 0;
