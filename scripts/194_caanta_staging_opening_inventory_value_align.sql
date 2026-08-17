-- Script 194: Staging-only — align Caanta opening_inventory_value to live inventory
--
-- STAGING ONLY. Review this file before running. Do NOT run on production.
-- Dry run: replace final COMMIT with ROLLBACK and inspect NOTICE output.
--
-- Tenant: Caanta Market (61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b)
-- Investigation date: 2026-08-09 (FY2026 platform BS integrity sweep)
--
-- Root cause addressed:
--   Script 192 set opening_inventory_value = 1653.60; live inventory asset is now
--   GHS 2730.00 (WAC test products). January BS diff was exactly 1076.40
--   (= 2730.00 − 1653.60). This UPDATE aligns the opening-equity offset to live stock.
--
-- Change:
--   UPDATE inventory_balance_config.opening_inventory_value
--   SET opening_inventory_value = 2730.00
--   WHERE tenant_id = Caanta
--
-- Expected BS impact (January FY2026 only — opening equity posts in go-live month):
--   Jan out-of-balance: 1076.40 → 0.00 (inventory asset matches opening equity offset)
--
-- NOT addressed by this script (separate platform characteristic, unchanged today):
--   Opening equity posts only in the go-live month; inventory asset projects every month.
--   Feb–Jul may still show imbalance until separately reconciled or masked by other lines.
--
-- Post-apply verification (read-only):
--   npx tsx scripts/audit-bs-integrity-all-tenants.ts --env-file .env.staging.local --investigate
--   npx tsx scripts/probe-dashboard-bs-check-staging.ts --tenant-id 61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b
--
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_tenant_id uuid := '61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b';
  v_tenant_name text;
  v_opening_before numeric(18, 4);
  v_opening_after numeric(18, 4) := 2730.00;
  v_opening_expected_before numeric(18, 4) := 1653.60;
  v_go_live_date date;
  v_config_rows integer;
  v_rows_updated integer;
BEGIN
  IF current_database() ILIKE '%prod%' THEN
    RAISE EXCEPTION 'Refusing to run: database name looks like production (%)', current_database();
  END IF;

  SELECT name INTO v_tenant_name
  FROM public.tenants
  WHERE id = v_tenant_id;

  IF v_tenant_name IS NULL THEN
    RAISE EXCEPTION 'Tenant % not found', v_tenant_id;
  END IF;

  IF v_tenant_name NOT ILIKE '%caanta%market%' THEN
    RAISE EXCEPTION 'Tenant name % does not look like Caanta Market — aborting', v_tenant_name;
  END IF;

  SELECT count(*) INTO v_config_rows
  FROM public.inventory_balance_config
  WHERE tenant_id = v_tenant_id;

  SELECT opening_inventory_value, go_live_date
  INTO v_opening_before, v_go_live_date
  FROM public.inventory_balance_config
  WHERE tenant_id = v_tenant_id;

  RAISE NOTICE '=== Caanta opening_inventory_value alignment (script 194) ===';
  RAISE NOTICE 'Tenant: % (%)', v_tenant_name, v_tenant_id;
  RAISE NOTICE 'Database: %', current_database();
  RAISE NOTICE 'inventory_balance_config rows: % (expect 1)', v_config_rows;
  RAISE NOTICE 'go_live_date: % (expect 2026-01-01)', v_go_live_date;
  RAISE NOTICE 'opening_inventory_value before: % (expect %)', v_opening_before, v_opening_expected_before;

  IF v_config_rows <> 1 THEN
    RAISE EXCEPTION 'Expected exactly 1 inventory_balance_config row, found %', v_config_rows;
  END IF;

  IF v_go_live_date IS DISTINCT FROM DATE '2026-01-01' THEN
    RAISE EXCEPTION 'go_live_date is %, expected 2026-01-01', v_go_live_date;
  END IF;

  IF v_opening_before IS DISTINCT FROM v_opening_expected_before THEN
    RAISE EXCEPTION 'opening_inventory_value is %, expected % before update',
      v_opening_before, v_opening_expected_before;
  END IF;

  UPDATE public.inventory_balance_config
  SET opening_inventory_value = v_opening_after
  WHERE tenant_id = v_tenant_id;
  GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

  IF v_rows_updated <> 1 THEN
    RAISE EXCEPTION 'UPDATE matched % rows, expected 1', v_rows_updated;
  END IF;

  SELECT opening_inventory_value INTO v_opening_before
  FROM public.inventory_balance_config
  WHERE tenant_id = v_tenant_id;

  RAISE NOTICE 'opening_inventory_value after: % (expect %)', v_opening_before, v_opening_after;

  IF v_opening_before IS DISTINCT FROM v_opening_after THEN
    RAISE EXCEPTION 'Post-update opening_inventory_value is %, expected %',
      v_opening_before, v_opening_after;
  END IF;

  RAISE NOTICE '=== Done — re-run audit-bs-integrity-all-tenants.ts on staging to verify ===';
END $$;

COMMIT;
-- ROLLBACK;  -- uncomment for dry run instead of COMMIT

NOTIFY pgrst, 'reload schema';
