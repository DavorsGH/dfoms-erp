CREATE TABLE public.credit_notes (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  client_id text NOT NULL,
  source_type text NOT NULL,
  source_income_register_id uuid,
  source_invoice_id uuid,
  credit_note_number text NOT NULL,
  credit_note_date date DEFAULT CURRENT_DATE NOT NULL,
  reason text,
  subtotal numeric(18,4) DEFAULT 0 NOT NULL,
  total_amount numeric(18,4) DEFAULT 0 NOT NULL,
  status text DEFAULT 'issued'::text NOT NULL,
  refunded_amount numeric(18,4) DEFAULT 0 NOT NULL,
  notes text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  updated_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);

ALTER TABLE ONLY public.credit_notes ADD CONSTRAINT credit_notes_client_fkey FOREIGN KEY (tenant_id, client_id) REFERENCES customers(tenant_id, client_id);

ALTER TABLE ONLY public.credit_notes ADD CONSTRAINT credit_notes_income_fkey FOREIGN KEY (source_income_register_id) REFERENCES income_register(id);

ALTER TABLE ONLY public.credit_notes ADD CONSTRAINT credit_notes_invoice_fkey FOREIGN KEY (source_invoice_id) REFERENCES client_invoices(id);

ALTER TABLE ONLY public.credit_notes ADD CONSTRAINT credit_notes_number_unique UNIQUE (tenant_id, credit_note_number);

ALTER TABLE ONLY public.credit_notes ADD CONSTRAINT credit_notes_source_type_check CHECK ((source_type = ANY (ARRAY['product_sale'::text, 'invoice'::text])));

ALTER TABLE ONLY public.credit_notes ADD CONSTRAINT credit_notes_status_check CHECK ((status = ANY (ARRAY['issued'::text, 'partially_refunded'::text, 'refunded'::text])));

CREATE UNIQUE INDEX credit_notes_number_unique ON public.credit_notes USING btree (tenant_id, credit_note_number);

CREATE INDEX idx_credit_notes_source_income ON public.credit_notes USING btree (source_income_register_id);

CREATE INDEX idx_credit_notes_source_invoice ON public.credit_notes USING btree (source_invoice_id);

CREATE INDEX idx_credit_notes_tenant_client ON public.credit_notes USING btree (tenant_id, client_id);

ALTER TABLE public.credit_notes ENABLE ROW LEVEL SECURITY;

CREATE POLICY credit_notes_tenant_delete ON public.credit_notes AS PERMISSIVE FOR DELETE TO PUBLIC USING ((tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'crm_core'::text)));

CREATE POLICY credit_notes_tenant_insert ON public.credit_notes AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK ((tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'crm_core'::text)));

CREATE POLICY credit_notes_tenant_select ON public.credit_notes AS PERMISSIVE FOR SELECT TO PUBLIC USING ((tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'crm_core'::text)));

CREATE POLICY credit_notes_tenant_update ON public.credit_notes AS PERMISSIVE FOR UPDATE TO PUBLIC USING ((tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'crm_core'::text))) WITH CHECK ((tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'crm_core'::text)));

GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.credit_notes TO anon;

GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.credit_notes TO authenticated;

GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.credit_notes TO service_role;

CREATE TABLE public.credit_note_line_items (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  credit_note_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  product_id uuid,
  description text NOT NULL,
  quantity numeric(18,4),
  unit_price numeric(18,4),
  total_amount numeric(18,4) DEFAULT 0 NOT NULL,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);

ALTER TABLE ONLY public.credit_note_line_items ADD CONSTRAINT credit_note_line_items_note_fkey FOREIGN KEY (credit_note_id) REFERENCES credit_notes(id) ON DELETE CASCADE;

ALTER TABLE ONLY public.credit_note_line_items ADD CONSTRAINT credit_note_line_items_product_fkey FOREIGN KEY (product_id) REFERENCES finished_products(id);

CREATE INDEX idx_credit_note_line_items_note ON public.credit_note_line_items USING btree (credit_note_id);

ALTER TABLE public.credit_note_line_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY credit_note_line_items_tenant_delete ON public.credit_note_line_items AS PERMISSIVE FOR DELETE TO PUBLIC USING ((tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'crm_core'::text)));

CREATE POLICY credit_note_line_items_tenant_insert ON public.credit_note_line_items AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK ((tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'crm_core'::text)));

CREATE POLICY credit_note_line_items_tenant_select ON public.credit_note_line_items AS PERMISSIVE FOR SELECT TO PUBLIC USING ((tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'crm_core'::text)));

