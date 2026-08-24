-- =============================================================================
-- 239_offline_pos_cash_sale_conflicts.sql
--
-- STAGING FIRST — Phase 4 offline POS cash sales.
-- DO NOT apply to production without explicit approval.
-- Apply via: scripts/apply-239-offline-pos-cash-sale-conflicts-staging.ts
--
-- Adds:
--   - income_entry_type 'offline_cash_suspense'
--   - offline_sale_conflicts (stock-short conflict + resolution A/B/C)
--   - offline_pos_ops (cart-level idempotency receipt)
--   - income_register.client_op_id (nullable audit link; NOT unique — multi-line POS)
--   - sync_offline_pos_cash_sale / resolve_offline_sale_conflict RPCs
--
-- PG note: ALTER TYPE … ADD VALUE must run OUTSIDE BEGIN/COMMIT (and commit
-- before the new enum label is used in the same session on older PG).
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Enum (outside transaction)
-- ---------------------------------------------------------------------------
ALTER TYPE public.income_entry_type ADD VALUE IF NOT EXISTS 'offline_cash_suspense';

BEGIN;

-- ---------------------------------------------------------------------------
-- income_register: optional client_op_id for audit linking (no unique index)
-- ---------------------------------------------------------------------------
ALTER TABLE public.income_register
  ADD COLUMN IF NOT EXISTS client_op_id uuid;

COMMENT ON COLUMN public.income_register.client_op_id IS
  'Client offline cart op UUID for audit linking. Not unique: multi-line POS posts one income row per line; cart-level idempotency lives on offline_pos_ops.';

-- ---------------------------------------------------------------------------
-- offline_sale_conflicts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.offline_sale_conflicts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL,
  client_op_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'resolved_a', 'resolved_b', 'resolved_c')),
  claim jsonb NOT NULL,
  stock_at_conflict jsonb NOT NULL,
  suspense_income_id uuid NULL REFERENCES public.income_register (id),
  suspense_invoice_no text NULL,
  resolution jsonb NULL,
  resolved_at timestamptz NULL,
  resolved_by uuid NULL,
  created_by uuid NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, client_op_id)
);

COMMENT ON TABLE public.offline_sale_conflicts IS
  'Offline POS cash sale that could not sync due to stock shortfall; holds claim + suspense cash until resolved A/B/C.';

COMMENT ON COLUMN public.offline_sale_conflicts.claim IS
  'Full cart payload: sale_date, client_id, customer_name, payment_method, amount_received, notes, provisional_token, sales_rep_id, lines[].';

COMMENT ON COLUMN public.offline_sale_conflicts.stock_at_conflict IS
  'Per-product snapshot at conflict: [{product_id, claimed_qty, stock_qty, shortfall}].';

CREATE INDEX IF NOT EXISTS offline_sale_conflicts_tenant_status_idx
  ON public.offline_sale_conflicts (tenant_id, status);

DROP TRIGGER IF EXISTS trg_offline_sale_conflicts_enforce_tenant_id
  ON public.offline_sale_conflicts;
CREATE TRIGGER trg_offline_sale_conflicts_enforce_tenant_id
  BEFORE INSERT OR UPDATE OF tenant_id ON public.offline_sale_conflicts
  FOR EACH ROW
  EXECUTE FUNCTION enforce_row_tenant_id();

ALTER TABLE public.offline_sale_conflicts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS offline_sale_conflicts_tenant_select
  ON public.offline_sale_conflicts;
CREATE POLICY offline_sale_conflicts_tenant_select
  ON public.offline_sale_conflicts
  FOR SELECT
  TO authenticated
  USING (tenant_id = current_user_tenant_id());

DROP POLICY IF EXISTS offline_sale_conflicts_tenant_insert
  ON public.offline_sale_conflicts;
CREATE POLICY offline_sale_conflicts_tenant_insert
  ON public.offline_sale_conflicts
  FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = current_user_tenant_id());

DROP POLICY IF EXISTS offline_sale_conflicts_tenant_update
  ON public.offline_sale_conflicts;
CREATE POLICY offline_sale_conflicts_tenant_update
  ON public.offline_sale_conflicts
  FOR UPDATE
  TO authenticated
  USING (tenant_id = current_user_tenant_id())
  WITH CHECK (tenant_id = current_user_tenant_id());

GRANT SELECT, INSERT, UPDATE ON public.offline_sale_conflicts TO authenticated;
GRANT ALL ON public.offline_sale_conflicts TO service_role;

