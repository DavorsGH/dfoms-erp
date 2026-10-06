SELECT
  t.id AS tenant_id,
  t.name AS tenant_name,
  'finished'::text AS source_kind,
  fsa.id AS adjustment_id,
  fsa.adjustment_type,
  fsa.business_unit_id,
  fsa.created_at::date AS effective_date,
  round(fsa.quantity_delta * coalesce(fsa.cost_per_unit, 0), 2) AS signed_value,
  CASE
    WHEN fsa.adjustment_type = 'opening_balance' THEN 'opening_equity_bs_only'
    WHEN round(fsa.quantity_delta * coalesce(fsa.cost_per_unit, 0), 4) > 0 THEN 'gain'
    WHEN round(fsa.quantity_delta * coalesce(fsa.cost_per_unit, 0), 4) < 0 THEN 'loss'
    ELSE 'none'
  END AS pl_kind,
  l.id IS NOT NULL AS has_register_link
FROM public.finished_product_stock_adjustments fsa
JOIN public.tenants t ON t.id = fsa.tenant_id
LEFT JOIN public.inventory_stock_adjustment_register_links l
  ON l.tenant_id = fsa.tenant_id
  AND l.source_kind = 'finished'
  AND l.adjustment_id = fsa.id
WHERE fsa.adjustment_type <> 'opening_balance'
  AND round(fsa.quantity_delta * coalesce(fsa.cost_per_unit, 0), 4) <> 0
  AND l.id IS NULL
UNION ALL
SELECT
  t.id,
  t.name,
  'raw',
  rsa.id,
  rsa.adjustment_type,
  rsa.business_unit_id,
  rsa.created_at::date,
  round(rsa.quantity_delta * coalesce(rsa.cost_per_unit, 0), 2),
  CASE
    WHEN rsa.adjustment_type = 'opening_balance' THEN 'opening_equity_bs_only'
    WHEN round(rsa.quantity_delta * coalesce(rsa.cost_per_unit, 0), 4) > 0 THEN 'gain'
    WHEN round(rsa.quantity_delta * coalesce(rsa.cost_per_unit, 0), 4) < 0 THEN 'loss'
    ELSE 'none'
  END,
  l.id IS NOT NULL
FROM public.raw_material_stock_adjustments rsa
JOIN public.tenants t ON t.id = rsa.tenant_id
LEFT JOIN public.inventory_stock_adjustment_register_links l
  ON l.tenant_id = rsa.tenant_id
  AND l.source_kind = 'raw'
  AND l.adjustment_id = rsa.id
WHERE rsa.adjustment_type <> 'opening_balance'
  AND round(rsa.quantity_delta * coalesce(rsa.cost_per_unit, 0), 4) <> 0
  AND l.id IS NULL
ORDER BY tenant_name, effective_date;

SELECT
  t.id AS tenant_id,
  t.name AS tenant_name,
  sum(
    CASE
      WHEN fsa.adjustment_type = 'opening_balance'
        THEN abs(round(fsa.quantity_delta * coalesce(fsa.cost_per_unit, 0), 4))
      ELSE 0
    END
  ) AS opening_balance_equity_abs_total
FROM public.finished_product_stock_adjustments fsa
JOIN public.tenants t ON t.id = fsa.tenant_id
GROUP BY t.id, t.name
UNION ALL
SELECT
  t.id,
  t.name,
  sum(
    CASE
      WHEN rsa.adjustment_type = 'opening_balance'
        THEN abs(round(rsa.quantity_delta * coalesce(rsa.cost_per_unit, 0), 4))
      ELSE 0
    END
  )
FROM public.raw_material_stock_adjustments rsa
JOIN public.tenants t ON t.id = rsa.tenant_id
GROUP BY t.id, t.name;
