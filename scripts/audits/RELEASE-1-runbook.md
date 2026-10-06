# Release 1 runbook (migrations 362–369 + app deploy)

**Scope:** Schema and RPC/trigger changes only at migrate time, except **362** one-time `production_batches.remaining_quantity` backfill. **No** 370, 371, or repair scripts. **No data repair scripts.**

Apply in order on **staging first**, then **production** after sign-off. Use Supabase SQL editor or `psql` with service role / migration runner. Each file is wrapped in `BEGIN`/`COMMIT`.

---

## Migration order

| # | File | One-line purpose | Depends on |
|---|------|------------------|------------|
| 1 | `scripts/362_production_batch_ic_mutations.sql` | Production batch + internal consumption edit/delete RPCs; `remaining_quantity` on batches; inventory month guard. | Prior inventory/batch RPCs (276+, 273+) |
| 2 | `scripts/363_bulk_import_product_opening_stock.sql` | Bulk-import opening FP stock helper + optional lot-date `product_purchases` shell rows. | 276 `record_finished_product_manual_adjustment` |
| 3 | `scripts/364_fp_adjustment_lot_dates_bulk_import.sql` | FP manual adjustments with lot/manufacturing/expiration dates for bulk import. | 363, lot columns on purchases |
| 4 | `scripts/365_inventory_stock_adjustment_balancing.sql` | `inventory_stock_adjustment_register_links` + P&L/register balancing for FP stock adjustments. | — |
| 5 | `scripts/366_raw_material_stock_adjustment_balancing.sql` | RM manual adjustments with BU-scoped balance updates (mirrors FP balancing pattern). | 365 pattern / RM balances |
| 6 | `scripts/367_finished_product_wac_restock_guard.sql` | Scoped WAC formula + restock-at-unit-cost guard; sale path balance WAC updates. | Multi-BU balances (268+) |
| 7 | `scripts/368_product_return_restock_wac.sql` | POS/product return, restock, and WAC-aware credit note flow. | 367 |
| 8 | `scripts/369_create_product_sale_bu_scoped_cogs.sql` | Product sale RPC: BU-scoped COGS with tenant-wide WAC fallback when scoped ≤ 0. | 367 |

**Not in Release 1:** `370_inventory_bu_wac_hygiene.sql`, `371_zero_cogs_historical_repair.sql`, anything under `scripts/repairs/` or `scripts/audits/` (read-only).

---

## Rollback notes (emergency)

SQL migrations replace functions in place. Rollback = re-apply **previous function definitions** from the last known-good migration in git (e.g. pre-362 batch RPCs from 273/276). **362 column:** `remaining_quantity` can remain; app may ignore. **365 table:** dropping `inventory_stock_adjustment_register_links` loses link metadata — avoid unless no adjustments used yet.

| Migration | Rollback approach |
|-----------|-------------------|
| **362** | Restore prior `update_production_batch`, IC delete/edit, create batch RPCs from git parent; optional `ALTER TABLE production_batches DROP COLUMN remaining_quantity` if unused. |
| **363** | `DROP FUNCTION apply_bulk_import_finished_product_opening(...)` (signature match). |
| **364** | Restore prior FP adjustment RPC from git. |
| **365** | Drop triggers/policies on register links; `DROP TABLE inventory_stock_adjustment_register_links`; restore prior adjustment posting RPCs. |
| **366** | Restore prior `record_raw_material_manual_adjustment` from git. |
| **367** | Restore prior `finished_product_weighted_avg_cost_scoped` and restock/sale helpers from git (268/276). |
| **368** | Restore prior return/restock RPC from git. |
| **369** | Restore prior `create_product_sale` (or equivalent) from git. |

Always test rollback on **staging** first. Redeploy **previous app build** if RPC signatures changed.

---

## Production verification (after app + DB deploy)

Read-only unless noted.

1. **Balance Sheet — Davors (all scopes)**  
   `npx tsx scripts/audits/readonly-davors-bs-all-scopes.ts --env-file .env.local.production-backup-2026-08-25`  
   **Gate:** Jul–Dec 2026 every scope **0.00** balance difference (or no scope **worse** than pre-deploy baseline).

2. **Balance Sheet — all tenants vs origin/main**  
   `npx tsx scripts/audits/bs-grid-snapshot.ts --code-root .worktrees/origin-main-bs --out scripts/audits/output/bs-grid-before-origin-main.json`  
   `npx tsx scripts/audits/bs-grid-snapshot.ts --out scripts/audits/output/bs-grid-after-release1.json`  
   `npx tsx scripts/audits/compare-bs-grids.ts` (point BEFORE/AFTER paths at those files if needed).  
   **Gate:** `anyScopeWorse: false`.

3. **Nightly / integrity check**  
   Run existing balance-sheet integrity job or cron used in production (owner dashboard banner / scheduled probe). Confirm no new tenant-scope parity failures.

4. **Zero-BU tenant — COGS on sale**  
   On a **zero–business-unit** tenant with stock (e.g. Caanta or Nextronics): record one **test product sale** or POS sale in a controlled window (or staging mirror).  
   **Gate:** linked COGS expense **> 0** when product has cost history; invoice notes may show `[COGS_WARNING:zero unit cost at sale]` only when cost truly missing.

5. **Multi-BU tenant — Davors**  
   Smoke: production batch save, FP adjustment, product purchase with BU selected — no SQL errors.

6. **Post-365 audit (after 365 applied on prod)**  
   `scripts/audits/stock_adjustments_missing_balancing.sql` — expect manageable row count; repair deferred to Release 2.

---

## Staging rehearsal (recommended)

1. Apply 362→369 in order on staging.  
2. Deploy Release 1 app build.  
3. Run Davors all-scopes script with `.env.staging.local`.  
4. Optional: `negative_wac` / zero-COGS audits (read-only).

---

## App deploy checklist

- Release 1 branch includes: director’s loan **no Fix A** on BS load; migration transaction fix in `migrate-directors-loan-ledger.ts` (for future use); **temporary** `zero-bu-finished-product-wac.ts` until Release 2.  
- **Do not** apply 370/371 on production in Release 1.
