# Release 1 production runbook

**Scope:** Numbered migrations **362 → 369**, then **372 → 374** (11 SQL files), plus the **Release 1 app build** that depends on them.  
**Not in this release:** `370`, `371`, `353`, anything under `scripts/repairs/`, `scripts/staging-only/` (staging rehearsal / data fixes only), or `scripts/audits/` (read-only tooling).

**Rules:** Take a **production database backup** before any migration. Run migrations in order. Each numbered file is wrapped in **`BEGIN` / `COMMIT`** (single transaction). Staging-only re-apply helpers are **not** required on production when the tree’s numbered files are current.

---

## 0. Pre-flight (production, read-only)

1. **Supabase / Postgres backup** — snapshot or PITR baseline; note backup ID and time.
2. **Policy tenant-scope guard** (expected **0 rows**):
   - SQL: `scripts/audits/policy_tenant_scope_guard.sql`
   - Or: `npm run audit:tenant-rls` with production env (`--any-project` if using backup env file)
3. **Object pre-check** (expected absent pre-migrate):
   - `npx tsx scripts/audits/readonly-release1-production-object-precheck.ts --env-file .env.local.production-backup-2026-08-25`
   - `inventory_stock_adjustment_register_links`, `salary_advance_register` → **missing**
   - `save_salary_advances_bulk`, `update_production_batch`, `assert_inventory_month_open` → **not found** (prior prod RPCs unchanged until 362/373 apply)
4. **Balance Sheet grid dry-run** (code-only; DB unchanged):
   - Extract `origin/main` app code (e.g. `git archive origin/main | tar -x -C .worktrees/origin-main-bs`)
   - `npx tsx scripts/audits/bs-grid-snapshot.ts --code-root .worktrees/origin-main-bs --out scripts/audits/output/bs-grid-before-origin-main.json`
   - `npx tsx scripts/audits/bs-grid-snapshot.ts --out scripts/audits/output/bs-grid-after-working-tree.json`
   - `npx tsx scripts/audits/compare-bs-grids.ts` — **Gate:** `anyScopeWorse: false` (all tenants, all scopes, Jan–Dec 2026, tolerance 0.005).

---

## 1. Migration order and success criteria

Apply on **production** in this exact order via SQL editor or `psql`. After **each** file: no error, transaction committed. Spot-check as noted.

| # | File | Success looks like |
|---|------|-------------------|
| 1 | `scripts/362_production_batch_ic_mutations.sql` | `production_batches.remaining_quantity` populated; RPCs `update_production_batch`, IC edit/delete, batch create paths exist; `GRANT EXECUTE` on `update_production_batch` to `authenticated`. |
| 2 | `scripts/363_bulk_import_product_opening_stock.sql` | Function `apply_bulk_import_finished_product_opening` (signature per file) exists. |
| 3 | `scripts/364_fp_adjustment_lot_dates_bulk_import.sql` | FP manual adjustment RPC accepts lot/MFG/expiry fields (function replaced). |
| 4 | `scripts/365_inventory_stock_adjustment_balancing.sql` | Table `inventory_stock_adjustment_register_links` exists with RLS policies; FP/RM adjustment triggers post/reverse register links. |
| 5 | `scripts/366_raw_material_stock_adjustment_balancing.sql` | `record_raw_material_manual_adjustment` replaced; RM adjustments balance BU stock. |
| 6 | `scripts/367_finished_product_wac_restock_guard.sql` | Scoped WAC helpers + `finished_product_balances_wac_non_negative` trigger active. |
| 7 | `scripts/368_product_return_restock_wac.sql` | Return/restock / credit-note RPCs replaced without error. |
| 8 | `scripts/369_create_product_sale_bu_scoped_cogs.sql` | `create_product_sale` (or equivalent) uses BU-scoped COGS + tenant WAC fallback. |
| 9 | `scripts/372_salary_advance_register.sql` | Table `salary_advance_register` + indexes + RLS (`tenant_matches`; `super_admin_full_access` **with** tenant scope). |
| 10 | `scripts/373_salary_advance_mutations.sql` | RPCs `save_salary_advances_bulk`, `update_salary_advance`, `delete_salary_advance` + `_salary_advance_parse_payroll_month` exist. |
| 11 | `scripts/374_salary_advance_payroll_lock.sql` | Payroll lock finance hooks advance deduction; maternity leave type/policy seed; `resolve_leave_entitlement` / leave submit overlap updates applied. |

**Re-run safety:** All 11 files use `CREATE OR REPLACE` for functions, `IF NOT EXISTS` for tables/indexes, `DROP POLICY/TRIGGER IF EXISTS` before create where policies/triggers are defined. **362** re-applies a one-time `UPDATE` backfill (`remaining_quantity` only where NULL) — safe to repeat. **374** uses `INSERT … WHERE NOT EXISTS` and `DROP CONSTRAINT IF EXISTS` before `ADD CONSTRAINT` — safe to repeat. **372** uses `CREATE TABLE IF NOT EXISTS` (will not alter an existing divergent schema — pre-check should show absent table on prod).