-- ---------------------------------------------------------------------------
-- offline_pos_ops (cart-level idempotency receipt)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.offline_pos_ops (
  client_op_id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('synced', 'conflict')),
  result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.offline_pos_ops IS
  'Idempotency receipt for whole-cart offline POS cash sync. Keyed by client_op_id.';

CREATE INDEX IF NOT EXISTS offline_pos_ops_tenant_idx
  ON public.offline_pos_ops (tenant_id);

DROP TRIGGER IF EXISTS trg_offline_pos_ops_enforce_tenant_id
  ON public.offline_pos_ops;
CREATE TRIGGER trg_offline_pos_ops_enforce_tenant_id
  BEFORE INSERT OR UPDATE OF tenant_id ON public.offline_pos_ops
  FOR EACH ROW
  EXECUTE FUNCTION enforce_row_tenant_id();

ALTER TABLE public.offline_pos_ops ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS offline_pos_ops_tenant_select
  ON public.offline_pos_ops;
CREATE POLICY offline_pos_ops_tenant_select
  ON public.offline_pos_ops
  FOR SELECT
  TO authenticated
  USING (tenant_id = current_user_tenant_id());

DROP POLICY IF EXISTS offline_pos_ops_tenant_insert
  ON public.offline_pos_ops;
CREATE POLICY offline_pos_ops_tenant_insert
  ON public.offline_pos_ops
  FOR INSERT
  TO authenticated
  WITH CHECK (tenant_id = current_user_tenant_id());

DROP POLICY IF EXISTS offline_pos_ops_tenant_update
  ON public.offline_pos_ops;
CREATE POLICY offline_pos_ops_tenant_update
  ON public.offline_pos_ops
  FOR UPDATE
  TO authenticated
  USING (tenant_id = current_user_tenant_id())
  WITH CHECK (tenant_id = current_user_tenant_id());

GRANT SELECT, INSERT, UPDATE ON public.offline_pos_ops TO authenticated;
GRANT ALL ON public.offline_pos_ops TO service_role;

-- =============================================================================
-- Helper: apply cash difference / full-cash reclass (refund | credit_customer | misc_income)
-- =============================================================================
CREATE OR REPLACE FUNCTION public._offline_pos_apply_cash_action(
  p_tenant_id uuid,
  p_action text,
  p_amount numeric,
  p_note text,
  p_sale_date date,
  p_client_id text,
  p_customer_name text,
  p_client_op_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $fn$
DECLARE
  v_action text := lower(btrim(coalesce(p_action, '')));
  v_amount numeric(18, 4) := ROUND(COALESCE(p_amount, 0), 4);
  v_receipt text;
  v_invoice text;
  v_expense_id uuid;
  v_income_id uuid;
  v_note text := NULLIF(btrim(coalesce(p_note, '')), '');
BEGIN
  IF v_amount <= 0.009 THEN
    RETURN jsonb_build_object('skipped', true, 'amount', v_amount);
  END IF;

  IF v_action NOT IN ('refund', 'credit_customer', 'misc_income') THEN
    RAISE EXCEPTION 'Invalid cash action % (expected refund|credit_customer|misc_income)', p_action;
  END IF;

  IF v_action = 'refund' THEN
    v_receipt := public.generate_next_code(p_tenant_id, 'EXP', 4);
    INSERT INTO public.expense_register (
      tenant_id,
      date,
      expense_category,
      sub_category,
      description,
      vendor,
      price,
      quantity,
      amount,
      payment_method,
      approved_by,
      receipt_no,
      payment_status,
      notes
    )
    VALUES (
      p_tenant_id,
      p_sale_date,
      'Operating Expenses',
      'Refunds',
      'Offline POS cash refund (client_op_id ' || p_client_op_id::text || ')',
      COALESCE(NULLIF(btrim(coalesce(p_customer_name, '')), ''), 'Customer'),
      v_amount,
      1,
      v_amount,
      'Cash',
      'System',
      v_receipt,
      'Paid',
      COALESCE(v_note, 'Offline POS conflict cash refund')
        || E'\nclient_op_id=' || p_client_op_id::text
    )
    RETURNING id INTO v_expense_id;

    RETURN jsonb_build_object(
      'action', 'refund',
      'amount', v_amount,
      'expense_id', v_expense_id,
      'receipt_no', v_receipt
    );
  END IF;

  IF v_action = 'misc_income' THEN
    v_invoice := public.generate_next_code(p_tenant_id, 'INC', 4);
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
      notes,
      client_op_id
    )
    VALUES (
      p_tenant_id,
      p_sale_date,
      v_invoice,
      NULLIF(btrim(coalesce(p_client_id, '')), ''),
      CASE
        WHEN NULLIF(btrim(coalesce(p_client_id, '')), '') IS NULL
          THEN NULLIF(btrim(coalesce(p_customer_name, '')), '')
        ELSE NULL
      END,
      'service'::public.income_entry_type,
      'Other Income',
      'Offline POS misc income from cash difference/reclass',
      v_amount,
      v_amount,
      0,
      'Paid',
      COALESCE(v_note, 'Offline POS misc income')
        || E'\nclient_op_id=' || p_client_op_id::text,
      p_client_op_id
    )
    RETURNING id INTO v_income_id;

    RETURN jsonb_build_object(
      'action', 'misc_income',
      'amount', v_amount,
      'income_id', v_income_id,
      'invoice_no', v_invoice
    );
  END IF;

  -- credit_customer: record as unpaid service income (customer credit / we owe them)
  v_invoice := public.generate_next_code(p_tenant_id, 'INC', 4);
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
    notes,
    client_op_id
  )
  VALUES (
    p_tenant_id,
    p_sale_date,
    v_invoice,
    NULLIF(btrim(coalesce(p_client_id, '')), ''),
    CASE
      WHEN NULLIF(btrim(coalesce(p_client_id, '')), '') IS NULL
        THEN NULLIF(btrim(coalesce(p_customer_name, '')), '')
      ELSE NULL
    END,
    'service'::public.income_entry_type,
    'Customer Credit',
    'Customer credit from offline POS conflict',
    v_amount,
    0,
    v_amount,
    'Outstanding',
    COALESCE(v_note, 'Customer credit from offline conflict')
      || E'\nclient_op_id=' || p_client_op_id::text,
    p_client_op_id
  )
  RETURNING id INTO v_income_id;

  RETURN jsonb_build_object(
    'action', 'credit_customer',
    'amount', v_amount,
    'income_id', v_income_id,
    'invoice_no', v_invoice
  );
