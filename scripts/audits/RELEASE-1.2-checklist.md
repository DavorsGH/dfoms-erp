# Release 1.2 checklist

## Database (production order)

- [ ] Backup production Postgres
- [ ] Apply `375_compassionate_leave_types.sql` if missing on production
- [ ] Apply `376_void_product_sale_block_returned_sales.sql`
- [ ] Confirm `void_product_sale` guards returned sales (spot-check function def)

## App / UX

- [ ] Cancel sale wording (not Void) on receipts/invoices/registers
- [ ] Fully returned sales: no active Cancel (or blocked with tooltip)
- [ ] Partly returned sales: Cancel blocked with “return remaining items” tooltip
- [ ] Form submit buttons: loading cleared in `finally` + on open/close (Step 86 modules)

## Verification

- [ ] `npx tsc --noEmit` and `npm run build`
- [ ] Production read-only: no returned+voided product sales
- [ ] Staging: Caanta/Davors BS Jul–Dec scopes per runbook

## Staging-only (do not run on production)

- [ ] `cleanup-ret-void-test-caanta-staging.ts`
- [ ] `apply-376-void-block-returned-staging.ts` (rehearsal only if prod SQL applied via editor)
