SELECT public.backfill_null_business_unit_ids_for_single_unit_tenant(t.id)
FROM public.tenants t
WHERE (
  SELECT count(*)::integer
  FROM public.business_units bu
  WHERE bu.tenant_id = t.id
) = 1;
