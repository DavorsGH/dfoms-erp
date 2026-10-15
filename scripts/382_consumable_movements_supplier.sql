BEGIN;

ALTER TABLE public.consumable_movements
  ADD COLUMN IF NOT EXISTS supplier_id uuid REFERENCES public.suppliers (id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS consumable_movements_supplier_idx
  ON public.consumable_movements (tenant_id, supplier_id)
  WHERE supplier_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.enforce_consumable_movement_rules()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_on_hand numeric;
  v_exclude uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.consumable_items i
    WHERE i.id = NEW.item_id AND i.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Consumable item does not belong to this tenant';
  END IF;

  IF NEW.business_unit_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.business_units bu
    WHERE bu.id = NEW.business_unit_id AND bu.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Business unit does not belong to this tenant';
  END IF;

  IF NEW.site_code IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.sites s
    WHERE s.site_code = NEW.site_code AND s.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Site does not belong to this tenant';
  END IF;

  IF NEW.project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.projects p
    WHERE p.id = NEW.project_id AND p.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Project does not belong to this tenant';
  END IF;

  IF NEW.expense_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.expense_register e
    WHERE e.id = NEW.expense_id AND e.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Expense does not belong to this tenant';
  END IF;

  IF NEW.accounts_payable_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.accounts_payable a
    WHERE a.id = NEW.accounts_payable_id AND a.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Bill does not belong to this tenant';
  END IF;

  IF NEW.supplier_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.suppliers sp
    WHERE sp.id = NEW.supplier_id AND sp.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION 'Supplier does not belong to this tenant';
  END IF;

  IF NEW.movement_type IN ('issue', 'adjust_out') THEN
    v_exclude := CASE WHEN TG_OP = 'UPDATE' THEN OLD.id ELSE NULL END;
    v_on_hand := public.consumable_item_on_hand(NEW.tenant_id, NEW.item_id, v_exclude);
    IF NEW.quantity > v_on_hand THEN
      RAISE EXCEPTION 'Not enough stock: % available', v_on_hand;
    END IF;
  END IF;

  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';

SELECT column_name, data_type
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'consumable_movements'
  AND column_name = 'supplier_id';
