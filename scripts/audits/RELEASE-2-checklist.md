# Release 2 checklist (370 + 371 + data repairs)

- [ ] **370 on production** + WAC recompute (6 rows approved in principle; stored values are stale, formula correct). Re-run `scripts/audits/dry-run-370-wac-recompute-production.ts` immediately before applying.
- [ ] **Remove** temporary zero-BU WAC helper: `lib/inventory/zero-bu-finished-product-wac.ts` and merge logic in `balance-sheet-page-data.ts` (after 370 on production — single DB cost source).
- [ ] **371** + zero-COGS repairs per tenant (dry-run first; see `scripts/371_zero_cogs_historical_repair.sql` and `scripts/repairs/`).
- [ ] **Nextronics GHS 55:** `NEXTR-FP-0033` October COGS vs inventory history alignment. Fix in code only — no BU creation, no retagging.
- [ ] **`negative_wac_and_inventory_mismatch`:** 7 production rows (Caanta 1, Mimshack 1, Nextronics 5) — repair/recompute after 370.
- [ ] Re-run **`scripts/audits/stock_adjustments_missing_balancing.sql`** on production after migration **365** is applied.
- [ ] **Zero-BU staging test tenant** with real stock: POS sale, product sale, purchase, production batch, stock adjustment, Balance Sheet (post-370).
- [ ] **Davors 0.01 / 0.02:** line-by-line sub-cent source on Balance Sheet (not a Release 1 rounding change).
- [ ] **UI:** “Saving to: [business name]” on save forms.
- [ ] Run repair scripts under `scripts/repairs/` with dry-run first.
- [ ] Reference: `output/wac-row-derivations-production.json`, `output/nextronics-oct-55-trace-production.json`.