END;
$fn$;

COMMENT ON FUNCTION public._offline_pos_apply_cash_action(uuid, text, numeric, text, date, text, text, uuid) IS
  'Internal helper: refund / credit_customer / misc_income for offline POS conflict cash handling.';

-- =============================================================================
-- A. sync_offline_pos_cash_sale
-- =============================================================================
CREATE OR REPLACE FUNCTION public.sync_offline_pos_cash_sale(
  p_client_op_id uuid,
  p_payload jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $fn$
DECLARE
  v_tenant_id uuid;
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

  v_tenant_id := current_user_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'No tenant context';
  END IF;

  -- Idempotent replay
  SELECT outcome, result
  INTO v_outcome, v_existing
  FROM public.offline_pos_ops
  WHERE client_op_id = p_client_op_id
    AND tenant_id = v_tenant_id;

  IF FOUND THEN
    RETURN v_existing || jsonb_build_object('status', v_outcome, 'idempotent', true);
  END IF;

  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'p_payload must be a JSON object';
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
  v_lines := p_payload->'lines';

  IF lower(v_payment_method) <> 'cash' THEN
    RAISE EXCEPTION 'Only Cash payment_method is supported for offline POS sync (got %)', v_payment_method;
  END IF;

  IF v_lines IS NULL OR jsonb_typeof(v_lines) <> 'array' OR jsonb_array_length(v_lines) = 0 THEN
    RAISE EXCEPTION 'lines must be a non-empty array';
  END IF;

  IF v_amount_received < 0 THEN
    RAISE EXCEPTION 'amount_received must be >= 0';
  END IF;

  -- Distinct product_ids sorted for lock order
  SELECT COALESCE(array_agg(x.pid ORDER BY x.pid), ARRAY[]::uuid[])
  INTO v_product_ids
  FROM (
    SELECT DISTINCT (elem->>'product_id')::uuid AS pid
    FROM jsonb_array_elements(v_lines) AS elem
  ) x;

  IF v_product_ids IS NULL OR cardinality(v_product_ids) = 0 THEN
    RAISE EXCEPTION 'No valid product_id values in lines';
  END IF;

  -- Lock + build stock_at_conflict (aggregate claimed qty per product)
  FOREACH v_pid IN ARRAY v_product_ids
  LOOP
    SELECT fp.current_stock
    INTO v_stock
    FROM public.finished_products fp
    WHERE fp.id = v_pid
      AND fp.tenant_id = v_tenant_id
    FOR UPDATE;

    IF NOT FOUND THEN
      RAISE EXCEPTION 'Finished product % not found for tenant', v_pid;
    END IF;

    SELECT COALESCE(SUM((elem->>'quantity')::numeric), 0)
    INTO v_claimed
    FROM jsonb_array_elements(v_lines) AS elem
    WHERE (elem->>'product_id')::uuid = v_pid;

    v_shortfall := GREATEST(ROUND(v_claimed - COALESCE(v_stock, 0), 4), 0);
    IF v_shortfall > 0.0001 THEN
      v_has_shortfall := true;
    END IF;

    v_stock_at_conflict := v_stock_at_conflict || jsonb_build_array(
      jsonb_build_object(
        'product_id', v_pid,
        'claimed_qty', ROUND(v_claimed, 4),
        'stock_qty', ROUND(COALESCE(v_stock, 0), 4),
        'shortfall', ROUND(v_shortfall, 4)
      )
    );
  END LOOP;

  v_pos_notes := 'Payment method: Cash'
    || CASE WHEN v_notes IS NOT NULL THEN E'\n' || v_notes ELSE '' END
    || CASE
         WHEN v_provisional_token IS NOT NULL
           THEN E'\nprovisional_token=' || v_provisional_token
         ELSE ''
       END
    || E'\nclient_op_id=' || p_client_op_id::text;

  -- -------------------------------------------------------------------------
  -- Conflict path: hold cash in suspense, no stock movement
  -- -------------------------------------------------------------------------
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
      'Offline cash suspense for provisional token '
        || COALESCE(v_provisional_token, '(none)'),
      v_amount_received,
      v_amount_received,
      0,
      'Paid',
      v_pos_notes,
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
      p_payload,
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
      'stock_at_conflict', v_stock_at_conflict
    );

    INSERT INTO public.offline_pos_ops (client_op_id, tenant_id, outcome, result)
    VALUES (p_client_op_id, v_tenant_id, 'conflict', v_result);

    RETURN v_result;
  END IF;

  -- -------------------------------------------------------------------------
  -- Clean path: one POS invoice, create_product_sale per line
  -- -------------------------------------------------------------------------
  v_invoice_no := public.generate_next_code(v_tenant_id, 'POS', 4);
  v_remaining := v_amount_received;

  FOR i IN 0 .. jsonb_array_length(v_lines) - 1
  LOOP
    v_line := v_lines->i;
    v_pid := (v_line->>'product_id')::uuid;
    v_qty := (v_line->>'quantity')::numeric;
    v_unit_price := (v_line->>'unit_price')::numeric;

    IF v_qty IS NULL OR v_qty <= 0 THEN
      RAISE EXCEPTION 'Line quantity must be > 0';
    END IF;
    IF v_unit_price IS NULL OR v_unit_price < 0 THEN
      RAISE EXCEPTION 'Line unit_price must be >= 0';
    END IF;

    v_line_total := ROUND(v_qty * v_unit_price, 4);
    v_line_recv := ROUND(LEAST(v_line_total, GREATEST(v_remaining, 0)), 4);
    v_remaining := ROUND(v_remaining - v_line_recv, 4);

    v_income_id := public.create_product_sale(
      v_sale_date,                 -- p_date
      v_invoice_no,                -- p_invoice_no (shared across lines)
      v_client_id,                 -- p_client_id
      CASE WHEN v_client_id IS NULL THEN v_customer_name ELSE NULL END,
      v_pid,                       -- p_product_id
      v_qty,                       -- p_quantity
      v_unit_price,                -- p_unit_price
      v_line_recv,                 -- p_amount_received (proportional allocate)
      'Paid',                      -- p_payment_status
      NULL,                        -- p_due_date
      NULL,                        -- p_description
      v_pos_notes,                 -- p_notes
      'POS',                       -- p_invoice_entity_type
      v_sales_rep_id               -- p_sales_rep_id
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
    'income_ids', to_jsonb(v_income_ids)
  );

  INSERT INTO public.offline_pos_ops (client_op_id, tenant_id, outcome, result)
  VALUES (p_client_op_id, v_tenant_id, 'synced', v_result);

  RETURN v_result;
