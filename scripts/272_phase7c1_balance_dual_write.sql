-- Phase 7c.1 — balance dual-write + BU stamps (DRAFT / REVIEW ONLY)
-- Source: live staging defs as of 7c.1 dump.
-- Do NOT apply until approved. Purely additive dual-write / stamping.
--
-- Touches:
--   1. update_product_purchase
--   2. void_product_sale
--   3. delete_production_batch
--   4. resolve_offline_sale_conflict (Action B shortfall invent-stock only)

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. update_product_purchase
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.update_product_purchase(
  p_purchase_id uuid,
  p_purchase_date date,
  p_quantity numeric,
  p_cost_per_unit numeric,
  p_supplier_id uuid,
  p_payment_method text,
  p_notes text
)
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  v_purchase product_purchases%ROWTYPE;
  v_total_cost NUMERIC(18, 4);
  v_supplier_name TEXT;
  v_qty_delta NUMERIC(18, 4);
  v_current_stock NUMERIC(18, 4);
BEGIN
  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'Quantity must be greater than zero';
  END IF;

  IF p_cost_per_unit IS NULL OR p_cost_per_unit < 0 THEN
    RAISE EXCEPTION 'Cost per unit must be zero or greater';
  END IF;

  IF p_payment_method IS NULL OR TRIM(p_payment_method) = '' THEN
    RAISE EXCEPTION 'Payment method is required for product purchases';
  END IF;

  SELECT *
  INTO v_purchase
  FROM product_purchases
  WHERE id = p_purchase_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product purchase % not found', p_purchase_id;
  END IF;

  v_total_cost := ROUND(p_quantity * p_cost_per_unit, 4);
  v_qty_delta := p_quantity - v_purchase.quantity;

  IF v_qty_delta <> 0 THEN
    SELECT current_stock
    INTO v_current_stock
    FROM finished_products
    WHERE id = v_purchase.product_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Finished product not found';
    END IF;

    IF v_current_stock + v_qty_delta < 0 THEN
      RAISE EXCEPTION
        'Cannot save changes — only % in stock after adjusting this purchase',
        TRIM(TRAILING '.' FROM TRIM(TRAILING '0' FROM v_current_stock::TEXT));
    END IF;

    UPDATE finished_products
    SET
      current_stock = current_stock + v_qty_delta,
      updated_at = now()
    WHERE id = v_purchase.product_id;

    -- 7c.1: dual-write finished_product_balances for this purchase's BU
    PERFORM public.adjust_finished_product_balance_qty(
      v_purchase.tenant_id,
      v_purchase.product_id,
      v_purchase.business_unit_id,
      v_qty_delta
    );

    UPDATE stock_movements
    SET
      quantity = p_quantity,
      movement_date = p_purchase_date,
      notes = COALESCE(
        NULLIF(TRIM(p_notes), ''),
        notes
      )
    WHERE reference_id = p_purchase_id
      AND movement_type = 'purchase_in'
      AND product_id = v_purchase.product_id;
  END IF;

  IF p_supplier_id IS NOT NULL THEN
    SELECT name INTO v_supplier_name FROM suppliers WHERE id = p_supplier_id;
  END IF;

  PERFORM sync_product_purchase_payable(
    p_purchase_id,
    v_purchase.product_id,
    p_purchase_date,
    v_supplier_name,
    p_payment_method,
    v_total_cost,
    v_purchase.accounts_payable_id
  );

  UPDATE product_purchases
  SET
    purchase_date = p_purchase_date,
    quantity = p_quantity,
    cost_per_unit = p_cost_per_unit,
    total_cost = v_total_cost,
    supplier_id = p_supplier_id,
    payment_method = TRIM(p_payment_method),
    notes = NULLIF(TRIM(p_notes), '')
  WHERE id = p_purchase_id;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 2. void_product_sale
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.void_product_sale(p_income_id uuid)
RETURNS void
LANGUAGE plpgsql
AS $function$
DECLARE
  v_sale income_register%ROWTYPE;
  v_product_name TEXT;
  v_unit_of_measure TEXT;
  v_cogs_amount NUMERIC(18, 4) := 0;
  v_cogs_unit_cost NUMERIC(18, 4) := 0;
  v_reversal_expense_id UUID;
  v_reversal_receipt_no TEXT;
  v_alloc_rec RECORD;
