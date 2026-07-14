-- Script 57: Fix delete_finished_product_cascade FK order
-- income_register and internal_consumption must release expense_register FKs
-- before expense rows are deleted.

BEGIN;

CREATE OR REPLACE FUNCTION delete_finished_product_cascade(p_product_id UUID)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_sale RECORD;
  v_consumption RECORD;
  v_batch RECORD;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM finished_products WHERE id = p_product_id) THEN
    RAISE EXCEPTION 'Finished product % not found', p_product_id;
  END IF;

  FOR v_sale IN
    SELECT id, sale_status
    FROM income_register
    WHERE product_id = p_product_id
      AND entry_type = 'product_sale'
    ORDER BY date, id
  LOOP
    IF v_sale.sale_status IS DISTINCT FROM 'voided' THEN
      PERFORM void_product_sale(v_sale.id);
    END IF;
  END LOOP;

  FOR v_sale IN
    SELECT id, cogs_expense_id, cogs_reversal_expense_id
    FROM income_register
    WHERE product_id = p_product_id
      AND entry_type = 'product_sale'
  LOOP
    DELETE FROM stock_movements
    WHERE reference_id = v_sale.id;

    UPDATE income_register
    SET cogs_expense_id = NULL,
        cogs_reversal_expense_id = NULL
    WHERE id = v_sale.id;

    IF v_sale.cogs_reversal_expense_id IS NOT NULL THEN
      DELETE FROM expense_register WHERE id = v_sale.cogs_reversal_expense_id;
    END IF;
    IF v_sale.cogs_expense_id IS NOT NULL THEN
      DELETE FROM expense_register WHERE id = v_sale.cogs_expense_id;
    END IF;

    DELETE FROM income_register WHERE id = v_sale.id;
  END LOOP;

  FOR v_consumption IN
    SELECT id, expense_register_id
    FROM internal_consumption
    WHERE product_id = p_product_id
    ORDER BY consumption_date, id
  LOOP
    DELETE FROM stock_movements WHERE reference_id = v_consumption.id;

    UPDATE internal_consumption
    SET expense_register_id = NULL
    WHERE id = v_consumption.id;

    IF v_consumption.expense_register_id IS NOT NULL THEN
      DELETE FROM expense_register WHERE id = v_consumption.expense_register_id;
    END IF;

    DELETE FROM internal_consumption WHERE id = v_consumption.id;
  END LOOP;

  FOR v_batch IN
    SELECT id
    FROM production_batches
    WHERE finished_product_id = p_product_id
    ORDER BY production_date, id
  LOOP
    DELETE FROM production_batch_materials WHERE batch_id = v_batch.id;
    DELETE FROM stock_movements WHERE reference_id = v_batch.id;
    DELETE FROM production_batches WHERE id = v_batch.id;
  END LOOP;

  DELETE FROM stock_movements WHERE product_id = p_product_id;
  DELETE FROM finished_products WHERE id = p_product_id;
END;
$$;

GRANT EXECUTE ON FUNCTION delete_finished_product_cascade(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION delete_finished_product_cascade(UUID) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