END;
$fn$;

COMMENT ON FUNCTION public.sync_offline_pos_cash_sale(uuid, jsonb) IS
  'Idempotent offline POS cash cart sync. Locks stock; posts POS lines or opens offline_sale_conflicts with OSC suspense.';

GRANT EXECUTE ON FUNCTION public.sync_offline_pos_cash_sale(uuid, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.sync_offline_pos_cash_sale(uuid, jsonb) TO service_role;

-- =============================================================================
-- B. resolve_offline_sale_conflict (actions A | B | C)
-- =============================================================================
CREATE OR REPLACE FUNCTION public.resolve_offline_sale_conflict(
  p_conflict_id uuid,
  p_action text,
  p_params jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $fn$
DECLARE
  v_tenant_id uuid;
  v_conflict public.offline_sale_conflicts%ROWTYPE;
  v_action text := upper(btrim(coalesce(p_action, '')));
  v_params jsonb := COALESCE(p_params, '{}'::jsonb);
  v_claim jsonb;
  v_sale_date date;
  v_client_id text;
  v_customer_name text;
  v_amount_received numeric(18, 4);
  v_notes text;
  v_provisional_token text;
  v_sales_rep_id text;
  v_lines jsonb;
  v_pos_notes text;
  v_suspense_id uuid;
  v_confirmed jsonb;
  v_conf_line jsonb;
  v_product_id uuid;
  v_confirmed_qty numeric(18, 4);
  v_claim_qty numeric(18, 4);
  v_stock numeric(18, 4);
  v_unit_price numeric(18, 4);
  v_product_code text;
  v_product_name text;
  v_confirmed_total numeric(18, 4) := 0;
  v_invoice_no text;
  v_income_ids uuid[] := ARRAY[]::uuid[];
  v_income_id uuid;
  v_line_total numeric(18, 4);
  v_line_recv numeric(18, 4);
  v_remaining numeric(18, 4);
  v_cash_diff numeric(18, 4);
  v_cash_action text;
  v_cash_note text;
  v_cash_result jsonb;
  v_write_off_reason text;
  v_reclass_action text;
  v_reclass_reason text;
  v_stock_row jsonb;
  v_shortfall numeric(18, 4);
  v_line jsonb;
  v_qty numeric(18, 4);
  v_resolution jsonb;
  i int;
BEGIN
  v_tenant_id := current_user_tenant_id();
  IF v_tenant_id IS NULL THEN
    RAISE EXCEPTION 'No tenant context';
  END IF;

  IF p_conflict_id IS NULL THEN
    RAISE EXCEPTION 'p_conflict_id is required';
  END IF;

  IF v_action NOT IN ('A', 'B', 'C') THEN
    RAISE EXCEPTION 'p_action must be A, B, or C';
  END IF;

  SELECT *
  INTO v_conflict
  FROM public.offline_sale_conflicts
  WHERE id = p_conflict_id
    AND tenant_id = v_tenant_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conflict % not found', p_conflict_id;
  END IF;

  IF v_conflict.status <> 'open' THEN
    RAISE EXCEPTION 'Conflict % is not open (status=%)', p_conflict_id, v_conflict.status;
  END IF;

  v_claim := v_conflict.claim;
  v_sale_date := COALESCE((v_claim->>'sale_date')::date, CURRENT_DATE);
  v_client_id := NULLIF(btrim(coalesce(v_claim->>'client_id', '')), '');
  v_customer_name := NULLIF(btrim(coalesce(v_claim->>'customer_name', '')), '');
  v_amount_received := ROUND(COALESCE((v_claim->>'amount_received')::numeric, 0), 4);
  v_notes := NULLIF(btrim(coalesce(v_claim->>'notes', '')), '');
  v_provisional_token := NULLIF(btrim(coalesce(v_claim->>'provisional_token', '')), '');
  v_sales_rep_id := NULLIF(btrim(coalesce(v_claim->>'sales_rep_id', '')), '');
  v_lines := COALESCE(v_claim->'lines', '[]'::jsonb);
  v_suspense_id := v_conflict.suspense_income_id;

  v_pos_notes := 'Payment method: Cash'
    || CASE WHEN v_notes IS NOT NULL THEN E'\n' || v_notes ELSE '' END
    || CASE
         WHEN v_provisional_token IS NOT NULL
           THEN E'\nprovisional_token=' || v_provisional_token
         ELSE ''
       END
    || E'\nclient_op_id=' || v_conflict.client_op_id::text
    || E'\nresolved_conflict_id=' || p_conflict_id::text;

  -- clear_suspense: zero out held cash, mark Cleared
  IF v_suspense_id IS NOT NULL THEN
    UPDATE public.income_register
    SET
      amount = 0,
      amount_received = 0,
      outstanding_balance = 0,
      payment_status = 'Cleared',
      notes = COALESCE(notes, '')
        || E'\n[cleared via resolve_offline_sale_conflict action '
        || v_action || ' at ' || now()::text || ']'
    WHERE id = v_suspense_id
      AND tenant_id = v_tenant_id;
  END IF;

  -- =========================================================================
  -- Action A: post confirmed available lines + cash difference handling
  -- =========================================================================
  IF v_action = 'A' THEN
    v_confirmed := v_params->'confirmed_lines';
    v_cash_action := lower(btrim(coalesce(v_params->>'cash_difference_action', '')));
    v_cash_note := NULLIF(btrim(coalesce(v_params->>'cash_difference_note', '')), '');

    IF v_confirmed IS NULL OR jsonb_typeof(v_confirmed) <> 'array' OR jsonb_array_length(v_confirmed) = 0 THEN
      RAISE EXCEPTION 'Action A requires non-empty confirmed_lines';
    END IF;

    IF v_cash_note IS NULL THEN
      RAISE EXCEPTION 'Action A requires cash_difference_note';
    END IF;

    -- Validate confirmed qtys against claim + current stock; compute confirmed total
    FOR i IN 0 .. jsonb_array_length(v_confirmed) - 1
    LOOP
      v_conf_line := v_confirmed->i;
      v_product_id := (v_conf_line->>'product_id')::uuid;
      v_confirmed_qty := ROUND((v_conf_line->>'quantity')::numeric, 4);

      IF v_product_id IS NULL OR v_confirmed_qty IS NULL OR v_confirmed_qty <= 0 THEN
        RAISE EXCEPTION 'confirmed_lines[%]: product_id and quantity > 0 required', i;
      END IF;

      SELECT COALESCE(SUM((elem->>'quantity')::numeric), 0),
             MAX((elem->>'unit_price')::numeric)
      INTO v_claim_qty, v_unit_price
      FROM jsonb_array_elements(v_lines) AS elem
      WHERE (elem->>'product_id')::uuid = v_product_id;

      IF v_claim_qty IS NULL OR v_claim_qty <= 0 THEN
        RAISE EXCEPTION 'Product % is not in the original claim', v_product_id;
      END IF;

      IF v_confirmed_qty > v_claim_qty + 0.0001 THEN
        RAISE EXCEPTION 'Confirmed qty % exceeds claimed qty % for product %',
          v_confirmed_qty, v_claim_qty, v_product_id;
      END IF;

      SELECT fp.current_stock, fp.product_code, fp.product_name
      INTO v_stock, v_product_code, v_product_name
      FROM public.finished_products fp
      WHERE fp.id = v_product_id
        AND fp.tenant_id = v_tenant_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Finished product % not found', v_product_id;
      END IF;

      IF v_confirmed_qty > COALESCE(v_stock, 0) + 0.0001 THEN
        RAISE EXCEPTION 'Confirmed qty % exceeds current stock % for product %',
          v_confirmed_qty, v_stock, v_product_id;
      END IF;

      v_confirmed_total := ROUND(
        v_confirmed_total + ROUND(v_confirmed_qty * COALESCE(v_unit_price, 0), 4),
        4
      );
    END LOOP;

    v_invoice_no := public.generate_next_code(v_tenant_id, 'POS', 4);
    v_remaining := v_confirmed_total;

    -- Post one create_product_sale per confirmed line (amount_received allocated across confirmed)
    FOR i IN 0 .. jsonb_array_length(v_confirmed) - 1
    LOOP
      v_conf_line := v_confirmed->i;
      v_product_id := (v_conf_line->>'product_id')::uuid;
      v_confirmed_qty := ROUND((v_conf_line->>'quantity')::numeric, 4);

      SELECT MAX((elem->>'unit_price')::numeric)
      INTO v_unit_price
      FROM jsonb_array_elements(v_lines) AS elem
      WHERE (elem->>'product_id')::uuid = v_product_id;

      v_line_total := ROUND(v_confirmed_qty * COALESCE(v_unit_price, 0), 4);
      v_line_recv := ROUND(LEAST(v_line_total, GREATEST(v_remaining, 0)), 4);
      v_remaining := ROUND(v_remaining - v_line_recv, 4);

      v_income_id := public.create_product_sale(
        v_sale_date,
        v_invoice_no,
        v_client_id,
        CASE WHEN v_client_id IS NULL THEN v_customer_name ELSE NULL END,
        v_product_id,
        v_confirmed_qty,
        COALESCE(v_unit_price, 0),
        v_line_recv,
        'Paid',
        NULL,
        NULL,
        v_pos_notes || E'\nresolution=A',
        'POS',
        v_sales_rep_id
      );

      UPDATE public.income_register
      SET client_op_id = v_conflict.client_op_id
      WHERE id = v_income_id
        AND tenant_id = v_tenant_id;

      v_income_ids := array_append(v_income_ids, v_income_id);
    END LOOP;

    v_cash_diff := ROUND(v_amount_received - v_confirmed_total, 4);
    IF v_cash_diff > 0.009 THEN
      IF v_cash_action NOT IN ('refund', 'credit_customer', 'misc_income') THEN
        RAISE EXCEPTION 'cash_difference_action required when remainder cash > 0 (got %)',
          v_params->>'cash_difference_action';
      END IF;
      v_cash_result := public._offline_pos_apply_cash_action(
        v_tenant_id,
        v_cash_action,
        v_cash_diff,
        v_cash_note,
        v_sale_date,
        v_client_id,
        v_customer_name,
        v_conflict.client_op_id
      );
    ELSE
      v_cash_result := jsonb_build_object('skipped', true, 'amount', v_cash_diff);
    END IF;

    v_resolution := jsonb_build_object(
      'action', 'A',
      'confirmed_lines', v_confirmed,
      'invoice_no', v_invoice_no,
      'income_ids', to_jsonb(v_income_ids),
      'confirmed_total', v_confirmed_total,
      'original_amount_received', v_amount_received,
      'cash_difference', v_cash_result,
      'cash_difference_note', v_cash_note,
      'suspense_cleared', v_suspense_id
    );

    UPDATE public.offline_sale_conflicts
    SET
      status = 'resolved_a',
      resolution = v_resolution,
      resolved_at = now(),
      resolved_by = auth.uid(),
      updated_at = now()
    WHERE id = p_conflict_id
      AND tenant_id = v_tenant_id;

    RETURN v_resolution || jsonb_build_object('status', 'resolved_a', 'conflict_id', p_conflict_id);
  END IF;

  -- =========================================================================
  -- Action B: write-off shortfall (stock boost) then post full claim
  -- =========================================================================
  IF v_action = 'B' THEN
    v_write_off_reason := NULLIF(btrim(coalesce(v_params->>'write_off_reason', '')), '');
    IF v_write_off_reason IS NULL THEN
      RAISE EXCEPTION 'Action B requires write_off_reason';
    END IF;

    -- Boost stock for each shortfall via adjustment movement, then sell full claim
    FOR i IN 0 .. jsonb_array_length(COALESCE(v_conflict.stock_at_conflict, '[]'::jsonb)) - 1
    LOOP
      v_stock_row := v_conflict.stock_at_conflict->i;
      v_product_id := (v_stock_row->>'product_id')::uuid;
      v_shortfall := ROUND(COALESCE((v_stock_row->>'shortfall')::numeric, 0), 4);

      IF v_product_id IS NULL THEN
        CONTINUE;
      END IF;

      -- Re-lock and recompute shortfall against current stock vs claimed
      SELECT COALESCE(SUM((elem->>'quantity')::numeric), 0)
      INTO v_claim_qty
      FROM jsonb_array_elements(v_lines) AS elem
      WHERE (elem->>'product_id')::uuid = v_product_id;

      SELECT fp.current_stock
      INTO v_stock
      FROM public.finished_products fp
      WHERE fp.id = v_product_id
        AND fp.tenant_id = v_tenant_id
      FOR UPDATE;

      IF NOT FOUND THEN
        RAISE EXCEPTION 'Finished product % not found', v_product_id;
      END IF;

      v_shortfall := GREATEST(ROUND(COALESCE(v_claim_qty, 0) - COALESCE(v_stock, 0), 4), 0);

      IF v_shortfall > 0.0001 THEN
        UPDATE public.finished_products
        SET
          current_stock = current_stock + v_shortfall,
          updated_at = now()
        WHERE id = v_product_id
          AND tenant_id = v_tenant_id;

        INSERT INTO public.stock_movements (
          tenant_id,
          product_id,
          movement_type,
          quantity,
          reference_id,
          movement_date,
          notes
        )
        VALUES (
          v_tenant_id,
          v_product_id,
          'adjustment',
          v_shortfall,
          p_conflict_id,
          v_sale_date,
          'Offline conflict B write-off boost: ' || v_write_off_reason
        );
      END IF;
    END LOOP;

    v_invoice_no := public.generate_next_code(v_tenant_id, 'POS', 4);
    v_remaining := v_amount_received;

    FOR i IN 0 .. jsonb_array_length(v_lines) - 1
    LOOP
      v_line := v_lines->i;
      v_product_id := (v_line->>'product_id')::uuid;
      v_qty := (v_line->>'quantity')::numeric;
      v_unit_price := (v_line->>'unit_price')::numeric;

      v_line_total := ROUND(v_qty * v_unit_price, 4);
      v_line_recv := ROUND(LEAST(v_line_total, GREATEST(v_remaining, 0)), 4);
      v_remaining := ROUND(v_remaining - v_line_recv, 4);

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
        NULL,
        NULL,
        v_pos_notes || E'\nresolution=B write_off: ' || v_write_off_reason,
        'POS',
        v_sales_rep_id
      );

      UPDATE public.income_register
      SET client_op_id = v_conflict.client_op_id
      WHERE id = v_income_id
        AND tenant_id = v_tenant_id;

      v_income_ids := array_append(v_income_ids, v_income_id);
    END LOOP;

    v_resolution := jsonb_build_object(
      'action', 'B',
      'write_off_reason', v_write_off_reason,
      'invoice_no', v_invoice_no,
      'income_ids', to_jsonb(v_income_ids),
      'amount_received', v_amount_received,
      'suspense_cleared', v_suspense_id
    );

    UPDATE public.offline_sale_conflicts
    SET
      status = 'resolved_b',
      resolution = v_resolution,
      resolved_at = now(),
      resolved_by = auth.uid(),
      updated_at = now()
    WHERE id = p_conflict_id
      AND tenant_id = v_tenant_id;

    RETURN v_resolution || jsonb_build_object('status', 'resolved_b', 'conflict_id', p_conflict_id);
  END IF;

  -- =========================================================================
  -- Action C: reclass full cash, no product sale
  -- =========================================================================
  v_reclass_action := lower(btrim(coalesce(v_params->>'reclass_action', '')));
  v_reclass_reason := NULLIF(btrim(coalesce(v_params->>'reason', '')), '');

  IF v_reclass_action NOT IN ('refund', 'credit_customer', 'misc_income') THEN
    RAISE EXCEPTION 'Action C requires reclass_action refund|credit_customer|misc_income';
  END IF;

  IF v_reclass_reason IS NULL THEN
    RAISE EXCEPTION 'Action C requires reason';
  END IF;

  v_cash_result := public._offline_pos_apply_cash_action(
    v_tenant_id,
    v_reclass_action,
    v_amount_received,
    v_reclass_reason,
    v_sale_date,
    v_client_id,
    v_customer_name,
    v_conflict.client_op_id
  );

  v_resolution := jsonb_build_object(
    'action', 'C',
    'reclass_action', v_reclass_action,
    'reason', v_reclass_reason,
    'cash_result', v_cash_result,
    'amount_received', v_amount_received,
    'suspense_cleared', v_suspense_id
  );

  UPDATE public.offline_sale_conflicts
  SET
    status = 'resolved_c',
    resolution = v_resolution,
    resolved_at = now(),
    resolved_by = auth.uid(),
    updated_at = now()
  WHERE id = p_conflict_id
    AND tenant_id = v_tenant_id;

  RETURN v_resolution || jsonb_build_object('status', 'resolved_c', 'conflict_id', p_conflict_id);
END;
$fn$;

COMMENT ON FUNCTION public.resolve_offline_sale_conflict(uuid, text, jsonb) IS
  'Resolve an open offline_sale_conflict: A=confirmed qty sale, B=write-off+full claim, C=reclass cash only.';

GRANT EXECUTE ON FUNCTION public.resolve_offline_sale_conflict(uuid, text, jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_offline_sale_conflict(uuid, text, jsonb) TO service_role;

GRANT EXECUTE ON FUNCTION public._offline_pos_apply_cash_action(uuid, text, numeric, text, date, text, text, uuid)
  TO authenticated;
GRANT EXECUTE ON FUNCTION public._offline_pos_apply_cash_action(uuid, text, numeric, text, date, text, text, uuid)
  TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
