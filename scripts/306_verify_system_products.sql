SELECT p.name, p.category, p.unit_price, p.billing_cycle, bu.name AS business_unit_name
FROM public.crm_products p
LEFT JOIN public.business_units bu ON bu.id = p.business_unit_id
WHERE p.tenant_id = '00000001-0000-4000-8000-000000000001'
  AND (
    (p.category = 'ERP Suite' AND p.tier_slug IS NOT NULL)
    OR p.category = 'Platform Billing'
    OR p.name LIKE 'SMS Credits — %'
  )
ORDER BY p.category, p.name;
