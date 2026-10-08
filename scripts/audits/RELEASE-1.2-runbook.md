# Release 1.2 production runbook

**Scope:** App changes (Cancel sale UX, form saving-state hygiene, returned-sale cancel guard) plus numbered migrations **375 → 376** when not already on production.

**Rules:** Production database backup before migrations. Each SQL file uses `BEGIN` / `COMMIT`. Staging re-apply: `npx tsx scripts/apply-376-void-block-returned-staging.ts` (staging only).

---

## 1. Migration order (production)

| # | File | Purpose |
|---|------|---------|
| 1 | `scripts/375_compassionate_leave_types.sql` | Only if not already applied on production |
| 2 | `scripts/376_void_product_sale_block_returned_sales.sql` | Block `void_product_sale` when sale has full/partial product returns (prevents double stock/COGS reversal) |

**377:** none in repo (gap is intentional after removed 376 seed).

**Success check for 376:** `void_product_sale` body includes `Nothing left to cancel` and `partly returned`.

---

## 2. Pre-deploy (staging sign-off)

- Caanta RET-VOID test artifacts removed (`scripts/cleanup-ret-void-test-caanta-staging.ts`).
- `npx tsx scripts/audits/readonly-caanta-bs-all-scopes.ts --env-file .env.staging.local` — Jul–Dec 2026 **0.00** all scopes.
- `npx tsx scripts/audits/readonly-davors-bs-all-scopes.ts --env-file .env.staging.local` — Jul–Dec within known staging tolerance (Facilities Oct–Dec micro-gap if pre-existing).
- Sales register: returned receipts hide/disable Cancel per returned qty; RPC rejects cancel on returned lines.

---

## 3. Deploy app

1. Commit + push Release 1.2 branch (include app + `376` SQL; exclude staging-only cleanup scripts unless you want them in repo for ops).
2. Deploy production build from that commit.

---

## 4. Post-deploy verification

- `scripts/probe-returned-and-voided-sales-production-readonly.ts` — expect **0** returned+voided product sales (historical double reversals).
- UI smoke: Sales register returned status, Cancel tooltips, expense/income forms clear “Saving…” after save.
- BS integrity cron / Davors scopes per Release 1 checklist.

See also: `scripts/audits/RELEASE-1-runbook.md` for Release 1 baseline migrations (362–369, 372–374).
