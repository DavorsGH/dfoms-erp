/**
 * Staging checklist for scripts/362_production_batch_ic_mutations.sql
 *
 * Prerequisites: apply migration 362 on staging; inventory edit role user.
 *
 * This script prints the manual test checklist (no DB credentials required).
 */
console.log(`
362 inventory mutations — manual staging tests

Apply first:
  psql $DATABASE_URL -f scripts/362_production_batch_ic_mutations.sql

1. Batch create → edit (no outbound stock use)
   - Create a production batch for a finished product in BU A; note production_date.
   - Do not sell, consume, or adjust that product down in BU A on/after that date.
   - Expect: preview_production_batch_edit.can_edit = true; Edit saves via update_production_batch.

2. Product sale after batch (POS or Product Sales — not batch-linked)
   - create_product_sale / POS checkout writes stock_movements.sale_out only (no sale_batch_allocations).
   - Sell the same finished product in the same BU on or after the batch production_date.
   - Expect: Edit disabled; block_reason like:
     "This batch can't be edited because <Product name> stock has been used since it was produced (1 sale on or after <date>)."

3. Internal consumption after batch (product-level, not batch-linked)
   - Record internal consumption for the same product/BU on or after the batch production_date.
   - Expect: Edit disabled; block_reason mentions internal use(s).

4. Batch allocation guard (when sale_batch_allocations / remaining_quantity are used)
   - If a sale or return flow allocates against this batch (remaining_quantity < quantity_produced),
     expect edit blocked even when product-level counts are ambiguous.

5. Manual stock adjustment down
   - finished_product_stock_adjustments with negative quantity_delta (write-off / correction down)
     in the same BU after the batch was created.
   - Expect: Edit disabled; block_reason mentions stock adjustment(s) down.

6. Internal consumption edit/delete (362 RPCs)
   - Record IC entry post go-live; edit quantity/date; delete; verify stock and expense.

7. Closed month
   - Lock month in month_end_close; expect friendly error on batch edit/delete.

8. Balance sheet
   - Dashboard BS integrity banner unchanged after each mutation.
`);
