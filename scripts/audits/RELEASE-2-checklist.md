# Release 2 checklist (370 + 371 + data repairs)

**Customer tenants are read-only to Davors staff.** Do not log into Nextronics, Mimshack, Caanta, or other customer accounts. All verification uses read-only SQL/scripts and customer notification before any figure changes.

## Per-tenant data repair workflow (required)

For **every** customer data repair below:

1. **Dry-run (read-only)** — Run the approved dry-run script/SQL first. Output must list **exactly** which rows/amounts would change. **Stop for approval** before any write.
2. **Post-check (read-only)** — After repair (executed by automation/service role, not by logging into the customer UI), run that tenant’s Balance Sheet status **per scope** (same read-only audits as production verification).
3. **Customer notification** — Notify the customer **before** their published figures change. Document date/channel in the repair ticket.

| Tenant / item | Dry-run | Post-check | Notify before change |
|---------------|---------|------------|----------------------|
| **Nextronics** — GHS 55 BS gap + cost corrections | `scripts/audits/dry-run-*` / repair dry-run per `scripts/repairs/` | BS grid / scope checks for Nextronics tenant id | Yes — explain GHS 55 fix and COGS/cost corrections |
| **Mimshack** — cost corrections | Dry-run listing row-level COGS/WAC changes | Read-only BS per scope | Yes |
| **Caanta** — cost corrections | Dry-run listing row-level COGS/WAC changes | Read-only BS per scope | Yes |

## Checklist

- [ ] **370 on production** + WAC recompute (6 rows approved in principle; stored values are stale, formula correct). Re-run `scripts/audits/dry-run-370-wac-recompute-production.ts` immediately before applying.
- [ ] **Remove** temporary zero-BU WAC helper: `lib/inventory/zero-bu-finished-product-wac.ts` and merge logic in `balance-sheet-page-data.ts` (after 370 on production — single DB cost source).
- [ ] **371** + zero-COGS repairs per tenant (dry-run first; see `scripts/371_zero_cogs_historical_repair.sql` and `scripts/repairs/`).
- [ ] **Nextronics GHS 55:** `NEXTR-FP-0033` October COGS vs inventory history alignment. Fix in code only — no BU creation, no retagging. Follow per-tenant workflow above.
- [ ] **`negative_wac_and_inventory_mismatch`:** 7 production rows (Caanta 1, Mimshack 1, Nextronics 5) — repair/recompute after 370. Dry-run + notify per tenant.
- [ ] Re-run **`scripts/audits/stock_adjustments_missing_balancing.sql`** on production after migration **365** is applied.
- [ ] **Zero-BU verification (read-only):** `scripts/audits/readonly-zero-bu-product-sale-cogs-post-deploy.sql` + nightly zero-COGS counts — **no** test sales logged in customer accounts.
- [ ] **Davors 0.01 / 0.02:** line-by-line sub-cent source on Balance Sheet (not a Release 1 rounding change).
- [ ] **UI:** “Saving to: [business name]” on save forms.
- [ ] Run repair scripts under `scripts/repairs/` with dry-run first; **no step requires logging into a customer account**.
- [ ] Reference: `output/wac-row-derivations-production.json`, `output/nextronics-oct-55-trace-production.json`.
