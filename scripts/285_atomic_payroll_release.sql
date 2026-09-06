-- Atomic Fully Locked payroll release + fix reopen_payroll_period processing restore.
-- Adds release_payroll_period; fixes missing daily_rate/days_to_pay on reopen (and release).
-- Depends on script 279 helpers (_delete_payroll_lock_finance, admin_delete_payroll_history_for_employees).

BEGIN;

-- Required for processing restore (historyRowToProcessingPayload fields).
ALTER TABLE public.payroll_history
  ADD COLUMN IF NOT EXISTS days_to_pay integer,
  ADD COLUMN IF NOT EXISTS daily_rate numeric(10,4);

-- ---------------------------------------------------------------------------
-- Shared: restore payroll_processing from payroll_history (matches
-- historyRowToProcessingPayload in payroll-processing-utils.ts)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._payroll_restore_processing_from_history(
  p_tenant_id uuid,
  p_payroll_month date,
  p_employee_ids text[]
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_hist record;
  v_total_net_pay numeric := 0;
  v_restored integer := 0;
BEGIN
  DELETE FROM payroll_processing
  WHERE tenant_id = p_tenant_id
    AND payroll_month = p_payroll_month
    AND employee_id = ANY (p_employee_ids);

  FOR v_hist IN
    SELECT *
    FROM payroll_history
    WHERE tenant_id = p_tenant_id
      AND payroll_month = p_payroll_month
      AND employee_id = ANY (p_employee_ids)
  LOOP
    INSERT INTO payroll_processing (
      tenant_id,
      payroll_month,
      status,
      employee_id,
      basic_salary,
      housing_allowance,
      transport_allowance,
      other_allowances,
      department,
      project_contract,
      daily_rate,
      days_to_pay,
      absence_deduction,
      overtime_amount,
      loan_repayment,
      bonuses,
      arrears,
      net_only_adjustment,
      salary_advance,
      welfare_deduction,
      other_deductions,
      gross_pay,
      employee_ssnit,
      employer_ssnit,
      tier2,
      paye_tax,
      total_deductions,
      net_pay
    ) VALUES (
      p_tenant_id,
      v_hist.payroll_month,
      'Open',
      v_hist.employee_id,
      v_hist.basic_salary,
      v_hist.housing_allowance,
      v_hist.transport_allowance,
      v_hist.other_allowances,
      v_hist.department,
      v_hist.project_contract,
      v_hist.daily_rate,
      v_hist.days_to_pay,
      v_hist.absence_deduction,
      v_hist.overtime_amount,
      v_hist.loan_repayment,
      v_hist.bonuses,
      v_hist.arrears,
      v_hist.net_only_adjustment,
      v_hist.salary_advance,
      v_hist.welfare_deduction,
      v_hist.other_deductions,
      v_hist.gross_pay,
      v_hist.employee_ssnit,
      v_hist.employer_ssnit,
      v_hist.tier2,
      v_hist.paye_tax,
      v_hist.total_deductions,
      v_hist.net_pay
    );

    v_total_net_pay := public._payroll_round_currency(
      v_total_net_pay + coalesce(v_hist.net_pay, 0)
    );
    v_restored := v_restored + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'restoredRows', v_restored,
    'totalNetPay', v_total_net_pay
  );
END;
$$;

