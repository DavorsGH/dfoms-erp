-- Reject NEW expense_register rows with category Fixed Assets (existing rows may be updated/reclassified).

BEGIN;

CREATE OR REPLACE FUNCTION public.expense_register_reject_fixed_assets_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.expense_category IS NOT NULL
     AND lower(trim(NEW.expense_category)) = lower('Fixed Assets') THEN
    RAISE EXCEPTION '%', 'Assets bought by the company are recorded in Finance → Fixed Assets, which also records the payment. Repairs and maintenance belong under an expense category such as Direct Operational.';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_expense_register_reject_fixed_assets_insert ON public.expense_register;

CREATE TRIGGER trg_expense_register_reject_fixed_assets_insert
  BEFORE INSERT ON public.expense_register
  FOR EACH ROW
  EXECUTE FUNCTION public.expense_register_reject_fixed_assets_insert();

COMMIT;
