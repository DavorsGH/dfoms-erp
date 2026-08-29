-- =============================================================================
-- 256_sync_offline_pos_cash_sale_business_unit.sql
--
-- Add optional p_business_unit_id to sync_offline_pos_cash_sale (caller resolves
-- queue-time active BU). Persist that id on conflict.claim (+ ops result) so
-- resolve_offline_sale_conflict can pass it into create_product_sale.
-- Based on live staging bodies (239b tenant-fallback). DROP old overloads first.
-- =============================================================================

BEGIN;

DROP FUNCTION IF EXISTS public.sync_offline_pos_cash_sale(uuid, jsonb);
DROP FUNCTION IF EXISTS public.sync_offline_pos_cash_sale(uuid, jsonb, uuid);

CREATE OR REPLACE FUNCTION public.sync_offline_pos_cash_sale(
  p_client_op_id uuid,
  p_payload jsonb,
  p_business_unit_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $fn$
DECLARE
  v_tenant_id uuid;
  v_auth_tenant uuid;
  v_claim jsonb;
  v_existing jsonb;
  v_outcome text;
  v_sale_date date;
  v_client_id text;
  v_customer_name text;
  v_payment_method text;
  v_amount_received numeric(18, 4);
  v_notes text;
  v_provisional_token text;
  v_sales_rep_id text;
  v_lines jsonb;
  v_line jsonb;
  v_product_ids uuid[];
  v_pid uuid;
  v_stock numeric(18, 4);
  v_claimed numeric(18, 4);
  v_shortfall numeric(18, 4);
  v_stock_at_conflict jsonb := '[]'::jsonb;
  v_has_shortfall boolean := false;
  v_invoice_no text;
  v_income_ids uuid[] := ARRAY[]::uuid[];
  v_income_id uuid;
  v_line_total numeric(18, 4);
  v_line_recv numeric(18, 4);
  v_remaining numeric(18, 4);
  v_pos_notes text;
  v_suspense_invoice text;
  v_suspense_id uuid;
  v_conflict_id uuid;
  v_result jsonb;
  v_qty numeric(18, 4);
  v_unit_price numeric(18, 4);
  i int;
BEGIN
  IF p_client_op_id IS NULL THEN
    RAISE EXCEPTION 'p_client_op_id is required';
  END IF;

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'p_payload must be a JSON object';
  END IF;

  v_lines := p_payload->'lines';
  IF v_lines IS NULL OR jsonb_typeof(v_lines) <> 'array' OR jsonb_array_length(v_lines) = 0 THEN
    RAISE EXCEPTION 'lines must be a non-empty array';
  END IF;

  v_auth_tenant := current_user_tenant_id();
  v_tenant_id := v_auth_tenant;
  IF v_tenant_id IS NULL THEN
    SELECT fp.tenant_id
    INTO v_tenant_id
    FROM public.finished_products fp
    WHERE fp.id = ((v_lines->0->>'product_id')::uuid);
  END IF;
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'No tenant context';
  END IF;

  -- Idempotent replay (match by client_op_id; tenant must agree)
  SELECT outcome, result
  INTO v_outcome, v_existing
  FROM public.offline_pos_ops
  WHERE client_op_id = p_client_op_id;

  IF FOUND THEN
    IF (SELECT tenant_id FROM public.offline_pos_ops WHERE client_op_id = p_client_op_id) <> v_tenant_id THEN
      RAISE EXCEPTION 'client_op_id belongs to another tenant';
    END IF;
    RETURN v_existing || jsonb_build_object('status', v_outcome, 'idempotent', true);
  END IF;

  BEGIN
    v_sale_date := (p_payload->>'sale_date')::date;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Invalid sale_date';
  END;

  IF v_sale_date IS NULL THEN
    RAISE EXCEPTION 'sale_date is required';
  END IF;

  v_client_id := NULLIF(btrim(coalesce(p_payload->>'client_id', '')), '');
  v_customer_name := NULLIF(btrim(coalesce(p_payload->>'customer_name', '')), '');
  v_payment_method := btrim(coalesce(p_payload->>'payment_method', ''));
  v_amount_received := ROUND(COALESCE((p_payload->>'amount_received')::numeric, 0), 4);
  v_notes := NULLIF(btrim(coalesce(p_payload->>'notes', '')), '');
  v_provisional_token := NULLIF(btrim(coalesce(p_payload->>'provisional_token', '')), '');
  v_sales_rep_id := NULLIF(btrim(coalesce(p_payload->>'sales_rep_id', '')), '');

  IF lower(v_payment_method) <> 'cash' THEN
    RAISE EXCEPTION 'Only Cash payments can sync offline (got %)', v_payment_method;
  END IF;

  IF v_provisional_token IS NULL THEN
    RAISE EXCEPTION 'provisional_token is required';
  END IF;

  IF v_amount_received < 0 THEN
    RAISE EXCEPTION 'amount_received must be >= 0';
  END IF;

  -- Persist queue-time BU on claim so conflict resolve can stamp create_product_sale.
  v_claim := COALESCE(p_payload, '{}'::jsonb)
    || jsonb_build_object('business_unit_id', p_business_unit_id);

  -- Collect + sort product ids for lock order
  SELECT array_agg(DISTINCT (elem->>'product_id')::uuid ORDER BY (elem->>'product_id')::uuid)
  INTO v_product_ids
  FROM jsonb_array_elements(v_lines) AS elem;

  IF v_product_ids IS NULL OR array_length(v_product_ids, 1) IS NULL THEN
    RAISE EXCEPTION 'No valid product_id values in lines';
  END IF;

  -- Lock products; verify tenant + stock
  FOREACH v_pid IN ARRAY v_product_ids LOOP
    SELECT fp.current_stock
    INTO v_stock
    FROM public.finished_products fp
    WHERE fp.id = v_pid
      AND fp.tenant_id = v_tenant_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Product % not found for tenant', v_pid;
    END IF;

    SELECT COALESCE(SUM((elem->>'quantity')::numeric), 0)
    INTO v_claimed
    FROM jsonb_array_elements(v_lines) AS elem
    WHERE (elem->>'product_id')::uuid = v_pid;

    v_shortfall := GREATEST(v_claimed - COALESCE(v_stock, 0), 0);
    IF v_shortfall > 0 THEN
      v_has_shortfall := true;
    END IF;

    v_stock_at_conflict := v_stock_at_conflict || jsonb_build_array(
      jsonb_build_object(
        'product_id', v_pid,
        'claimed_qty', v_claimed,
        'stock_qty', COALESCE(v_stock, 0),
        'shortfall', v_shortfall
      )
    );
  END LOOP;

  IF v_has_shortfall THEN
    v_suspense_invoice := public.generate_next_code(v_tenant_id, 'OSC', 4);

    INSERT INTO public.income_register (
      tenant_id,
      date,
      invoice_no,
      client_id,
      customer_name,
      entry_type,
      service_category,
      description,
      amount,
      amount_received,
      outstanding_balance,
      payment_status,
      due_date,
      notes,
      client_op_id
    )
    VALUES (
      v_tenant_id,
      v_sale_date,
      v_suspense_invoice,
      v_client_id,
      CASE WHEN v_client_id IS NULL THEN v_customer_name ELSE NULL END,
      'offline_cash_suspense'::public.income_entry_type,
      'Offline Cash Clearing',
      'Offline POS cash suspense for ' || v_provisional_token,
      v_amount_received,
      v_amount_received,
      0,
      'Paid',
      v_sale_date,
      coalesce(v_notes, '')
        || E'\nOffline provisional token: ' || v_provisional_token
        || E'\nclient_op_id=' || p_client_op_id::text,
      p_client_op_id
    )
    RETURNING id INTO v_suspense_id;

    INSERT INTO public.offline_sale_conflicts (
      tenant_id,
      client_op_id,
      status,
      claim,
      stock_at_conflict,
      suspense_income_id,
      suspense_invoice_no,
      created_by
    )
    VALUES (
      v_tenant_id,
      p_client_op_id,
      'open',
      v_claim,
      v_stock_at_conflict,
      v_suspense_id,
      v_suspense_invoice,
      auth.uid()
    )
    RETURNING id INTO v_conflict_id;

    v_result := jsonb_build_object(
      'status', 'conflict',
      'conflict_id', v_conflict_id,
      'suspense_invoice_no', v_suspense_invoice,
      'suspense_income_id', v_suspense_id,
      'stock_at_conflict', v_stock_at_conflict,
      'business_unit_id', p_business_unit_id
    );

    INSERT INTO public.offline_pos_ops (client_op_id, tenant_id, outcome, result)
    VALUES (p_client_op_id, v_tenant_id, 'conflict', v_result);

    RETURN v_result;
  END IF;

  -- Clean path
  v_invoice_no := public.generate_next_code(v_tenant_id, 'POS', 4);
  v_pos_notes := 'Payment method: Cash'
    || CASE WHEN v_notes IS NOT NULL THEN E'\n' || v_notes ELSE '' END
    || E'\nOffline provisional token: ' || v_provisional_token
    || E'\nclient_op_id=' || p_client_op_id::text;

  v_remaining := v_amount_received;

  FOR i IN 0 .. jsonb_array_length(v_lines) - 1 LOOP
    v_line := v_lines->i;
    v_qty := ROUND(COALESCE((v_line->>'quantity')::numeric, 0), 4);
    v_unit_price := ROUND(COALESCE((v_line->>'unit_price')::numeric, 0), 4);
    v_line_total := ROUND(v_qty * v_unit_price, 4);

    IF i = jsonb_array_length(v_lines) - 1 THEN
      v_line_recv := v_remaining;
    ELSE
      v_line_recv := ROUND(LEAST(v_line_total, GREATEST(v_remaining, 0)), 4);
      v_remaining := ROUND(v_remaining - v_line_recv, 4);
    END IF;

    v_income_id := public.create_product_sale(
      v_sale_date,
      v_invoice_no,
      v_client_id,
      CASE WHEN v_client_id IS NULL THEN v_customer_name ELSE NULL END,
      (v_line->>'product_id')::uuid,
      v_qty,
      v_unit_price,
      v_line_recv,
      'Paid',
      v_sale_date,
      NULL,
      v_pos_notes,
      'POS',
      v_sales_rep_id,
      p_business_unit_id
    );

    UPDATE public.income_register
    SET client_op_id = p_client_op_id
    WHERE id = v_income_id
      AND tenant_id = v_tenant_id;

    v_income_ids := array_append(v_income_ids, v_income_id);
  END LOOP;

  v_result := jsonb_build_object(
    'status', 'synced',
    'invoice_no', v_invoice_no,
    'income_ids', to_jsonb(v_income_ids),
    'business_unit_id', p_business_unit_id
  );

  INSERT INTO public.offline_pos_ops (client_op_id, tenant_id, outcome, result)
  VALUES (p_client_op_id, v_tenant_id, 'synced', v_result);

  RETURN v_result;
END;
$fn$;

COMMENT ON FUNCTION public.sync_offline_pos_cash_sale(uuid, jsonb, uuid) IS
  'Idempotent offline POS cash cart sync. Optional p_business_unit_id stamps create_product_sale and is persisted on conflict.claim.';

GRANT EXECUTE ON FUNCTION public.sync_offline_pos_cash_sale(uuid, jsonb, uuid)
  TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.resolve_offline_sale_conflict(
  p_conflict_id uuid,
  p_action text,
  p_params jsonb DEFAULT '{}'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $fn$
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

        INSERT INTO public.stock_movements (
          tenant_id, product_id, movement_type, quantity, reference_id, movement_date, notes
        ) VALUES (
          v_tenant_id, v_product_id, 'adjustment', v_shortfall, p_conflict_id, v_sale_date,
          'Offline conflict B write-off/adjustment: ' || v_write_off_reason
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
$fn$;

COMMENT ON FUNCTION public.resolve_offline_sale_conflict(uuid, text, jsonb) IS
  'Resolve offline_sale_conflict A/B/C. Product sales inherit business_unit_id from conflict.claim (queue-time stamp).';

GRANT EXECUTE ON FUNCTION public.resolve_offline_sale_conflict(uuid, text, jsonb)
  TO authenticated, service_role;

COMMIT;