REVOKE ALL ON FUNCTION public._payroll_restore_processing_from_history(uuid, date, text[]) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Shared core: finance teardown → processing restore → history delete → MEC Open
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public._payroll_open_period_core(
  p_tenant_id uuid,
  p_business_unit_id uuid,
  p_employee_ids text[],
  p_payroll_month date,
  p_period_year integer,
  p_period_month integer
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_year integer;
  v_month integer;
  v_finance_rows jsonb;
  v_finance_result jsonb;
  v_restore jsonb;
  v_close_record jsonb;
  v_total_net_pay numeric;
BEGIN
  v_year := coalesce(
    p_period_year,
    extract(year FROM p_payroll_month)::integer
  );
  v_month := coalesce(
    p_period_month,
    extract(month FROM p_payroll_month)::integer
  );

  v_finance_rows := public._payroll_history_rows_to_jsonb(
    p_tenant_id,
    p_payroll_month,
    p_employee_ids
  );

  v_finance_result := public._delete_payroll_lock_finance(
    p_tenant_id,
    p_payroll_month,
    v_year,
    v_month,
    v_finance_rows
  );

  v_restore := public._payroll_restore_processing_from_history(
    p_tenant_id,
    p_payroll_month,
    p_employee_ids
  );

  v_total_net_pay := coalesce((v_restore ->> 'totalNetPay')::numeric, 0);

  PERFORM public.admin_delete_payroll_history_for_employees(
    p_payroll_month,
    p_tenant_id,
    p_employee_ids
  );

  INSERT INTO month_end_close (
    tenant_id,
    month,
    business_unit_id,
    employees_recorded,
    total_net_pay,
    lock_status,
    notes
  ) VALUES (
    p_tenant_id,
    p_payroll_month,
    p_business_unit_id,
    coalesce((v_restore ->> 'restoredRows')::integer, 0),
    v_total_net_pay,
    'Open',
    NULL
  )
  ON CONFLICT (tenant_id, business_unit_id, month) DO UPDATE
  SET
    employees_recorded = EXCLUDED.employees_recorded,
    total_net_pay = EXCLUDED.total_net_pay,
    lock_status = EXCLUDED.lock_status,
    notes = EXCLUDED.notes;

  SELECT to_jsonb(m.*)
  INTO v_close_record
  FROM month_end_close m
  WHERE m.tenant_id = p_tenant_id
    AND m.month = p_payroll_month
    AND m.business_unit_id IS NOT DISTINCT FROM p_business_unit_id
  LIMIT 1;

  RETURN jsonb_build_object(
    'closeRecord', v_close_record,
    'financeResult', v_finance_result,
    'restoredRows', coalesce((v_restore ->> 'restoredRows')::integer, 0)
  );
END;
$$;

REVOKE ALL ON FUNCTION public._payroll_open_period_core(
  uuid, uuid, text[], date, integer, integer
) FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Fix: reopen_payroll_period — restore daily_rate + days_to_pay via shared core
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.reopen_payroll_period(
  p_tenant_id uuid,
  p_business_unit_id uuid,
  p_employee_ids text[],
  p_payroll_month date,
  p_period_year integer,
  p_period_month integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_close record;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'tenant_id is required';
  END IF;

  IF p_employee_ids IS NULL OR cardinality(p_employee_ids) = 0 THEN
    RAISE EXCEPTION 'No payroll history rows found for this period in the active business unit scope';
  END IF;

  SELECT *
  INTO v_close
  FROM month_end_close
  WHERE tenant_id = p_tenant_id
    AND month = p_payroll_month
    AND business_unit_id IS NOT DISTINCT FROM p_business_unit_id
  LIMIT 1;

  IF v_close.lock_status IS DISTINCT FROM 'Partially Locked' THEN
    RAISE EXCEPTION 'Only partially locked periods can be reopened';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM payroll_history
    WHERE tenant_id = p_tenant_id
      AND payroll_month = p_payroll_month
      AND employee_id = ANY (p_employee_ids)
  ) THEN
    RAISE EXCEPTION 'No payroll history rows found for this period in the active business unit scope';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM payroll_history
    WHERE tenant_id = p_tenant_id
      AND payroll_month = p_payroll_month
      AND employee_id = ANY (p_employee_ids)
      AND locked IS TRUE
  ) THEN
    RAISE EXCEPTION
      'This period has permanently locked payroll records and cannot be reopened';
  END IF;

  RETURN public._payroll_open_period_core(
    p_tenant_id,
    p_business_unit_id,
    p_employee_ids,
    p_payroll_month,
    p_period_year,
    p_period_month
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- New: release_payroll_period — Fully Locked → Open
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.release_payroll_period(
  p_tenant_id uuid,
  p_business_unit_id uuid,
  p_employee_ids text[],
  p_payroll_month date,
  p_period_year integer,
  p_period_month integer
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_close record;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'tenant_id is required';
  END IF;

  IF p_employee_ids IS NULL OR cardinality(p_employee_ids) = 0 THEN
    RAISE EXCEPTION 'No payroll history rows found for this period in the active business unit scope';
  END IF;

  SELECT *
  INTO v_close
  FROM month_end_close
  WHERE tenant_id = p_tenant_id
    AND month = p_payroll_month
    AND business_unit_id IS NOT DISTINCT FROM p_business_unit_id
  LIMIT 1;

  IF v_close.lock_status IS DISTINCT FROM 'Locked' THEN
    RAISE EXCEPTION
      'Only permanently locked periods can be released. Use Reopen Period for partially locked months.';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM payroll_history
    WHERE tenant_id = p_tenant_id
      AND payroll_month = p_payroll_month
      AND employee_id = ANY (p_employee_ids)
  ) THEN
    RAISE EXCEPTION 'No payroll history rows found for this period in the active business unit scope';
  END IF;

  RETURN public._payroll_open_period_core(
    p_tenant_id,
    p_business_unit_id,
    p_employee_ids,
    p_payroll_month,
    p_period_year,
    p_period_month
  );
END;
$$;

COMMENT ON FUNCTION public.release_payroll_period(
  uuid, uuid, text[], date, integer, integer
) IS
  'Atomically release a Fully Locked payroll period to Open: finance teardown, processing restore, history delete, month_end_close update.';

REVOKE ALL ON FUNCTION public.release_payroll_period(
  uuid, uuid, text[], date, integer, integer
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.release_payroll_period(
  uuid, uuid, text[], date, integer, integer
) TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
