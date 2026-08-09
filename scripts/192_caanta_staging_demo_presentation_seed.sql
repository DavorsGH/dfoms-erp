-- Script 192: Staging-only demo presentation seed — Caanta Market balance sheet cosmetics
--
-- STAGING ONLY. Review this file before running. Do NOT run on production.
-- Dry run: replace final COMMIT with ROLLBACK and inspect NOTICE output.
--
-- Tenant: Caanta Market (61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b)
-- Investigation date: 2026-08-09 (scripts/probe-dashboard-bs-check-staging.ts)
--
-- =============================================================================
-- BEFORE (August 2026 dashboard, FY2026 month index 7)
-- =============================================================================
--   Out of balance:        GHS 112,845.50  (assets exceed L+E)
--   Cash Position:         GHS -431,078.50
--   Share Capital:         GHS 0.00
--   Inventory (asset):     GHS 1,653.60
--   Inventory Opening Eq:  GHS 0.00
--
-- Monthly imbalance timeline (FY2026):
--   Jan–Jun: GHS 1,653.60  (inventory asset with no opening-equity offset)
--   Jul:     GHS 69,646.10  (expense/cash structural gap — predates this script)
--   Aug:     GHS 112,845.50
--
-- =============================================================================
-- CHANGE 1 — Opening capital contribution (GHS 431,078.50)
-- =============================================================================
-- Mechanism: INSERT into public.capital_contributions (the live product path).
--   • Share Capital on BS: calculateShareCapitalByMonth() in
--     app/dashboard/finance/capital-contributions-utils.ts (cumulative as-of month-end)
--   • Matching cash inflow: sumCapitalContributionsByMonth() in
--     app/dashboard/finance/cash-movement-utils.ts (same month as contribution date)
-- Does NOT use manual_financial_entries.share_capital (legacy column; not read by BS).
--
-- Amount: GHS 431,078.50 (exact offset to pre-seed Cash Position)
--   Cash after:  -431,078.50 + 431,078.50 = ~GHS 0.00
--
-- Date: 2026-01-01 (Caanta go-live; capital visible in all FY2026 months incl. August)
-- contributed_by: first employee row for tenant (FK capital_contributions_contributed_by_fkey)
--
-- BS imbalance impact: NONE — balanced pair (Cash ↑, Share Capital ↑ by same amount).
--
-- =============================================================================
-- CHANGE 2 — Inventory opening equity (GHS 1,653.60)
-- =============================================================================
-- Mechanism: UPDATE public.inventory_balance_config.opening_inventory_value
--   • Inventory Opening Equity row: calculateInventoryOpeningEquityByMonth() in
--     app/dashboard/inventory/inventory-balance-sheet-utils.ts
--   • Posts ONLY in the go-live month (2026-01-01 → January FY2026), NOT every month.
--   • Engine backfills live inventory asset (GHS 1,653.60) across Jan–Aug; opening equity
--     offset is a one-month go-live entry per design (see scripts/staging-bs-gap-fix-proposed.sql).
--
-- BS imbalance impact:
--   January 2026:  −1,653.60 improvement (closes the Jan–Jun structural 1,653.60 piece)
--   August 2026:   NO change — opening equity row is still 0 in Aug; inventory asset remains
--                  1,653.60 with no offsetting equity line that month.
--
-- =============================================================================
-- PROJECTED AFTER (August 2026 dashboard — verify with probe after apply)
-- =============================================================================
--   Cash Position:         GHS ~0.00          (was −431,078.50)
--   Share Capital:         GHS 431,078.50   (was 0.00)
--   Inventory Opening Eq:  GHS 0.00 in Aug  (GHS 1,653.60 appears in January column only)
--   Out of balance:        GHS 112,845.50   (UNCHANGED — capital is balanced; inventory fix
--                                            is go-live-month only, not August)
--
-- Remaining Aug gap (~GHS 112,845.50) reflects Jul/Aug expense/cash structural issues
-- (not addressed by this cosmetic seed). Do NOT claim fully resolved after apply.
--
-- Post-apply verification (read-only):
--   npx tsx scripts/probe-dashboard-bs-check-staging.ts --tenant-id 61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b
--
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_tenant_id uuid := '61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b';
  v_tenant_name text;
  v_capital_amount numeric(12, 2) := 431078.50;
  v_capital_date date := '2026-01-01';
  v_opening_inventory_value numeric(18, 4) := 1653.60;
  v_contributor_id text;
  v_capital_before integer;
  v_inv_config_before integer;
  v_opening_inv_before numeric(18, 4);
  v_go_live_before date;
  v_capital_id uuid;
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

  SELECT count(*) INTO v_capital_before
  FROM public.capital_contributions
  WHERE tenant_id = v_tenant_id;

  SELECT count(*) INTO v_inv_config_before
  FROM public.inventory_balance_config
  WHERE tenant_id = v_tenant_id;

  SELECT opening_inventory_value, go_live_date
  INTO v_opening_inv_before, v_go_live_before
  FROM public.inventory_balance_config
  WHERE tenant_id = v_tenant_id;

  SELECT employee_id INTO v_contributor_id
  FROM public.employees
  WHERE tenant_id = v_tenant_id
  ORDER BY employee_id
  LIMIT 1;

  RAISE NOTICE '=== Caanta staging demo presentation seed (script 192) ===';
  RAISE NOTICE 'Tenant: % (%)', v_tenant_name, v_tenant_id;
  RAISE NOTICE 'Database: %', current_database();
  RAISE NOTICE 'capital_contributions rows before: % (expect 0)', v_capital_before;
  RAISE NOTICE 'inventory_balance_config rows: % (expect 1)', v_inv_config_before;
  RAISE NOTICE 'opening_inventory_value before: % (expect 0)', v_opening_inv_before;
  RAISE NOTICE 'go_live_date before: % (expect 2026-01-01)', v_go_live_before;
  RAISE NOTICE 'contributor employee_id: %', v_contributor_id;

  IF v_capital_before <> 0 THEN
    RAISE EXCEPTION 'Expected 0 capital_contributions for Caanta, found % — aborting (already seeded?)', v_capital_before;
  END IF;

  IF v_inv_config_before <> 1 THEN
    RAISE EXCEPTION 'Expected exactly 1 inventory_balance_config row, found %', v_inv_config_before;
  END IF;

  IF coalesce(v_opening_inv_before, 0) <> 0 THEN
    RAISE EXCEPTION 'opening_inventory_value is %, expected 0 before seed', v_opening_inv_before;
  END IF;

  IF v_go_live_before IS DISTINCT FROM DATE '2026-01-01' THEN
    RAISE EXCEPTION 'go_live_date is %, expected 2026-01-01', v_go_live_before;
  END IF;

  IF v_contributor_id IS NULL THEN
    RAISE EXCEPTION 'No employee found for tenant % — capital_contributions.contributed_by FK required', v_tenant_id;
  END IF;

  RAISE NOTICE '--- Applying change 1: capital_contribution GHS % on % ---', v_capital_amount, v_capital_date;

  INSERT INTO public.capital_contributions (
    tenant_id,
    date,
    contributed_by,
    amount,
    description,
    notes
  )
  VALUES (
    v_tenant_id,
    v_capital_date,
    v_contributor_id,
    v_capital_amount,
    'Opening owner capital contribution (staging demo presentation seed)',
    'Script 192 — Caanta staging-only BS demo cleanup 2026-08-09. Not for production.'
  )
  RETURNING id INTO v_capital_id;

  RAISE NOTICE 'Inserted capital_contributions.id = %', v_capital_id;

  RAISE NOTICE '--- Applying change 2: opening_inventory_value = % ---', v_opening_inventory_value;

  UPDATE public.inventory_balance_config
  SET opening_inventory_value = v_opening_inventory_value
  WHERE tenant_id = v_tenant_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'inventory_balance_config UPDATE matched 0 rows for tenant %', v_tenant_id;
  END IF;

  RAISE NOTICE '=== Post-apply row checks ===';
  RAISE NOTICE 'capital_contributions count: % (expect 1)', (
    SELECT count(*) FROM public.capital_contributions WHERE tenant_id = v_tenant_id
  );
  RAISE NOTICE 'capital_contributions total amount: % (expect %)', (
    SELECT coalesce(sum(amount), 0) FROM public.capital_contributions WHERE tenant_id = v_tenant_id
  ), v_capital_amount;
  RAISE NOTICE 'opening_inventory_value after: % (expect %)', (
    SELECT opening_inventory_value FROM public.inventory_balance_config WHERE tenant_id = v_tenant_id
  ), v_opening_inventory_value;

  RAISE NOTICE '=== Expected dashboard impact (August 2026) ===';
  RAISE NOTICE 'Cash Position: ~GHS % (was -431,078.50)', (-431078.50 + v_capital_amount);
  RAISE NOTICE 'Share Capital: ~GHS % (was 0.00)', v_capital_amount;
  RAISE NOTICE 'Out of balance: ~GHS 112,845.50 UNCHANGED — run probe script to confirm';
  RAISE NOTICE 'January out of balance: should improve by GHS 1,653.60 vs pre-seed Jan figure';
END $$;

COMMIT;
-- ROLLBACK;  -- uncomment for dry run instead of COMMIT

NOTIFY pgrst, 'reload schema';
