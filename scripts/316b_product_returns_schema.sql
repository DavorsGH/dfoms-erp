BEGIN;

ALTER TABLE public.stock_movements
  DROP CONSTRAINT IF EXISTS stock_movements_quantity_check;

ALTER TABLE public.stock_movements
  ADD CONSTRAINT stock_movements_quantity_check
  CHECK (
    (movement_type = 'return_writeoff'::public.stock_movement_type AND quantity = 0)
    OR (movement_type <> 'return_writeoff'::public.stock_movement_type AND quantity > 0)
  );

ALTER TABLE public.credit_notes
  ADD COLUMN IF NOT EXISTS business_unit_id uuid,
  ADD COLUMN IF NOT EXISTS pos_invoice_no text,
  ADD COLUMN IF NOT EXISTS applied_amount numeric(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS return_mode text;

ALTER TABLE public.credit_notes
  DROP CONSTRAINT IF EXISTS credit_notes_return_mode_check;

ALTER TABLE public.credit_notes
  ADD CONSTRAINT credit_notes_return_mode_check
  CHECK (
    return_mode IS NULL
    OR return_mode = ANY (ARRAY['store_credit'::text, 'refund_now'::text, 'exchange_hold'::text])
  );

ALTER TABLE public.credit_notes
  DROP CONSTRAINT IF EXISTS credit_notes_applied_refunded_cap;

ALTER TABLE public.credit_notes
  ADD CONSTRAINT credit_notes_applied_refunded_cap
  CHECK (applied_amount + refunded_amount <= total_amount + 0.0001);

ALTER TABLE public.credit_note_line_items
  ADD COLUMN IF NOT EXISTS source_income_register_id uuid,
  ADD COLUMN IF NOT EXISTS business_unit_id uuid,
  ADD COLUMN IF NOT EXISTS disposition text,
  ADD COLUMN IF NOT EXISTS tax_amount numeric(18,4) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS output_vat_amount numeric(18,4) NOT NULL DEFAULT 0;

ALTER TABLE public.credit_note_line_items
  DROP CONSTRAINT IF EXISTS credit_note_line_items_disposition_check;

ALTER TABLE public.credit_note_line_items
  ADD CONSTRAINT credit_note_line_items_disposition_check
  CHECK (
    disposition IS NULL
    OR disposition = ANY (ARRAY['restock'::text, 'writeoff'::text])
  );

ALTER TABLE public.credit_note_line_items
  DROP CONSTRAINT IF EXISTS credit_note_line_items_source_income_fkey;

ALTER TABLE public.credit_note_line_items
  ADD CONSTRAINT credit_note_line_items_source_income_fkey
  FOREIGN KEY (source_income_register_id) REFERENCES public.income_register(id);

ALTER TABLE public.expense_register
  ADD COLUMN IF NOT EXISTS is_customer_refund boolean NOT NULL DEFAULT false;

ALTER TABLE public.refunds
  ADD COLUMN IF NOT EXISTS expense_register_id uuid;

ALTER TABLE public.refunds
  DROP CONSTRAINT IF EXISTS refunds_expense_register_fkey;

ALTER TABLE public.refunds
  ADD CONSTRAINT refunds_expense_register_fkey
  FOREIGN KEY (expense_register_id) REFERENCES public.expense_register(id);

ALTER TABLE public.income_register
  ADD COLUMN IF NOT EXISTS credit_note_id uuid,
  ADD COLUMN IF NOT EXISTS source_income_register_id uuid,
  ADD COLUMN IF NOT EXISTS is_sale_return boolean NOT NULL DEFAULT false;

ALTER TABLE public.income_register
  DROP CONSTRAINT IF EXISTS income_register_credit_note_fkey;

ALTER TABLE public.income_register
  ADD CONSTRAINT income_register_credit_note_fkey
  FOREIGN KEY (credit_note_id) REFERENCES public.credit_notes(id);

ALTER TABLE public.income_register
  DROP CONSTRAINT IF EXISTS income_register_source_income_fkey;

ALTER TABLE public.income_register
  ADD CONSTRAINT income_register_source_income_fkey
  FOREIGN KEY (source_income_register_id) REFERENCES public.income_register(id);

CREATE INDEX IF NOT EXISTS idx_credit_notes_business_unit
  ON public.credit_notes (tenant_id, business_unit_id);

CREATE INDEX IF NOT EXISTS idx_credit_note_line_items_source_income
  ON public.credit_note_line_items (source_income_register_id);

CREATE INDEX IF NOT EXISTS idx_income_register_credit_note
  ON public.income_register (credit_note_id);

CREATE INDEX IF NOT EXISTS idx_income_register_source_income
  ON public.income_register (source_income_register_id);

CREATE TABLE IF NOT EXISTS public.credit_note_applications (
  id uuid DEFAULT gen_random_uuid() NOT NULL,
  tenant_id uuid NOT NULL,
  credit_note_id uuid NOT NULL,
  target_income_register_id uuid NOT NULL,
  amount numeric(18,4) NOT NULL,
  applied_date date DEFAULT CURRENT_DATE NOT NULL,
  notes text,
  created_at timestamp with time zone DEFAULT now() NOT NULL,
  PRIMARY KEY (id),
  CONSTRAINT credit_note_applications_amount_check CHECK (amount > 0)
);

ALTER TABLE public.credit_note_applications
  DROP CONSTRAINT IF EXISTS credit_note_applications_note_fkey;

ALTER TABLE public.credit_note_applications
  ADD CONSTRAINT credit_note_applications_note_fkey
  FOREIGN KEY (credit_note_id) REFERENCES public.credit_notes(id);

ALTER TABLE public.credit_note_applications
  DROP CONSTRAINT IF EXISTS credit_note_applications_income_fkey;

ALTER TABLE public.credit_note_applications
  ADD CONSTRAINT credit_note_applications_income_fkey
  FOREIGN KEY (target_income_register_id) REFERENCES public.income_register(id);

CREATE INDEX IF NOT EXISTS idx_credit_note_applications_note
  ON public.credit_note_applications (credit_note_id);

CREATE INDEX IF NOT EXISTS idx_credit_note_applications_target_income
  ON public.credit_note_applications (target_income_register_id);

ALTER TABLE public.credit_note_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS credit_note_applications_tenant_insert ON public.credit_note_applications;
CREATE POLICY credit_note_applications_tenant_insert ON public.credit_note_applications
  AS PERMISSIVE FOR INSERT TO PUBLIC
  WITH CHECK (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'crm_core'::text));

DROP POLICY IF EXISTS credit_note_applications_tenant_select ON public.credit_note_applications;
CREATE POLICY credit_note_applications_tenant_select ON public.credit_note_applications
  AS PERMISSIVE FOR SELECT TO PUBLIC
  USING (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'crm_core'::text));

DROP POLICY IF EXISTS credit_note_applications_tenant_update ON public.credit_note_applications;
CREATE POLICY credit_note_applications_tenant_update ON public.credit_note_applications
  AS PERMISSIVE FOR UPDATE TO PUBLIC
  USING (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'crm_core'::text))
  WITH CHECK (tenant_matches(tenant_id) AND tenant_has_feature(tenant_id, 'crm_core'::text));

GRANT SELECT, INSERT, UPDATE ON TABLE public.credit_note_applications TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.credit_note_applications TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