CREATE POLICY credit_note_line_items_tenant_update ON public.credit_note_line_items AS PERMISSIVE FOR UPDATE TO PUBLIC USING ((tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'crm_core'::text))) WITH CHECK ((tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'crm_core'::text)));

GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.credit_note_line_items TO anon;

GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.credit_note_line_items TO authenticated;

GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.credit_note_line_items TO service_role;

CREATE TABLE public.refunds (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  credit_note_id uuid NOT NULL,
  tenant_id uuid NOT NULL,
  amount numeric(18,4) NOT NULL,
  method text NOT NULL,
  refund_date date DEFAULT CURRENT_DATE NOT NULL,
  notes text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id)
);

ALTER TABLE ONLY public.refunds ADD CONSTRAINT refunds_note_fkey FOREIGN KEY (credit_note_id) REFERENCES credit_notes(id);

CREATE INDEX idx_refunds_note ON public.refunds USING btree (credit_note_id);

ALTER TABLE public.refunds ENABLE ROW LEVEL SECURITY;

CREATE POLICY refunds_tenant_insert ON public.refunds AS PERMISSIVE FOR INSERT TO PUBLIC WITH CHECK ((tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'crm_core'::text)));

CREATE POLICY refunds_tenant_select ON public.refunds AS PERMISSIVE FOR SELECT TO PUBLIC USING ((tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'crm_core'::text)));

CREATE POLICY refunds_tenant_update ON public.refunds AS PERMISSIVE FOR UPDATE TO PUBLIC USING ((tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'crm_core'::text))) WITH CHECK ((tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'crm_core'::text)));

GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.refunds TO anon;

GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.refunds TO authenticated;

GRANT DELETE, INSERT, REFERENCES, SELECT, TRIGGER, TRUNCATE, UPDATE ON TABLE public.refunds TO service_role;

