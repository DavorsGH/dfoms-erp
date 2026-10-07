BEGIN;

CREATE OR REPLACE FUNCTION public._salary_advance_active_bu_count(p_tenant_id uuid)
RETURNS integer
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT count(*)::integer
  FROM public.business_units bu
  WHERE bu.tenant_id = p_tenant_id
    AND coalesce(bu.is_active, true) = true;
$$;

CREATE OR REPLACE FUNCTION public._salary_advance_resolve_row_bu(
  p_tenant_id uuid,
  p_switcher_bu uuid,
  p_employee_id text
)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_employee_bu uuid;
  v_bu_count integer;
BEGIN
  SELECT e.business_unit_id
  INTO v_employee_bu
  FROM public.employees e
  WHERE e.tenant_id = p_tenant_id
    AND e.employee_id = p_employee_id;

  IF v_employee_bu IS NOT NULL THEN
    RETURN v_employee_bu;
  END IF;

  IF p_switcher_bu IS NOT NULL THEN
    RETURN p_switcher_bu;
  END IF;

  v_bu_count := public._salary_advance_active_bu_count(p_tenant_id);
  IF v_bu_count = 0 THEN
    RETURN NULL;
  END IF;

  IF v_bu_count = 1 THEN
    RETURN (
      SELECT bu.id
      FROM public.business_units bu
      WHERE bu.tenant_id = p_tenant_id
        AND coalesce(bu.is_active, true) = true
      ORDER BY bu.created_at
      LIMIT 1
    );
  END IF;

  RAISE EXCEPTION 'Choose a business before saving.';
END;
$$;

CREATE OR REPLACE FUNCTION public._salary_advance_payroll_month_locked(
  p_tenant_id uuid,
  p_business_unit_id uuid,
  p_deduct_payroll_month date
)
RETURNS boolean
LANGUAGE sql
STABLE
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.month_end_close mec
    WHERE mec.tenant_id = p_tenant_id
      AND mec.month = p_deduct_payroll_month
      AND mec.business_unit_id IS NOT DISTINCT FROM p_business_unit_id
      AND mec.lock_status IN ('Locked', 'Partially Locked')
  );
$$;

CREATE OR REPLACE FUNCTION public._salary_advance_month_start_from_date(p_date date)
RETURNS date
LANGUAGE sql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
  SELECT date_trunc('month', coalesce(p_date, current_date)::timestamp)::date;
$$;

CREATE OR REPLACE FUNCTION public._salary_advance_parse_payroll_month(p_text text)
RETURNS date
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public, pg_temp
AS $$
DECLARE
  v_trim text;
BEGIN
  v_trim := nullif(trim(p_text), '');
  IF v_trim IS NULL THEN
    RETURN NULL;
  END IF;

  IF v_trim ~ '^\d{4}-\d{2}-\d{2}$' THEN
    RETURN v_trim::date;
  END IF;

  IF v_trim ~ '^\d{4}-\d{2}$' THEN
    RETURN (v_trim || '-01')::date;
  END IF;

  BEGIN
    RETURN v_trim::date;
  EXCEPTION
    WHEN others THEN
      RAISE EXCEPTION 'Payroll month must be a valid month (YYYY-MM).';
  END;
END;
$$;

