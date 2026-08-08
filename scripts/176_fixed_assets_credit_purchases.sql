-- Script 176: Fixed assets on credit (payment_method + linked AP + RPC).
-- Apply staging first; production after verification.

BEGIN;

ALTER TABLE public.fixed_assets
  ADD COLUMN IF NOT EXISTS payment_method text NOT NULL DEFAULT 'Cash',
  ADD COLUMN IF NOT EXISTS vendor_name text,
  ADD COLUMN IF NOT EXISTS accounts_payable_id uuid REFERENCES public.accounts_payable(id);

CREATE INDEX IF NOT EXISTS idx_fixed_assets_accounts_payable_id
  ON public.fixed_assets (accounts_payable_id)
  WHERE accounts_payable_id IS NOT NULL;

COMMENT ON COLUMN public.fixed_assets.payment_method IS
  'Cash = immediate cash outflow; credit methods create linked accounts_payable.';
COMMENT ON COLUMN public.fixed_assets.vendor_name IS
  'Supplier name when purchased on credit (required for credit payment methods).';
COMMENT ON COLUMN public.fixed_assets.accounts_payable_id IS
  'Linked AP row when payment_method is credit/on-account.';

ALTER TABLE public.accounts_payable
  ADD COLUMN IF NOT EXISTS source_type text,
  ADD COLUMN IF NOT EXISTS source_id text;

COMMENT ON COLUMN public.accounts_payable.source_type IS
  'Origin: manual, fixed_asset, raw_material, product_purchase, etc.';
COMMENT ON COLUMN public.accounts_payable.source_id IS
  'Source record id (e.g. fixed_assets.asset_id).';

CREATE OR REPLACE FUNCTION create_fixed_asset_payable(
  p_tenant_id uuid,
  p_asset_id text,
  p_vendor_name text,
  p_purchase_date date,
  p_total_cost numeric,
  p_description text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_payable_id uuid;
  v_invoice_no text;
BEGIN
  v_invoice_no := 'FAP-' || LEFT(p_asset_id, 8);

  INSERT INTO accounts_payable (
    tenant_id,
    vendor_name,
    invoice_number,
    expense_category,
    sub_category,
    description,
    invoice_date,
    due_date,
    amount,
    amount_paid,
    balance_due,
    status,
    notes,
    source_type,
    source_id
  )
  VALUES (
    p_tenant_id,
    COALESCE(NULLIF(TRIM(p_vendor_name), ''), 'Fixed Asset Supplier'),
    v_invoice_no,
    'Fixed Assets',
    'Fixed Asset Purchases',
    COALESCE(p_description, 'Fixed asset purchase on credit'),
    p_purchase_date,
    p_purchase_date + INTERVAL '30 days',
    p_total_cost,
    0,
    p_total_cost,
    'Outstanding',
    'Linked to fixed_assets ' || p_asset_id,
    'fixed_asset',
    p_asset_id
  )
  RETURNING id INTO v_payable_id;

  RETURN v_payable_id;
END;
$$;

CREATE OR REPLACE FUNCTION reverse_fixed_asset_payable(p_payable_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_amount_paid numeric;
BEGIN
  IF p_payable_id IS NULL THEN
    RETURN;
  END IF;

  SELECT amount_paid INTO v_amount_paid
  FROM accounts_payable
  WHERE id = p_payable_id;

  IF COALESCE(v_amount_paid, 0) > 0 THEN
    RAISE EXCEPTION 'Cannot reverse fixed asset payable with settlements (amount_paid=%)', v_amount_paid;
  END IF;

  DELETE FROM accounts_payable WHERE id = p_payable_id;
END;
$$;

CREATE OR REPLACE FUNCTION sync_fixed_asset_payable(
  p_tenant_id uuid,
  p_asset_id text,
  p_vendor_name text,
  p_purchase_date date,
  p_payment_method text,
  p_total_cost numeric,
  p_asset_name text,
  p_existing_payable_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_new_credit boolean;
  v_payable_id uuid;
  v_description text;
BEGIN
  v_new_credit := is_credit_payment_method(p_payment_method);
  v_description := 'Fixed asset: ' || COALESCE(NULLIF(TRIM(p_asset_name), ''), p_asset_id);

  IF NOT v_new_credit THEN
    PERFORM reverse_fixed_asset_payable(p_existing_payable_id);
    RETURN NULL;
  END IF;

  IF p_existing_payable_id IS NOT NULL THEN
    UPDATE accounts_payable
    SET
      vendor_name = COALESCE(NULLIF(TRIM(p_vendor_name), ''), vendor_name),
      amount = p_total_cost,
      balance_due = GREATEST(p_total_cost - COALESCE(amount_paid, 0), 0),
      invoice_date = p_purchase_date,
      due_date = p_purchase_date + INTERVAL '30 days',
      description = v_description,
      expense_category = 'Fixed Assets',
      sub_category = 'Fixed Asset Purchases',
      source_type = 'fixed_asset',
      source_id = p_asset_id
    WHERE id = p_existing_payable_id
      AND tenant_id = p_tenant_id;

    IF FOUND THEN
      RETURN p_existing_payable_id;
    END IF;
  END IF;

  v_payable_id := create_fixed_asset_payable(
    p_tenant_id,
    p_asset_id,
    p_vendor_name,
    p_purchase_date,
    p_total_cost,
    v_description
  );

  RETURN v_payable_id;
END;
$$;

GRANT EXECUTE ON FUNCTION create_fixed_asset_payable(uuid, text, text, date, numeric, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION reverse_fixed_asset_payable(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION sync_fixed_asset_payable(uuid, text, text, date, text, numeric, text, uuid) TO authenticated, service_role;

COMMIT;
