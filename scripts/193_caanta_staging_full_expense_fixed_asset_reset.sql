-- Script 193: Staging-only full reset — Caanta expense_register + fixed_assets clean slate
--
-- STAGING ONLY. Review verification output before running. Do NOT run on production.
-- Dry run: replace final COMMIT with ROLLBACK and inspect NOTICE output.
--
-- Tenant: Caanta Market (61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b)
--
-- Scope (this script ONLY):
--   • ALL expense_register rows for Caanta
--   • tax_ledger_entries tied to those expenses (source_type = expense_register)
--   • fixed_assets-linked accounts_payable rows (via fixed_assets.accounts_payable_id)
--   • ALL fixed_assets rows for Caanta
--
-- Does NOT delete: income_register, inventory, payroll, non-FA accounts_payable,
-- manual_financial_entries, capital_contributions, or bulk_import_* staging rows.
--
-- Last known row counts (2026-08-09 investigation — verify via dry-run NOTICE):
--   expense_register:              76
--   tax_ledger_entries (expense):  ~40–80 (exact count printed at run time)
--   fixed_assets:                  4  (CAN-ASSET-0002 … CAN-ASSET-0005)
--   accounts_payable (FA-linked):  1  (credit asset CAN-ASSET-0003, GHS 18,500)
--   accounts_payable (other):      reported pre-run; left untouched (not deleted)
--
-- FK prerequisites (handled inside transaction before expense delete):
--   • income_register.cogs_expense_id / cogs_reversal_expense_id → NULL
--   • internal_consumption.expense_register_id → NULL
--   • fixed_assets.accounts_payable_id → NULL (before deleting linked AP rows)
--
-- =============================================================================
-- Balance Sheet projection (August 2026 — HONEST, not guaranteed)
-- =============================================================================
-- BEFORE (2026-08-09 probe, pre-script-192/193):
--   Out of balance:   GHS 112,845.50
--   Cash Position:    GHS -431,078.50
--   Fixed Assets Net: GHS  37,558.93
--   Accounts Payable: GHS  18,500.00 (FA-linked credit purchase)
--
-- EXPECTED directional impact (qualitative — run probe after apply for exact figures):
--   • Removing ALL expense cash outflows should materially improve Cash Position
--     (most of the -431k deficit is paid-expense driven on this tenant).
--   • Removing fixed_assets net book value (~38k) and FA-linked AP (~18.5k) partially
--     offset each other on the balance sheet (asset − liability).
--   • The Jul/Aug structural imbalance (69k → 113k) was predominantly expense-driven;
--     wiping expenses should close most of that gap.
--   • Residual imbalance may remain from:
--       – Inventory asset GHS 1,653.60 without opening-equity offset (Jan–Aug)
--       – Income / tax_ledger / payroll / manual entries not touched by this script
--       – Script 192 capital seed if already applied (balanced pair — no net BS effect)
--
-- CANNOT assert 0.00 out-of-balance without running:
--   npx tsx scripts/probe-dashboard-bs-check-staging.ts --tenant-id 61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b
--
-- =============================================================================

BEGIN;

