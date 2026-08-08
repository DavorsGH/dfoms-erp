-- Script 179: Seed Fixed Assets expense category + subcategory for every tenant.
-- Apply staging first; production after verification.

BEGIN;

INSERT INTO public.expense_categories (name, tenant_id)
SELECT 'Fixed Assets', t.id
FROM public.tenants t
WHERE NOT EXISTS (
  SELECT 1
  FROM public.expense_categories ec
  WHERE ec.name = 'Fixed Assets'
    AND ec.tenant_id = t.id
);

INSERT INTO public.expense_subcategories (name, tenant_id)
SELECT 'Fixed Asset Purchases', t.id
FROM public.tenants t
WHERE NOT EXISTS (
  SELECT 1
  FROM public.expense_subcategories es
  WHERE es.name = 'Fixed Asset Purchases'
    AND es.tenant_id = t.id
);

COMMIT;