CREATE OR REPLACE FUNCTION public.create_product_return(p_income_register_id uuid, p_line_items jsonb, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_sale income_register%ROWTYPE;
  v_tenant_id UUID;
  v_credit_note_id UUID;
  v_credit_note_number TEXT;
  v_subtotal NUMERIC(18, 4) := 0;
  v_item jsonb;
  v_product_id UUID;
  v_return_qty NUMERIC(18, 4);
  v_line_total NUMERIC(18, 4);
  v_sale_unit_cost NUMERIC(18, 4) := 0;
  v_cogs_reversal_amount NUMERIC(18, 4) := 0;
  v_total_return_qty NUMERIC(18, 4) := 0;
  v_remaining NUMERIC(18, 4);
  v_batch_rec RECORD;
  v_alloc_qty NUMERIC(18, 4);
  v_reversal_expense_id UUID;
  v_disposition TEXT;
BEGIN
  SELECT * INTO v_sale FROM income_register WHERE id = p_income_register_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Sale not found';
  END IF;
  IF v_sale.entry_type IS DISTINCT FROM 'product_sale' THEN
    RAISE EXCEPTION 'Only product sale entries can be returned';
  END IF;

  v_tenant_id := v_sale.tenant_id;

  IF v_sale.cogs_expense_id IS NOT NULL THEN
    SELECT price INTO v_sale_unit_cost FROM expense_register WHERE id = v_sale.cogs_expense_id;
  END IF;

  v_credit_note_number := public.generate_next_code(v_tenant_id, 'CRNPS', 4);

  INSERT INTO credit_notes (tenant_id, client_id, source_type, source_income_register_id, credit_note_number, reason)
  VALUES (v_tenant_id, v_sale.client_id, 'product_sale', p_income_register_id, v_credit_note_number, p_reason)
  RETURNING id INTO v_credit_note_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_line_items) LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_return_qty := (v_item->>'quantity')::numeric;
    v_line_total := v_return_qty * COALESCE((v_item->>'unit_price')::numeric, 0);
    v_subtotal := v_subtotal + v_line_total;
    v_disposition := LOWER(COALESCE(NULLIF(TRIM(v_item->>'disposition'), ''), 'restock'));
    IF v_disposition NOT IN ('restock', 'writeoff') THEN
      RAISE EXCEPTION 'Invalid disposition: %, must be restock or writeoff', v_disposition;
    END IF;

    INSERT INTO credit_note_line_items (credit_note_id, tenant_id, product_id, description, quantity, unit_price, total_amount)
    VALUES (v_credit_note_id, v_tenant_id, v_product_id, COALESCE(v_item->>'description', ''), v_return_qty, (v_item->>'unit_price')::numeric, v_line_total);

    IF v_disposition = 'restock' THEN
      v_remaining := v_return_qty;

      FOR v_batch_rec IN (
        SELECT batch_source, batch_id, SUM(quantity_allocated) AS net_qty, MIN(created_at) AS first_seen
        FROM sale_batch_allocations
        WHERE sale_id = p_income_register_id AND sale_source = 'product_sale' AND finished_product_id = v_product_id
        GROUP BY batch_source, batch_id
        HAVING SUM(quantity_allocated) > 0
        ORDER BY MIN(created_at) ASC
      ) LOOP
        EXIT WHEN v_remaining <= 0;
        v_alloc_qty := LEAST(v_remaining, v_batch_rec.net_qty);

        IF v_batch_rec.batch_source = 'production_batch' THEN
          UPDATE production_batches SET remaining_quantity = remaining_quantity + v_alloc_qty WHERE id = v_batch_rec.batch_id;
        ELSIF v_batch_rec.batch_source = 'product_purchase' THEN
          UPDATE product_purchases SET remaining_quantity = remaining_quantity + v_alloc_qty WHERE id = v_batch_rec.batch_id;
        END IF;

        INSERT INTO sale_batch_allocations (tenant_id, sale_id, sale_source, finished_product_id, batch_source, batch_id, quantity_allocated)
        VALUES (v_tenant_id, p_income_register_id, 'product_sale', v_product_id, v_batch_rec.batch_source, v_batch_rec.batch_id, -v_alloc_qty);

        v_remaining := v_remaining - v_alloc_qty;
      END LOOP;

      UPDATE finished_products
      SET current_stock = current_stock + v_return_qty, updated_at = now()
      WHERE id = v_product_id;

      INSERT INTO stock_movements (tenant_id, product_id, movement_type, quantity, reference_id, movement_date, notes)
      VALUES (v_tenant_id, v_product_id, 'adjustment', v_return_qty, v_credit_note_id, CURRENT_DATE,
        'Return (restocked) against sale ' || COALESCE(v_sale.invoice_no, p_income_register_id::text));

      v_cogs_reversal_amount := v_cogs_reversal_amount + (v_return_qty * v_sale_unit_cost);
      v_total_return_qty := v_total_return_qty + v_return_qty;
    ELSE
      INSERT INTO stock_movements (tenant_id, product_id, movement_type, quantity, reference_id, movement_date, notes)
      VALUES (v_tenant_id, v_product_id, 'adjustment', v_return_qty, v_credit_note_id, CURRENT_DATE,
        'Return (damaged/write-off, not restocked) against sale ' || COALESCE(v_sale.invoice_no, p_income_register_id::text));
    END IF;
  END LOOP;

  UPDATE credit_notes SET subtotal = v_subtotal, total_amount = v_subtotal WHERE id = v_credit_note_id;

  IF v_cogs_reversal_amount <> 0 THEN
    INSERT INTO expense_register (
      tenant_id, date, expense_category, sub_category, description, vendor, price,
      quantity, amount, payment_method, approved_by, receipt_no, payment_status, notes
    )
    VALUES (
      v_tenant_id, CURRENT_DATE, 'Cost of Goods Sold', 'Product Returns',
      'COGS reversal for return ' || v_credit_note_number || ' against sale ' || COALESCE(v_sale.invoice_no, ''),
      'Internal', -ABS(v_sale_unit_cost), v_total_return_qty, -ABS(v_cogs_reversal_amount),
      'Internal', 'System', 'VOID-COGS-' || v_credit_note_number, 'Non-Cash',
      'Reversal linked to credit_notes ' || v_credit_note_id::text
    )
    RETURNING id INTO v_reversal_expense_id;
  END IF;

  RETURN v_credit_note_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.create_product_return(p_income_register_id uuid, p_line_items jsonb, p_reason text) TO PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_product_return(p_income_register_id uuid, p_line_items jsonb, p_reason text) TO anon;