DO $$
DECLARE
  v_tenant_id uuid := '61e8e5d9-9cdb-4b8d-9e44-ed0acc23d87b';
  v_tenant_name text;

  v_expense_before integer;
  v_expense_ids uuid[];
  v_tax_before integer;
  v_fa_before integer;
  v_ap_total_before integer;
  v_ap_fa_linked_before integer;
  v_ap_other_before integer;
  v_ap_ids uuid[];

  v_income_cogs_refs integer;
  v_income_cogs_rev_refs integer;
  v_consumption_refs integer;

  v_tax_deleted integer;
  v_income_cogs_cleared integer;
  v_income_cogs_rev_cleared integer;
  v_consumption_cleared integer;
  v_expense_deleted integer;
  v_fa_ap_unlinked integer;
  v_ap_deleted integer;
  v_fa_deleted integer;

  v_expense_after integer;
  v_tax_after integer;
  v_fa_after integer;
  v_ap_fa_linked_after integer;
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

  SELECT count(*) INTO v_expense_before
  FROM public.expense_register
  WHERE tenant_id = v_tenant_id;

  SELECT coalesce(array_agg(id ORDER BY id), ARRAY[]::uuid[])
  INTO v_expense_ids
  FROM public.expense_register
  WHERE tenant_id = v_tenant_id;

  SELECT count(*) INTO v_tax_before
  FROM public.tax_ledger_entries
  WHERE tenant_id = v_tenant_id
    AND source_type = 'expense_register'
    AND (
      cardinality(v_expense_ids) = 0
      OR source_id = ANY(v_expense_ids)
    );

  SELECT count(*) INTO v_fa_before
  FROM public.fixed_assets
  WHERE tenant_id = v_tenant_id;

  SELECT count(*) INTO v_ap_total_before
  FROM public.accounts_payable
  WHERE tenant_id = v_tenant_id;

  SELECT count(DISTINCT ap.id) INTO v_ap_fa_linked_before
  FROM public.accounts_payable ap
  INNER JOIN public.fixed_assets fa
    ON fa.accounts_payable_id = ap.id
   AND fa.tenant_id = v_tenant_id
  WHERE ap.tenant_id = v_tenant_id;

  SELECT count(*) INTO v_ap_other_before
  FROM public.accounts_payable ap
  WHERE ap.tenant_id = v_tenant_id
    AND NOT EXISTS (
      SELECT 1
      FROM public.fixed_assets fa
      WHERE fa.accounts_payable_id = ap.id
        AND fa.tenant_id = v_tenant_id
    );

  SELECT coalesce(array_agg(DISTINCT ap.id ORDER BY ap.id), ARRAY[]::uuid[])
  INTO v_ap_ids
  FROM public.accounts_payable ap
  INNER JOIN public.fixed_assets fa
    ON fa.accounts_payable_id = ap.id
   AND fa.tenant_id = v_tenant_id
  WHERE ap.tenant_id = v_tenant_id;

  SELECT count(*) INTO v_income_cogs_refs
  FROM public.income_register
  WHERE tenant_id = v_tenant_id
    AND cogs_expense_id = ANY(v_expense_ids);

  SELECT count(*) INTO v_income_cogs_rev_refs
  FROM public.income_register
  WHERE tenant_id = v_tenant_id
    AND cogs_reversal_expense_id = ANY(v_expense_ids);

  SELECT count(*) INTO v_consumption_refs
  FROM public.internal_consumption
  WHERE tenant_id = v_tenant_id
    AND expense_register_id = ANY(v_expense_ids);

  RAISE NOTICE '=== Caanta full expense + fixed asset reset (script 193) ===';
  RAISE NOTICE 'Tenant: % (%)', v_tenant_name, v_tenant_id;
  RAISE NOTICE 'Database: %', current_database();
  RAISE NOTICE 'expense_register before: %', v_expense_before;
  RAISE NOTICE 'tax_ledger_entries (expense_register) before: %', v_tax_before;
  RAISE NOTICE 'fixed_assets before: %', v_fa_before;
  RAISE NOTICE 'accounts_payable total before: %', v_ap_total_before;
  RAISE NOTICE 'accounts_payable FA-linked before: %', v_ap_fa_linked_before;
  RAISE NOTICE 'accounts_payable NOT FA-linked before: %', v_ap_other_before;
  RAISE NOTICE 'income_register COGS FK refs to delete-set: %', v_income_cogs_refs;
  RAISE NOTICE 'income_register COGS reversal FK refs to delete-set: %', v_income_cogs_rev_refs;
  RAISE NOTICE 'internal_consumption expense FK refs to delete-set: %', v_consumption_refs;

  IF v_expense_before = 0 AND v_fa_before = 0 THEN
    RAISE EXCEPTION 'Nothing to delete — expense_register and fixed_assets already empty for Caanta';
  END IF;

  IF v_expense_before = 0 THEN
    RAISE NOTICE 'expense_register already empty — skipping expense/tax delete steps';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.fixed_assets fa
    WHERE fa.tenant_id = v_tenant_id
      AND fa.accounts_payable_id IS NOT NULL
      AND NOT EXISTS (
        SELECT 1
        FROM public.accounts_payable ap
        WHERE ap.id = fa.accounts_payable_id
          AND ap.tenant_id = v_tenant_id
      )
  ) THEN
    RAISE EXCEPTION 'fixed_assets row(s) reference missing accounts_payable — resolve manually before reset';
  END IF;

  -- -------------------------------------------------------------------------
  -- Step 1: tax_ledger_entries for Caanta expense_register sources
  -- -------------------------------------------------------------------------
  IF v_expense_before > 0 THEN
    DELETE FROM public.tax_ledger_entries
    WHERE tenant_id = v_tenant_id
      AND source_type = 'expense_register'
      AND source_id = ANY(v_expense_ids);
    GET DIAGNOSTICS v_tax_deleted = ROW_COUNT;

    RAISE NOTICE 'Deleted tax_ledger_entries: % (expect %)', v_tax_deleted, v_tax_before;

    IF v_tax_deleted <> v_tax_before THEN
      RAISE EXCEPTION 'tax_ledger delete count % != expected %', v_tax_deleted, v_tax_before;
    END IF;

    -- Clear FK blockers before expense_register delete
    UPDATE public.income_register
    SET cogs_expense_id = NULL
    WHERE tenant_id = v_tenant_id
      AND cogs_expense_id = ANY(v_expense_ids);
    GET DIAGNOSTICS v_income_cogs_cleared = ROW_COUNT;

    UPDATE public.income_register
    SET cogs_reversal_expense_id = NULL
    WHERE tenant_id = v_tenant_id
      AND cogs_reversal_expense_id = ANY(v_expense_ids);
    GET DIAGNOSTICS v_income_cogs_rev_cleared = ROW_COUNT;

    UPDATE public.internal_consumption
    SET expense_register_id = NULL
    WHERE tenant_id = v_tenant_id
      AND expense_register_id = ANY(v_expense_ids);
    GET DIAGNOSTICS v_consumption_cleared = ROW_COUNT;

    RAISE NOTICE 'Cleared income_register.cogs_expense_id: %', v_income_cogs_cleared;
    RAISE NOTICE 'Cleared income_register.cogs_reversal_expense_id: %', v_income_cogs_rev_cleared;
    RAISE NOTICE 'Cleared internal_consumption.expense_register_id: %', v_consumption_cleared;

    -- -------------------------------------------------------------------------
    -- Step 2: ALL expense_register for Caanta
    -- -------------------------------------------------------------------------
    DELETE FROM public.expense_register
    WHERE tenant_id = v_tenant_id;
    GET DIAGNOSTICS v_expense_deleted = ROW_COUNT;

    RAISE NOTICE 'Deleted expense_register: % (expect %)', v_expense_deleted, v_expense_before;

    IF v_expense_deleted <> v_expense_before THEN
      RAISE EXCEPTION 'expense_register delete count % != expected %', v_expense_deleted, v_expense_before;
    END IF;
  ELSE
    v_tax_deleted := 0;
    v_income_cogs_cleared := 0;
    v_income_cogs_rev_cleared := 0;
    v_consumption_cleared := 0;
    v_expense_deleted := 0;
  END IF;

  -- -------------------------------------------------------------------------
  -- Step 3: FA-linked accounts_payable only (unlink FK first)
  -- -------------------------------------------------------------------------
  IF v_fa_before > 0 THEN
    UPDATE public.fixed_assets
    SET accounts_payable_id = NULL
    WHERE tenant_id = v_tenant_id
      AND accounts_payable_id IS NOT NULL;
    GET DIAGNOSTICS v_fa_ap_unlinked = ROW_COUNT;

    RAISE NOTICE 'Unlinked fixed_assets.accounts_payable_id rows: %', v_fa_ap_unlinked;

    IF cardinality(v_ap_ids) > 0 THEN
      DELETE FROM public.accounts_payable
      WHERE tenant_id = v_tenant_id
        AND id = ANY(v_ap_ids);
      GET DIAGNOSTICS v_ap_deleted = ROW_COUNT;

      RAISE NOTICE 'Deleted FA-linked accounts_payable: % (expect %)', v_ap_deleted, v_ap_fa_linked_before;

      IF v_ap_deleted <> v_ap_fa_linked_before THEN
        RAISE EXCEPTION 'accounts_payable delete count % != expected %', v_ap_deleted, v_ap_fa_linked_before;
      END IF;
    ELSE
      v_ap_deleted := 0;
      RAISE NOTICE 'Deleted FA-linked accounts_payable: 0 (none linked)';
    END IF;

    -- -------------------------------------------------------------------------
    -- Step 4: ALL fixed_assets for Caanta
    -- -------------------------------------------------------------------------
    DELETE FROM public.fixed_assets
    WHERE tenant_id = v_tenant_id;
    GET DIAGNOSTICS v_fa_deleted = ROW_COUNT;

    RAISE NOTICE 'Deleted fixed_assets: % (expect %)', v_fa_deleted, v_fa_before;

    IF v_fa_deleted <> v_fa_before THEN
      RAISE EXCEPTION 'fixed_assets delete count % != expected %', v_fa_deleted, v_fa_before;
    END IF;
  ELSE
    v_fa_ap_unlinked := 0;
    v_ap_deleted := 0;
    v_fa_deleted := 0;
    RAISE NOTICE 'fixed_assets already empty — skipping FA/AP delete steps';
  END IF;

  -- -------------------------------------------------------------------------
  -- Post-checks
  -- -------------------------------------------------------------------------
  SELECT count(*) INTO v_expense_after
  FROM public.expense_register
  WHERE tenant_id = v_tenant_id;

  SELECT count(*) INTO v_tax_after
  FROM public.tax_ledger_entries
  WHERE tenant_id = v_tenant_id
    AND source_type = 'expense_register';

  SELECT count(*) INTO v_fa_after
  FROM public.fixed_assets
  WHERE tenant_id = v_tenant_id;

  SELECT count(DISTINCT ap.id) INTO v_ap_fa_linked_after
  FROM public.accounts_payable ap
  INNER JOIN public.fixed_assets fa
    ON fa.accounts_payable_id = ap.id
   AND fa.tenant_id = v_tenant_id
  WHERE ap.tenant_id = v_tenant_id;

  RAISE NOTICE '=== Post-delete counts ===';
  RAISE NOTICE 'expense_register after: % (expect 0)', v_expense_after;
  RAISE NOTICE 'tax_ledger_entries expense after: % (expect 0)', v_tax_after;
  RAISE NOTICE 'fixed_assets after: % (expect 0)', v_fa_after;
  RAISE NOTICE 'accounts_payable FA-linked after: % (expect 0)', v_ap_fa_linked_after;
  RAISE NOTICE 'accounts_payable NOT FA-linked (untouched): %', v_ap_other_before;

  IF v_expense_after <> 0 OR v_tax_after <> 0 OR v_fa_after <> 0 OR v_ap_fa_linked_after <> 0 THEN
    RAISE EXCEPTION 'Post-delete verification failed (expense=% tax=% fa=% ap_fa=%)',
      v_expense_after, v_tax_after, v_fa_after, v_ap_fa_linked_after;
  END IF;

  RAISE NOTICE '=== Done — run BS probe for exact Cash / Out-of-balance after figures ===';
END $$;

COMMIT;
-- ROLLBACK;  -- uncomment for dry run instead of COMMIT

NOTIFY pgrst, 'reload schema';