---

## 2. Policy guard (post-migration, read-only)

Re-run **policy tenant-scope guard** — still **0 rows**.  
`npm run audit:tenant-rls` on production — **PASS**.

---

## 3. Deploy app

1. **Commit + push** Release 1 branch (exclude paths in §5 below).
2. Deploy production app build (Vercel/hosting) from that commit.
3. Confirm env vars unchanged (`DATABASE_URL` / `SUPABASE_DB_PASSWORD` for nightly policy guard on cron).

---

## 4. Post-deploy verification (read-only unless smoke)

| Step | Command / action | Gate |
|------|------------------|------|
| Davors BS all scopes | `npx tsx scripts/audits/readonly-davors-bs-all-scopes.ts --env-file .env.local.production-backup-2026-08-25` | Jul–Dec 2026 every scope **0.00** max abs diff (or no worse than pre-deploy); **rounding:** differences within **±0.005** count as balanced. |
| Davors Facilities Oct cash | UI: Finance → Balance Sheet → Facilities → Oct 2026 **Cash Position**; or `readonly-davors-facilities-oct2026` audit | Matches known baseline (e.g. **−22,645.85** GHS after Release 1 code; verify against your sign-off note). |
| Nightly integrity | Trigger `/api/cron/balance-sheet-integrity` or wait for schedule | No new failures; `policy-tenant-scope-guard` event **success**. |
| Zero-BU COGS (customers) | `scripts/audits/readonly-zero-bu-product-sale-cogs-post-deploy.sql` | **Zero rows** for bad recent sales; no customer tenant logins. |
| Loans & Advances | HR → Loans & Advances load/save (Davors smoke) | No cross-tenant rows; refetch scoped. |
| Internal use / stock adj. | Inventory internal consumption + FP/RM stock adjustment smoke | No SQL errors; BS unchanged aside from intentional test (prefer staging for destructive tests). |
| BS grid vs origin/main | Re-run §0.4 snapshots **after** deploy if code changed again | `anyScopeWorse: false` |

---

## 5. Do not commit

| Path | Reason |
|------|--------|
| `scripts/353_function_search_path_hygiene.sql` | Out of Release 1; separate hygiene batch |
| `scripts/370_*`, `scripts/371_*` | Post–Release 1 |
| `scripts/staging-only/` | Staging data fixes, re-apply wrappers, test users |
| `scripts/audits/output/` | Generated BS grids / compare JSON |
| `.worktrees/` | Local origin/main extract for audits |
| `.cursor-*.txt`, `backups/`, `.env*` | Local / secrets / scratch |
| Production data dumps (`dfoms-pre-phase1-backup.sql`, etc.) | Already in `.gitignore` |

**.gitignore** already covers: `.env*`, `.worktrees/`, `.cursor-*.txt`, `scripts/audits/output/`, `scripts/_*`, `backups/`.

---

## 6. Staging-only vs production (exceptions)

Production needs **only** the 11 numbered files above. Staging may also have used:

| Staging-only | Production? |
|--------------|-------------|
| `salary_advance_register_rls_tenant_scope_backfill.sql` | **No** — corrected **372** includes tenant-scoped `super_admin_full_access`. |
| `apply-362-update-batch-grant-staging.ts` | **No** — grant is in **362**. |
| `apply-365-*`, `apply-373-*`, `apply-374-maternity-delta-*`, `apply-PART2-*` | **No** — re-run numbered SQL on staging only. |
| Davors/Caanta data fixes (`fix-non-cash-*`, resync stock, delete test IC, etc.) | **No** — tenant-specific staging cleanup. |

---

## 7. Rollback notes (emergency)

SQL migrations replace functions in place. Rollback = restore **previous function definitions** from last known-good migration in git. Redeploy **previous app build** if RPC signatures changed.

| Migration | Rollback approach |
|-----------|-------------------|
| **362** | Restore prior batch/IC RPCs from git parent; optional `DROP COLUMN remaining_quantity` if unused. |
| **363** | `DROP FUNCTION` for bulk opening import (match signature). |
| **364** | Restore prior FP adjustment RPC. |
| **365** | Drop triggers/policies; `DROP TABLE inventory_stock_adjustment_register_links`; restore prior adjustment RPCs. |
| **366** | Restore prior `record_raw_material_manual_adjustment`. |
| **367** | Restore prior WAC/restock/sale helpers. |
| **368** | Restore prior return/restock RPC. |
| **369** | Restore prior `create_product_sale`. |
| **372** | `DROP TABLE salary_advance_register` (loses advance rows if any). |
| **373** | Restore prior advance RPCs or drop if 372 rolled back. |
| **374** | Restore prior payroll lock / leave functions from git parent; maternity seeds can remain. |

Always test rollback on **staging** first.

---

## 8. Staging rehearsal (already complete)

Staging UI testing for Release 1 passed. Production follows §0–§4 above.