GRANT EXECUTE ON FUNCTION public.create_product_return(p_income_register_id uuid, p_line_items jsonb, p_reason text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.create_product_return(p_income_register_id uuid, p_line_items jsonb, p_reason text) TO postgres;

GRANT EXECUTE ON FUNCTION public.create_product_return(p_income_register_id uuid, p_line_items jsonb, p_reason text) TO service_role;

CREATE OR REPLACE FUNCTION public.create_invoice_credit_note(p_invoice_id uuid, p_line_items jsonb, p_reason text)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_invoice client_invoices%ROWTYPE;
  v_credit_note_id UUID;
  v_credit_note_number TEXT;
  v_subtotal NUMERIC(18, 4) := 0;
  v_item jsonb;
  v_line_total NUMERIC(18, 4);
BEGIN
  SELECT * INTO v_invoice FROM client_invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  v_credit_note_number := public.generate_next_code(v_invoice.tenant_id, 'CRNIV', 4);

  INSERT INTO credit_notes (tenant_id, client_id, source_type, source_invoice_id, credit_note_number, reason)
  VALUES (v_invoice.tenant_id, v_invoice.client_id, 'invoice', p_invoice_id, v_credit_note_number, p_reason)
  RETURNING id INTO v_credit_note_id;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_line_items) LOOP
    v_line_total := COALESCE((v_item->>'total_amount')::numeric, 0);
    v_subtotal := v_subtotal + v_line_total;

    INSERT INTO credit_note_line_items (credit_note_id, tenant_id, description, quantity, unit_price, total_amount)
    VALUES (v_credit_note_id, v_invoice.tenant_id, COALESCE(v_item->>'description', ''),
      (v_item->>'quantity')::numeric, (v_item->>'unit_price')::numeric, v_line_total);
  END LOOP;

  UPDATE credit_notes SET subtotal = v_subtotal, total_amount = v_subtotal WHERE id = v_credit_note_id;

  RETURN v_credit_note_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.create_invoice_credit_note(p_invoice_id uuid, p_line_items jsonb, p_reason text) TO PUBLIC;

GRANT EXECUTE ON FUNCTION public.create_invoice_credit_note(p_invoice_id uuid, p_line_items jsonb, p_reason text) TO anon;

GRANT EXECUTE ON FUNCTION public.create_invoice_credit_note(p_invoice_id uuid, p_line_items jsonb, p_reason text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.create_invoice_credit_note(p_invoice_id uuid, p_line_items jsonb, p_reason text) TO postgres;

GRANT EXECUTE ON FUNCTION public.create_invoice_credit_note(p_invoice_id uuid, p_line_items jsonb, p_reason text) TO service_role;

CREATE OR REPLACE FUNCTION public.record_refund(p_credit_note_id uuid, p_amount numeric, p_method text, p_notes text)
 RETURNS uuid
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_note credit_notes%ROWTYPE;
  v_refund_id UUID;
  v_new_refunded NUMERIC(18, 4);
BEGIN
  SELECT * INTO v_note FROM credit_notes WHERE id = p_credit_note_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Credit note not found';
  END IF;

  IF p_amount IS NULL OR p_amount <= 0 THEN
    RAISE EXCEPTION 'Refund amount must be greater than zero';
  END IF;

  IF v_note.refunded_amount + p_amount > v_note.total_amount THEN
    RAISE EXCEPTION 'Refund of % would exceed remaining credit of % (already refunded %, total %)',
      p_amount, v_note.total_amount - v_note.refunded_amount, v_note.refunded_amount, v_note.total_amount;
  END IF;

  INSERT INTO refunds (credit_note_id, tenant_id, amount, method, notes)
  VALUES (p_credit_note_id, v_note.tenant_id, p_amount, p_method, p_notes)
  RETURNING id INTO v_refund_id;

  v_new_refunded := v_note.refunded_amount + p_amount;

  UPDATE credit_notes
  SET refunded_amount = v_new_refunded,
      status = CASE WHEN v_new_refunded >= total_amount THEN 'refunded' ELSE 'partially_refunded' END
  WHERE id = p_credit_note_id;

  RETURN v_refund_id;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.record_refund(p_credit_note_id uuid, p_amount numeric, p_method text, p_notes text) TO PUBLIC;

GRANT EXECUTE ON FUNCTION public.record_refund(p_credit_note_id uuid, p_amount numeric, p_method text, p_notes text) TO anon;

GRANT EXECUTE ON FUNCTION public.record_refund(p_credit_note_id uuid, p_amount numeric, p_method text, p_notes text) TO authenticated;

GRANT EXECUTE ON FUNCTION public.record_refund(p_credit_note_id uuid, p_amount numeric, p_method text, p_notes text) TO postgres;

GRANT EXECUTE ON FUNCTION public.record_refund(p_credit_note_id uuid, p_amount numeric, p_method text, p_notes text) TO service_role;
