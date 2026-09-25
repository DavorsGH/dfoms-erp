BEGIN;

DO $$
DECLARE
  v_davors uuid := '00000001-0000-4000-8000-000000000001';
  v_tech uuid;
BEGIN
  SELECT id INTO v_tech
  FROM public.business_units
  WHERE tenant_id = v_davors
    AND name = 'Davors Technologies'
    AND is_active IS TRUE;

  IF v_tech IS NULL THEN
    RAISE EXCEPTION 'Davors Technologies active business unit not found for tenant %', v_davors;
  END IF;

  UPDATE public.crm_products p
  SET business_unit_id = v_tech
  WHERE p.tenant_id = v_davors
    AND p.business_unit_id IS DISTINCT FROM v_tech
    AND (
      (p.category = 'ERP Suite' AND p.tier_slug IS NOT NULL)
      OR p.category = 'Platform Billing'
      OR p.name LIKE 'SMS Credits — %'
    );
END $$;

COMMIT;