BEGIN
  SELECT *
  INTO v_sale
  FROM income_register
  WHERE id = p_income_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Product sale not found';
  END IF;
  IF v_sale.entry_type IS DISTINCT FROM 'product_sale' THEN
    RAISE EXCEPTION 'Only product sale entries can be voided';
  END IF;
  IF v_sale.sale_status = 'voided' THEN
    RAISE EXCEPTION 'Product sale % is already voided', v_sale.invoice_no;
  END IF;
  IF v_sale.product_id IS NULL OR v_sale.sale_quantity IS NULL OR v_sale.sale_quantity <= 0 THEN
    RAISE EXCEPTION 'Product sale % is missing product quantity details', v_sale.invoice_no;
  END IF;
  SELECT product_name, unit_of_measure
  INTO v_product_name, v_unit_of_measure
  FROM finished_products
  WHERE id = v_sale.product_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Finished product not found for sale %', v_sale.invoice_no;
  END IF;
  IF v_sale.cogs_expense_id IS NOT NULL THEN
    SELECT amount, price
    INTO v_cogs_amount, v_cogs_unit_cost
    FROM expense_register
    WHERE id = v_sale.cogs_expense_id;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Linked COGS expense not found for sale %', v_sale.invoice_no;
    END IF;
  END IF;

  FOR v_alloc_rec IN (
    SELECT batch_source, batch_id, quantity_allocated
    FROM sale_batch_allocations
    WHERE sale_id = v_sale.id AND sale_source = 'product_sale'
  ) LOOP
    IF v_alloc_rec.batch_source = 'production_batch' THEN
      UPDATE production_batches SET remaining_quantity = remaining_quantity + v_alloc_rec.quantity_allocated WHERE id = v_alloc_rec.batch_id;
    ELSIF v_alloc_rec.batch_source = 'product_purchase' THEN
      UPDATE product_purchases SET remaining_quantity = remaining_quantity + v_alloc_rec.quantity_allocated WHERE id = v_alloc_rec.batch_id;
    END IF;

    INSERT INTO sale_batch_allocations (tenant_id, sale_id, sale_source, finished_product_id, batch_source, batch_id, quantity_allocated)
    VALUES (v_sale.tenant_id, v_sale.id, 'product_sale', v_sale.product_id, v_alloc_rec.batch_source, v_alloc_rec.batch_id, -v_alloc_rec.quantity_allocated);
  END LOOP;

  UPDATE finished_products
  SET
    current_stock = current_stock + v_sale.sale_quantity,
    updated_at = now()
  WHERE id = v_sale.product_id;

  -- 7c.1: dual-write finished_product_balances for the sale's BU
  PERFORM public.adjust_finished_product_balance_qty(
    v_sale.tenant_id,
    v_sale.product_id,
    v_sale.business_unit_id,
    v_sale.sale_quantity
  );

  INSERT INTO stock_movements (
    tenant_id,
    product_id, movement_type, quantity, reference_id, movement_date, notes,
    business_unit_id
  )
  VALUES (
    v_sale.tenant_id,
    v_sale.product_id, 'adjustment', v_sale.sale_quantity, v_sale.id,
    COALESCE(v_sale.date, CURRENT_DATE),
    'Reversal of voided sale ' || v_sale.invoice_no,
    v_sale.business_unit_id
  );
  IF v_sale.cogs_expense_id IS NOT NULL AND v_cogs_amount <> 0 THEN
    v_reversal_receipt_no := 'VOID-COGS-' || TRIM(v_sale.invoice_no);
    INSERT INTO expense_register (
      tenant_id,
      date, expense_category, sub_category, description, vendor, price,
      quantity, amount, payment_method, approved_by, receipt_no, payment_status, notes,
      business_unit_id
    )
    VALUES (
      v_sale.tenant_id,
      CURRENT_DATE, 'Cost of Goods Sold', 'Product Sales',
      'COGS reversal for voided product sale ' || v_sale.invoice_no || ' (' || v_product_name || ')',
      'Internal', -ABS(v_cogs_unit_cost), v_sale.sale_quantity, -ABS(v_cogs_amount),
      'Internal', 'System', v_reversal_receipt_no, 'Non-Cash',
      'Reversal of expense_register ' || v_sale.cogs_expense_id::TEXT
        || ' linked to voided income_register ' || v_sale.id::TEXT,
      v_sale.business_unit_id
    )
    RETURNING id INTO v_reversal_expense_id;
  END IF;
  UPDATE income_register
  SET
    sale_status = 'voided',
    voided_at = now(),
    cogs_reversal_expense_id = v_reversal_expense_id
  WHERE id = v_sale.id;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 3. delete_production_batch
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.delete_production_batch(p_batch_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_batch public.production_batches%ROWTYPE;
  v_stock NUMERIC(18, 4);
  v_material_id UUID;
  v_material_ids UUID[];
BEGIN
  SELECT *
  INTO v_batch
  FROM public.production_batches
  WHERE id = p_batch_id
    AND tenant_id = public.current_user_tenant_id()
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Production batch not found.';
  END IF;

  SELECT fp.current_stock
  INTO v_stock
  FROM public.finished_products fp
  WHERE fp.id = v_batch.finished_product_id
    AND fp.tenant_id = v_batch.tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Finished product not found for this batch.';
  END IF;

  IF COALESCE(v_stock, 0) < v_batch.quantity_produced THEN
    RAISE EXCEPTION
      'Cannot delete this batch — only % units of the finished product remain in stock, but deleting it would remove % units (some of this batch has likely already been sold or consumed).',
      trim(trailing '.' from trim(trailing '0' from COALESCE(v_stock, 0)::text)),
      trim(trailing '.' from trim(trailing '0' from v_batch.quantity_produced::text));
  END IF;

  SELECT COALESCE(array_agg(DISTINCT material_id), ARRAY[]::UUID[])
  INTO v_material_ids
  FROM public.production_batch_materials
  WHERE batch_id = v_batch.id;

  -- Remove the production_in ledger row for this batch.
  DELETE FROM public.stock_movements
  WHERE reference_id = v_batch.id
    AND movement_type = 'production_in';

  -- Reverse finished-product stock increment from create.
  UPDATE public.finished_products
  SET
    current_stock = current_stock - v_batch.quantity_produced,
    updated_at = now()
  WHERE id = v_batch.finished_product_id
    AND tenant_id = v_batch.tenant_id;

  -- 7c.1: dual-write finished_product_balances for this batch's BU
  PERFORM public.adjust_finished_product_balance_qty(
    v_batch.tenant_id,
    v_batch.finished_product_id,
    v_batch.business_unit_id,
    -v_batch.quantity_produced
  );

  -- Cascade deletes production_batch_materials; delete batch explicitly.
  DELETE FROM public.production_batches
  WHERE id = v_batch.id
    AND tenant_id = v_batch.tenant_id;

  -- Rebuild raw material stock + average cost from purchases − remaining consumption.
  IF v_material_ids IS NOT NULL THEN
    FOREACH v_material_id IN ARRAY v_material_ids
    LOOP
      PERFORM public.recalculate_raw_material_inventory(v_material_id);
      -- 7c.1: also rebuild per-BU balance for this batch's BU
      PERFORM public.recalculate_raw_material_inventory_scoped(
        v_material_id,
        v_batch.business_unit_id
      );
    END LOOP;
  END IF;
END;
$function$;

-- ---------------------------------------------------------------------------
-- 4. resolve_offline_sale_conflict (Action B shortfall invent-stock only)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.resolve_offline_sale_conflict(
  p_conflict_id uuid,
  p_action text,
  p_params jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  v_tenant_id uuid;
  v_auth_tenant uuid;
  v_action text := upper(btrim(coalesce(p_action, '')));
  v_conflict public.offline_sale_conflicts%ROWTYPE;
  v_claim jsonb;
  v_lines jsonb;
  v_confirmed jsonb;
  v_confirmed_line jsonb;
  v_product_id uuid;
  v_qty numeric(18, 4);
  v_unit_price numeric(18, 4);
  v_stock numeric(18, 4);
  v_claim_qty numeric(18, 4);
  v_invoice_no text;
  v_income_ids uuid[] := ARRAY[]::uuid[];
  v_income_id uuid;
  v_sale_date date;
  v_client_id text;
  v_customer_name text;
  v_amount_received numeric(18, 4);
  v_confirmed_total numeric(18, 4) := 0;
  v_line_recv numeric(18, 4);
  v_remaining numeric(18, 4);
  v_pos_notes text;
  v_cash_diff numeric(18, 4);
  v_cash_action text;
  v_cash_note text;
  v_cash_result jsonb;
  v_write_off_reason text;
  v_reclass_action text;
  v_reclass_reason text;
  v_shortfall numeric(18, 4);
  v_line jsonb;
  v_resolution jsonb;
  v_business_unit_id uuid;
  i int;
BEGIN
  IF p_conflict_id IS NULL THEN
    RAISE EXCEPTION 'p_conflict_id is required';
  END IF;

  IF v_action NOT IN ('A', 'B', 'C') THEN
    RAISE EXCEPTION 'p_action must be A, B, or C';
  END IF;

  v_auth_tenant := current_user_tenant_id();

  SELECT *
  INTO v_conflict
  FROM public.offline_sale_conflicts
  WHERE id = p_conflict_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conflict % not found', p_conflict_id;
  END IF;

  v_tenant_id := coalesce(v_auth_tenant, v_conflict.tenant_id);
  IF v_auth_tenant IS NOT NULL AND v_auth_tenant <> v_conflict.tenant_id THEN
    RAISE EXCEPTION 'Conflict % not found', p_conflict_id;
  END IF;

  IF v_conflict.status <> 'open' THEN
    RAISE EXCEPTION 'Conflict % is not open (status=%)', p_conflict_id, v_conflict.status;
  END IF;

  v_claim := v_conflict.claim;
  v_lines := v_claim->'lines';
  v_sale_date := COALESCE((v_claim->>'sale_date')::date, CURRENT_DATE);
  v_client_id := NULLIF(btrim(coalesce(v_claim->>'client_id', '')), '');
  v_customer_name := NULLIF(btrim(coalesce(v_claim->>'customer_name', '')), '');
  v_amount_received := ROUND(COALESCE((v_claim->>'amount_received')::numeric, 0), 4);

  BEGIN
    v_business_unit_id := NULLIF(btrim(coalesce(v_claim->>'business_unit_id', '')), '')::uuid;
  EXCEPTION WHEN OTHERS THEN
    v_business_unit_id := NULL;
  END;

  -- Clear suspense cash so later POS/reclass does not double-count amount_received
  IF v_conflict.suspense_income_id IS NOT NULL THEN
    UPDATE public.income_register
    SET
      amount = 0,
      amount_received = 0,
      outstanding_balance = 0,
      payment_status = 'Cleared',
      notes = coalesce(notes, '') || E'\n[cleared by offline conflict resolution ' || v_action || ']'
    WHERE id = v_conflict.suspense_income_id
      AND tenant_id = v_tenant_id;
  END IF;

  IF v_action = 'A' THEN
    v_confirmed := COALESCE(p_params->'confirmed_lines', '[]'::jsonb);
    IF jsonb_typeof(v_confirmed) <> 'array' OR jsonb_array_length(v_confirmed) = 0 THEN
      RAISE EXCEPTION 'confirmed_lines required for action A';
    END IF;

    FOR i IN 0 .. jsonb_array_length(v_confirmed) - 1 LOOP
      v_confirmed_line := v_confirmed->i;
      v_product_id := (v_confirmed_line->>'product_id')::uuid;
      v_qty := ROUND(COALESCE((v_confirmed_line->>'quantity')::numeric, 0), 4);

      SELECT COALESCE((elem->>'quantity')::numeric, 0), COALESCE((elem->>'unit_price')::numeric, 0)
      INTO v_claim_qty, v_unit_price
      FROM jsonb_array_elements(v_lines) elem
      WHERE (elem->>'product_id')::uuid = v_product_id
      LIMIT 1;

      IF v_claim_qty IS NULL THEN
        RAISE EXCEPTION 'confirmed product % not in claim', v_product_id;
      END IF;
      IF v_qty <= 0 OR v_qty > v_claim_qty THEN
        RAISE EXCEPTION 'confirmed qty for % must be >0 and <= claimed %', v_product_id, v_claim_qty;
      END IF;

      SELECT fp.current_stock INTO v_stock
      FROM public.finished_products fp
      WHERE fp.id = v_product_id AND fp.tenant_id = v_tenant_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Product % not found', v_product_id;
      END IF;
      IF v_stock < v_qty THEN
        RAISE EXCEPTION 'Insufficient stock for % (have %, need %)', v_product_id, v_stock, v_qty;
      END IF;

      v_confirmed_total := ROUND(v_confirmed_total + (v_qty * v_unit_price), 4);
    END LOOP;

    v_invoice_no := public.generate_next_code(v_tenant_id, 'POS', 4);
    v_pos_notes := 'Payment method: Cash'
      || E'\nResolved from offline conflict ' || p_conflict_id::text
      || E'\nclient_op_id=' || v_conflict.client_op_id::text;
    v_remaining := v_confirmed_total;

    FOR i IN 0 .. jsonb_array_length(v_confirmed) - 1 LOOP
      v_confirmed_line := v_confirmed->i;
      v_product_id := (v_confirmed_line->>'product_id')::uuid;
      v_qty := ROUND(COALESCE((v_confirmed_line->>'quantity')::numeric, 0), 4);

      SELECT COALESCE((elem->>'unit_price')::numeric, 0)
      INTO v_unit_price
      FROM jsonb_array_elements(v_lines) elem
      WHERE (elem->>'product_id')::uuid = v_product_id
      LIMIT 1;

      IF i = jsonb_array_length(v_confirmed) - 1 THEN
        v_line_recv := v_remaining;
      ELSE
        v_line_recv := ROUND(LEAST(ROUND(v_qty * v_unit_price, 4), GREATEST(v_remaining, 0)), 4);
        v_remaining := ROUND(v_remaining - v_line_recv, 4);
      END IF;

      v_income_id := public.create_product_sale(
        v_sale_date,
        v_invoice_no,
        v_client_id,
        CASE WHEN v_client_id IS NULL THEN v_customer_name ELSE NULL END,
        v_product_id,
        v_qty,
        v_unit_price,
        v_line_recv,
        'Paid',
        v_sale_date,
        NULL,
        v_pos_notes,
        'POS',
        NULL,
        v_business_unit_id
      );
      UPDATE public.income_register
      SET client_op_id = v_conflict.client_op_id
      WHERE id = v_income_id AND tenant_id = v_tenant_id;
      v_income_ids := array_append(v_income_ids, v_income_id);
    END LOOP;

    v_cash_diff := ROUND(v_amount_received - v_confirmed_total, 4);
    v_cash_result := NULL;
    IF v_cash_diff > 0.009 THEN
      v_cash_action := lower(btrim(coalesce(p_params->>'cash_difference_action', '')));
      v_cash_note := NULLIF(btrim(coalesce(p_params->>'cash_difference_note', '')), '');
      IF v_cash_action NOT IN ('refund', 'credit_customer', 'misc_income') THEN
        RAISE EXCEPTION 'cash_difference_action required when remainder > 0';
      END IF;
      IF v_cash_note IS NULL THEN
        RAISE EXCEPTION 'cash_difference_note required when remainder > 0';
      END IF;
      v_cash_result := public._offline_pos_apply_cash_action(
        v_tenant_id, v_cash_action, v_cash_diff, v_cash_note,
        v_sale_date, v_client_id, v_customer_name, v_conflict.client_op_id
      );
    END IF;

    v_resolution := jsonb_build_object(
      'action', 'A',
      'invoice_no', v_invoice_no,
      'income_ids', to_jsonb(v_income_ids),
      'confirmed_total', v_confirmed_total,
      'cash_difference', v_cash_diff,
      'cash_difference_result', v_cash_result
    );

    UPDATE public.offline_sale_conflicts
    SET status = 'resolved_a',
        resolution = v_resolution,
        resolved_at = now(),
        resolved_by = auth.uid(),
        updated_at = now()
    WHERE id = p_conflict_id AND tenant_id = v_tenant_id;

    RETURN v_resolution || jsonb_build_object('status', 'resolved_a');
  END IF;

  IF v_action = 'B' THEN
    v_write_off_reason := NULLIF(btrim(coalesce(p_params->>'write_off_reason', '')), '');
    IF v_write_off_reason IS NULL THEN
      RAISE EXCEPTION 'write_off_reason is required for action B';
    END IF;

    FOR i IN 0 .. jsonb_array_length(v_lines) - 1 LOOP
      v_line := v_lines->i;
      v_product_id := (v_line->>'product_id')::uuid;
      v_qty := ROUND(COALESCE((v_line->>'quantity')::numeric, 0), 4);

      SELECT fp.current_stock INTO v_stock
      FROM public.finished_products fp
      WHERE fp.id = v_product_id AND fp.tenant_id = v_tenant_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Product % not found', v_product_id;
      END IF;

      v_shortfall := GREATEST(v_qty - COALESCE(v_stock, 0), 0);
      IF v_shortfall > 0 THEN
        UPDATE public.finished_products
        SET current_stock = current_stock + v_shortfall, updated_at = now()
        WHERE id = v_product_id AND tenant_id = v_tenant_id;

        -- 7c.1: dual-write invent-stock onto the claim's BU balance
        PERFORM public.adjust_finished_product_balance_qty(
          v_tenant_id,
          v_product_id,
          v_business_unit_id,
          v_shortfall
        );

        INSERT INTO public.stock_movements (
          tenant_id, product_id, movement_type, quantity, reference_id, movement_date, notes,
          business_unit_id
        ) VALUES (
          v_tenant_id, v_product_id, 'adjustment', v_shortfall, p_conflict_id, v_sale_date,
          'Offline conflict B write-off/adjustment: ' || v_write_off_reason,
          v_business_unit_id
        );
      END IF;
    END LOOP;

    v_invoice_no := public.generate_next_code(v_tenant_id, 'POS', 4);
    v_pos_notes := 'Payment method: Cash'
      || E'\nResolved B from offline conflict ' || p_conflict_id::text
      || E'\nWrite-off: ' || v_write_off_reason
      || E'\nclient_op_id=' || v_conflict.client_op_id::text;
    v_remaining := v_amount_received;

    FOR i IN 0 .. jsonb_array_length(v_lines) - 1 LOOP
      v_line := v_lines->i;
      v_product_id := (v_line->>'product_id')::uuid;
      v_qty := ROUND(COALESCE((v_line->>'quantity')::numeric, 0), 4);
      v_unit_price := ROUND(COALESCE((v_line->>'unit_price')::numeric, 0), 4);

      IF i = jsonb_array_length(v_lines) - 1 THEN
        v_line_recv := v_remaining;
      ELSE
        v_line_recv := ROUND(LEAST(ROUND(v_qty * v_unit_price, 4), GREATEST(v_remaining, 0)), 4);
        v_remaining := ROUND(v_remaining - v_line_recv, 4);
      END IF;

      v_income_id := public.create_product_sale(
        v_sale_date, v_invoice_no, v_client_id,
        CASE WHEN v_client_id IS NULL THEN v_customer_name ELSE NULL END,
        v_product_id, v_qty, v_unit_price, v_line_recv, 'Paid', v_sale_date,
        NULL, v_pos_notes, 'POS', NULL, v_business_unit_id
      );
      UPDATE public.income_register
      SET client_op_id = v_conflict.client_op_id
      WHERE id = v_income_id AND tenant_id = v_tenant_id;
      v_income_ids := array_append(v_income_ids, v_income_id);
    END LOOP;

    v_resolution := jsonb_build_object(
      'action', 'B',
      'invoice_no', v_invoice_no,
      'income_ids', to_jsonb(v_income_ids),
      'write_off_reason', v_write_off_reason
    );

    UPDATE public.offline_sale_conflicts
    SET status = 'resolved_b', resolution = v_resolution,
        resolved_at = now(), resolved_by = auth.uid(), updated_at = now()
    WHERE id = p_conflict_id AND tenant_id = v_tenant_id;

    RETURN v_resolution || jsonb_build_object('status', 'resolved_b');
  END IF;

  -- Action C
  v_reclass_action := lower(btrim(coalesce(p_params->>'reclass_action', '')));
  v_reclass_reason := NULLIF(btrim(coalesce(p_params->>'reason', '')), '');
  IF v_reclass_action NOT IN ('refund', 'credit_customer', 'misc_income') THEN
    RAISE EXCEPTION 'reclass_action required for action C';
  END IF;
  IF v_reclass_reason IS NULL THEN
    RAISE EXCEPTION 'reason required for action C';
  END IF;

  v_cash_result := public._offline_pos_apply_cash_action(
    v_tenant_id, v_reclass_action, v_amount_received, v_reclass_reason,
    v_sale_date, v_client_id, v_customer_name, v_conflict.client_op_id
  );

  v_resolution := jsonb_build_object(
    'action', 'C',
    'reclass_action', v_reclass_action,
    'reason', v_reclass_reason,
    'cash_result', v_cash_result
  );

  UPDATE public.offline_sale_conflicts
  SET status = 'resolved_c', resolution = v_resolution,
      resolved_at = now(), resolved_by = auth.uid(), updated_at = now()
  WHERE id = p_conflict_id AND tenant_id = v_tenant_id;

  RETURN v_resolution || jsonb_build_object('status', 'resolved_c');
END;
$function$;

COMMIT;

NOTIFY pgrst, 'reload schema';
