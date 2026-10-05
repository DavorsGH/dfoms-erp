BEGIN;

CREATE OR REPLACE FUNCTION public._pur_delete_ap_accrual_expense(
  p_tenant_id uuid,
  p_ap_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_receipt_no text;
  v_deleted integer := 0;
BEGIN
  IF p_tenant_id IS NULL OR p_ap_id IS NULL THEN
    RETURN 0;
  END IF;

  v_receipt_no := public._pur_ap_accrual_receipt_no(p_ap_id);

  DELETE FROM public.expense_register er
  WHERE er.tenant_id = p_tenant_id
    AND er.receipt_no = v_receipt_no;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  RETURN v_deleted;
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_pur_accounts_payable_before_delete()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  PERFORM public._pur_delete_ap_accrual_expense(OLD.tenant_id, OLD.id);
  PERFORM public._pur_delete_tax_ledger_for_source('accounts_payable', OLD.id::text);
  RETURN OLD;
END;
$$;

DROP TRIGGER IF EXISTS trg_accounts_payable_pur_before_delete ON public.accounts_payable;
CREATE TRIGGER trg_accounts_payable_pur_before_delete
  BEFORE DELETE ON public.accounts_payable
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_pur_accounts_payable_before_delete();

CREATE OR REPLACE FUNCTION public.trg_expense_register_guard_ap_accrual()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_ap_id uuid;
  v_receipt text;
BEGIN
  v_receipt := nullif(btrim(coalesce(NEW.receipt_no, '')), '');
  IF v_receipt IS NULL OR v_receipt NOT LIKE 'AP-ACCRUAL-%' THEN
    RETURN NEW;
  END IF;

  IF NEW.tenant_id IS NULL THEN
    RAISE EXCEPTION 'AP-ACCRUAL expense requires tenant_id.';
  END IF;

  BEGIN
    v_ap_id := replace(v_receipt, 'AP-ACCRUAL-', '')::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      RAISE EXCEPTION 'Invalid AP-ACCRUAL receipt_no: %', v_receipt;
  END;

  IF NOT EXISTS (
    SELECT 1
    FROM public.accounts_payable ap
    WHERE ap.id = v_ap_id
      AND ap.tenant_id = NEW.tenant_id
  ) THEN
    RAISE EXCEPTION
      'AP-ACCRUAL expense % references missing accounts_payable % for this tenant.',
      v_receipt,
      v_ap_id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_expense_register_guard_ap_accrual ON public.expense_register;
CREATE TRIGGER trg_expense_register_guard_ap_accrual
  BEFORE INSERT OR UPDATE OF receipt_no, tenant_id
  ON public.expense_register
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_expense_register_guard_ap_accrual();

CREATE OR REPLACE FUNCTION public.count_tenant_orphan_ap_accrual_expenses(
  p_tenant_id uuid
)
RETURNS integer
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT count(*)::integer
  FROM public.expense_register er
  WHERE er.tenant_id = p_tenant_id
    AND er.receipt_no LIKE 'AP-ACCRUAL-%'
    AND NOT EXISTS (
      SELECT 1
      FROM public.accounts_payable ap
      WHERE ap.tenant_id = er.tenant_id
        AND ap.id::text = replace(er.receipt_no, 'AP-ACCRUAL-', '')
    );
$$;

REVOKE EXECUTE ON FUNCTION public._pur_delete_ap_accrual_expense(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._pur_delete_ap_accrual_expense(uuid, uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.trg_pur_accounts_payable_before_delete() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_pur_accounts_payable_before_delete() TO service_role;

REVOKE EXECUTE ON FUNCTION public.trg_expense_register_guard_ap_accrual() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_expense_register_guard_ap_accrual() TO service_role;

REVOKE EXECUTE ON FUNCTION public.count_tenant_orphan_ap_accrual_expenses(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.count_tenant_orphan_ap_accrual_expenses(uuid) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
