SELECT
  t.id AS tenant_id,
  t.slug AS tenant_slug,
  m.*
FROM public.tenants t
CROSS JOIN LATERAL public.audit_tenant_ap_accrual_mismatch(t.id) m
ORDER BY t.slug, m.invoice_number;

SELECT public.repair_tenant_ap_accrual_sync('61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b'::uuid);