CREATE OR REPLACE FUNCTION public._salary_advance_assert_editable(p_row public.salary_advance_register)
RETURNS void
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF p_row.status = 'deducted' THEN
    RAISE EXCEPTION 'This advance was already deducted on payroll and cannot be changed.';
  END IF;
  IF public._salary_advance_payroll_month_locked(
    p_row.tenant_id,
    p_row.business_unit_id,
    p_row.deduct_payroll_month
  ) THEN
    RAISE EXCEPTION 'The payroll month for this advance is locked. Reopen payroll before editing.';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_salary_advances_bulk(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant_id uuid;
  v_switcher_bu uuid;
  v_row_bu uuid;
  v_item jsonb;
  v_advance_id text;
  v_employee_id text;
  v_amount numeric;
  v_date_issued date;
  v_deduct_month date;
  v_payment_account_id uuid;
  v_approved_by text;
  v_notes text;
  v_created integer := 0;
  v_ids text[] := '{}';
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Invalid payload.';
  END IF;

  v_tenant_id := nullif(trim(p_payload ->> 'tenant_id'), '')::uuid;
  IF v_tenant_id IS NULL OR NOT public.tenant_matches(v_tenant_id) THEN
    RAISE EXCEPTION 'Invalid workspace.';
  END IF;

  v_switcher_bu := nullif(trim(p_payload ->> 'business_unit_id'), '')::uuid;

  IF p_payload -> 'advances' IS NULL
    OR jsonb_typeof(p_payload -> 'advances') <> 'array'
    OR jsonb_array_length(p_payload -> 'advances') = 0 THEN
    RAISE EXCEPTION 'Select at least one employee.';
  END IF;

  FOR v_item IN SELECT value FROM jsonb_array_elements(p_payload -> 'advances') LOOP
    v_employee_id := nullif(trim(v_item ->> 'employee_id'), '');
    v_amount := coalesce((v_item ->> 'amount')::numeric, 0);
    v_date_issued := nullif(trim(v_item ->> 'date_issued'), '')::date;
    v_deduct_month := coalesce(
      public._salary_advance_parse_payroll_month(v_item ->> 'deduct_payroll_month'),
      public._salary_advance_month_start_from_date(v_date_issued)
    );
    v_payment_account_id := nullif(trim(v_item ->> 'payment_account_id'), '')::uuid;
    v_approved_by := nullif(trim(v_item ->> 'approved_by'), '');
    v_notes := nullif(trim(v_item ->> 'notes'), '');

    IF v_employee_id IS NULL THEN
      RAISE EXCEPTION 'Each advance requires an employee.';
    END IF;

    v_row_bu := public._salary_advance_resolve_row_bu(
      v_tenant_id,
      v_switcher_bu,
      v_employee_id
    );
    IF v_amount <= 0 THEN
      RAISE EXCEPTION 'Advance amount must be greater than zero.';
    END IF;
    IF v_date_issued IS NULL THEN
      RAISE EXCEPTION 'Date issued is required.';
    END IF;
    IF v_payment_account_id IS NULL THEN
      RAISE EXCEPTION 'Paid from account is required.';
    END IF;
    IF v_approved_by IS NULL THEN
      RAISE EXCEPTION 'Approved by is required.';
    END IF;

    v_deduct_month := public._salary_advance_month_start_from_date(v_deduct_month);

    IF public._salary_advance_payroll_month_locked(
      v_tenant_id,
      v_row_bu,
      v_deduct_month
    ) THEN
      RAISE EXCEPTION 'Payroll month % is locked. Choose a different deduct month or reopen payroll.',
        to_char(v_deduct_month, 'YYYY-MM');
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.employees e
      WHERE e.tenant_id = v_tenant_id
        AND e.employee_id = v_employee_id
    ) THEN
      RAISE EXCEPTION 'Employee % was not found in this workspace.', v_employee_id;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM public.payment_accounts pa
      WHERE pa.id = v_payment_account_id
        AND pa.tenant_id = v_tenant_id
    ) THEN
      RAISE EXCEPTION 'Payment account was not found in this workspace.';
    END IF;

    v_advance_id := nullif(trim(v_item ->> 'advance_id'), '');
    IF v_advance_id IS NULL THEN
      v_advance_id := public.generate_next_code(v_tenant_id, 'ADV', 4);
    END IF;

    INSERT INTO public.salary_advance_register (
      advance_id,
      tenant_id,
      business_unit_id,
      employee_id,
      amount,
      date_issued,
      deduct_payroll_month,
      payment_account_id,
      approved_by,
      status,
      notes
    ) VALUES (
      v_advance_id,
      v_tenant_id,
      v_row_bu,
      v_employee_id,
      public._payroll_round_currency(v_amount),
      v_date_issued,
      v_deduct_month,
      v_payment_account_id,
      v_approved_by,
      'outstanding',
      v_notes
    );

    v_created := v_created + 1;
    v_ids := array_append(v_ids, v_advance_id);
  END LOOP;

  RETURN jsonb_build_object(
    'created', v_created,
    'advanceIds', to_jsonb(v_ids)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_salary_advance(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant_id uuid;
  v_advance_id text;
  v_row public.salary_advance_register;
  v_amount numeric;
  v_date_issued date;
  v_deduct_month date;
  v_payment_account_id uuid;
  v_approved_by text;
  v_notes text;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Invalid payload.';
  END IF;

  v_tenant_id := nullif(trim(p_payload ->> 'tenant_id'), '')::uuid;
  v_advance_id := nullif(trim(p_payload ->> 'advance_id'), '');
  IF v_tenant_id IS NULL OR NOT public.tenant_matches(v_tenant_id) OR v_advance_id IS NULL THEN
    RAISE EXCEPTION 'Invalid advance.';
  END IF;

  SELECT *
  INTO v_row
  FROM public.salary_advance_register sar
  WHERE sar.tenant_id = v_tenant_id
    AND sar.advance_id = v_advance_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Advance not found.';
  END IF;

  PERFORM public._salary_advance_assert_editable(v_row);

  v_amount := coalesce((p_payload ->> 'amount')::numeric, v_row.amount);
  v_date_issued := coalesce(
    nullif(trim(p_payload ->> 'date_issued'), '')::date,
    v_row.date_issued
  );
  v_deduct_month := coalesce(
    public._salary_advance_parse_payroll_month(p_payload ->> 'deduct_payroll_month'),
    v_row.deduct_payroll_month
  );
  v_deduct_month := public._salary_advance_month_start_from_date(v_deduct_month);
  v_payment_account_id := coalesce(
    nullif(trim(p_payload ->> 'payment_account_id'), '')::uuid,
    v_row.payment_account_id
  );
  v_approved_by := coalesce(
    nullif(trim(p_payload ->> 'approved_by'), ''),
    v_row.approved_by
  );
  v_notes := coalesce(nullif(trim(p_payload ->> 'notes'), ''), v_row.notes);

  IF v_amount <= 0 THEN
    RAISE EXCEPTION 'Advance amount must be greater than zero.';
  END IF;

  IF v_deduct_month IS DISTINCT FROM v_row.deduct_payroll_month
    AND public._salary_advance_payroll_month_locked(
      v_tenant_id,
      v_row.business_unit_id,
      v_deduct_month
    ) THEN
    RAISE EXCEPTION 'Payroll month % is locked.', to_char(v_deduct_month, 'YYYY-MM');
  END IF;

  UPDATE public.salary_advance_register
  SET
    amount = public._payroll_round_currency(v_amount),
    date_issued = v_date_issued,
    deduct_payroll_month = v_deduct_month,
    payment_account_id = v_payment_account_id,
    approved_by = v_approved_by,
    notes = v_notes,
    updated_at = now()
  WHERE tenant_id = v_tenant_id
    AND advance_id = v_advance_id;

  RETURN jsonb_build_object('advanceId', v_advance_id, 'action', 'updated');
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_salary_advance(p_payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_tenant_id uuid;
  v_advance_id text;
  v_row public.salary_advance_register;
BEGIN
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN
    RAISE EXCEPTION 'Invalid payload.';
  END IF;

  v_tenant_id := nullif(trim(p_payload ->> 'tenant_id'), '')::uuid;
  v_advance_id := nullif(trim(p_payload ->> 'advance_id'), '');
  IF v_tenant_id IS NULL OR NOT public.tenant_matches(v_tenant_id) OR v_advance_id IS NULL THEN
    RAISE EXCEPTION 'Invalid advance.';
  END IF;

  SELECT *
  INTO v_row
  FROM public.salary_advance_register sar
  WHERE sar.tenant_id = v_tenant_id
    AND sar.advance_id = v_advance_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Advance not found.';
  END IF;

  PERFORM public._salary_advance_assert_editable(v_row);

  DELETE FROM public.salary_advance_register
  WHERE tenant_id = v_tenant_id
    AND advance_id = v_advance_id;

  RETURN jsonb_build_object('advanceId', v_advance_id, 'action', 'deleted');
END;
$$;

REVOKE ALL ON FUNCTION public.save_salary_advances_bulk(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_salary_advance(jsonb) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_salary_advance(jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.save_salary_advances_bulk(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_salary_advances_bulk(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.update_salary_advance(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_salary_advance(jsonb) TO service_role;
GRANT EXECUTE ON FUNCTION public.delete_salary_advance(jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.delete_salary_advance(jsonb) TO service_role;

COMMIT;
