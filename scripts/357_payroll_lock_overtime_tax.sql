CREATE OR REPLACE FUNCTION public._payroll_sync_statutory_tax_ledger(
  p_tenant_id uuid,
  p_business_unit_id uuid,
  p_payroll_month date,
  p_period_end date,
  p_month_label text,
  p_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
AS $$
DECLARE
  v_source_id uuid;
  v_period_month date;
  v_paye numeric;
  v_employee_ssnit numeric;
  v_employer_tier1 numeric;
  v_tier2 numeric;
  v_open record;
  v_paid_or_filed boolean;
  v_inserted integer := 0;
  v_updated integer := 0;
  v_deleted integer := 0;
  v_skipped_paid integer := 0;
  v_leg record;
BEGIN
  v_source_id := public._payroll_tax_ledger_source_id(p_payroll_month);
  v_period_month := date_trunc('month', p_period_end)::date;

  v_paye := public._payroll_round_currency(public._payroll_sum_jsonb_field(p_rows, 'paye_tax') + public._payroll_sum_jsonb_field(p_rows, 'overtime_tax'));
  v_employee_ssnit := public._payroll_sum_jsonb_field(p_rows, 'employee_ssnit');
  v_employer_tier1 := public._payroll_sum_jsonb_field(p_rows, 'employer_ssnit');
  v_tier2 := public._payroll_sum_jsonb_field(p_rows, 'tier2');

  CREATE TEMP TABLE _payroll_desired_legs (
    tax_component text PRIMARY KEY,
    tax_amount numeric NOT NULL,
    counterparty_name text NOT NULL
  ) ON COMMIT DROP;

  IF v_paye > 0 THEN
    INSERT INTO _payroll_desired_legs VALUES ('paye', v_paye, 'GRA');
  END IF;
  IF v_employee_ssnit > 0 THEN
    INSERT INTO _payroll_desired_legs VALUES ('ssnit_employee', v_employee_ssnit, 'SSNIT');
  END IF;
  IF v_employer_tier1 > 0 THEN
    INSERT INTO _payroll_desired_legs VALUES ('ssnit_employer_tier1', v_employer_tier1, 'SSNIT');
  END IF;
  IF v_tier2 > 0 THEN
    INSERT INTO _payroll_desired_legs VALUES ('ssnit_tier2', v_tier2, 'SSNIT');
  END IF;

  CREATE TEMP TABLE _payroll_open_legs (
    id uuid PRIMARY KEY,
    tax_component text NOT NULL,
    tax_amount numeric NOT NULL
  ) ON COMMIT DROP;

  INSERT INTO _payroll_open_legs (id, tax_component, tax_amount)
  SELECT id, tax_component, tax_amount
  FROM tax_ledger_entries
  WHERE tenant_id = p_tenant_id
    AND business_unit_id IS NOT DISTINCT FROM p_business_unit_id
    AND source_type = 'payroll_period'
    AND source_id = v_source_id::text
    AND status = 'open';

  FOR v_leg IN SELECT * FROM _payroll_desired_legs LOOP
    SELECT EXISTS (
      SELECT 1
      FROM tax_ledger_entries
      WHERE tenant_id = p_tenant_id
        AND business_unit_id IS NOT DISTINCT FROM p_business_unit_id
        AND source_type = 'payroll_period'
        AND source_id = v_source_id::text
        AND tax_component = v_leg.tax_component
        AND status <> 'open'
        AND status <> 'reversed'
    ) INTO v_paid_or_filed;

    IF v_paid_or_filed THEN
      v_skipped_paid := v_skipped_paid + 1;
      DELETE FROM _payroll_open_legs WHERE tax_component = v_leg.tax_component;
      CONTINUE;
    END IF;

    SELECT * INTO v_open
    FROM _payroll_open_legs
    WHERE tax_component = v_leg.tax_component;

    IF FOUND THEN
      IF public._payroll_round_currency(v_open.tax_amount) = public._payroll_round_currency(v_leg.tax_amount) THEN
        DELETE FROM _payroll_open_legs WHERE tax_component = v_leg.tax_component;
        CONTINUE;
      END IF;

      UPDATE tax_ledger_entries
      SET
        entry_date = p_period_end,
        period_month = v_period_month,
        taxable_base = v_leg.tax_amount,
        tax_amount = v_leg.tax_amount,
        counterparty_name = v_leg.counterparty_name,
        notes = 'Payroll statutory accrual — ' || p_month_label,
        updated_at = now()
      WHERE id = v_open.id
        AND status = 'open';

      v_updated := v_updated + 1;
      DELETE FROM _payroll_open_legs WHERE tax_component = v_leg.tax_component;
      CONTINUE;
    END IF;

    INSERT INTO tax_ledger_entries (
      tenant_id,
      entry_date,
      period_month,
      direction,
      tax_component,
      rate_pct,
      taxable_base,
      tax_amount,
      status,
      source_type,
      source_id,
      counterparty_name,
      notes,
      business_unit_id
    ) VALUES (
      p_tenant_id,
      p_period_end,
      v_period_month,
      'statutory_payable',
      v_leg.tax_component,
      NULL,
      v_leg.tax_amount,
      v_leg.tax_amount,
      'open',
      'payroll_period',
      v_source_id::text,
      v_leg.counterparty_name,
      'Payroll statutory accrual — ' || p_month_label,
      p_business_unit_id
    );

    v_inserted := v_inserted + 1;
  END LOOP;

  DELETE FROM tax_ledger_entries t
  USING _payroll_open_legs o
  WHERE t.id = o.id;

  GET DIAGNOSTICS v_deleted = ROW_COUNT;

  RETURN jsonb_build_object(
    'sourceId', v_source_id::text,
    'inserted', v_inserted,
    'updated', v_updated,
    'deleted', v_deleted,
    'skippedPaid', v_skipped_paid
  );
END;
$$;

CREATE OR REPLACE FUNCTION public._payroll_rows_to_finance_jsonb(p_rows jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'employee_id', elem ->> 'employee_id',
        'gross_pay', elem ->> 'gross_pay',
        'net_only_adjustment', elem ->> 'net_only_adjustment',
        'absence_deduction', elem ->> 'absence_deduction',
        'loan_repayment', elem ->> 'loan_repayment',
        'salary_advance', elem ->> 'salary_advance',
        'welfare_deduction', elem ->> 'welfare_deduction',
        'other_deductions', elem ->> 'other_deductions',
        'employee_ssnit', elem ->> 'employee_ssnit',
        'employer_ssnit', elem ->> 'employer_ssnit',
        'tier2', elem ->> 'tier2',
        'paye_tax', elem ->> 'paye_tax',
        'overtime_tax', elem ->> 'overtime_tax'
      )
    ),
    '[]'::jsonb
  )
  FROM jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) AS elem;
$$;

CREATE OR REPLACE FUNCTION public._payroll_history_rows_to_jsonb(
  p_tenant_id uuid,
  p_payroll_month date,
  p_employee_ids text[]
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT coalesce(
    jsonb_agg(
      jsonb_build_object(
        'employee_id', employee_id,
        'gross_pay', gross_pay,
        'net_only_adjustment', net_only_adjustment,
        'absence_deduction', absence_deduction,
        'loan_repayment', loan_repayment,
        'salary_advance', salary_advance,
        'welfare_deduction', welfare_deduction,
        'other_deductions', other_deductions,
        'employee_ssnit', employee_ssnit,
        'employer_ssnit', employer_ssnit,
        'tier2', tier2,
        'paye_tax', paye_tax,
        'overtime_tax', overtime_tax
      )
    ),
    '[]'::jsonb
  )
  FROM payroll_history
  WHERE tenant_id = p_tenant_id
    AND payroll_month = p_payroll_month
    AND employee_id = ANY (p_employee_ids);
$$;

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

CREATE OR REPLACE FUNCTION public.lock_payroll_period(
  p_tenant_id uuid,
  p_business_unit_id uuid,
  p_employee_ids text[],
  p_payroll_month date,
  p_period_year integer,
  p_period_month integer,
  p_lock_status text,
  p_notes text,
  p_rows jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO public
AS $$
DECLARE
  v_existing record;
  v_scoped_rows jsonb := '[]'::jsonb;
  v_history_rows jsonb;
  v_finance_rows jsonb;
  v_locked_at timestamptz := now();
  v_total_net_pay numeric := 0;
  v_year integer;
  v_month integer;
  v_period_end date;
  v_is_promote boolean := false;
  v_is_full_lock boolean;
  v_close_record jsonb;
  v_finance_result jsonb;
  v_previous_employees integer;
  v_elem jsonb;
  v_hist_year integer;
  v_hist_month integer;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'tenant_id is required';
  END IF;

  IF p_employee_ids IS NULL OR cardinality(p_employee_ids) = 0 THEN
    RAISE EXCEPTION 'No payroll rows to lock for this period';
  END IF;

  IF p_lock_status NOT IN ('Locked', 'Partially Locked') THEN
    RAISE EXCEPTION 'Invalid lock status';
  END IF;

  v_year := coalesce(
    p_period_year,
    extract(year FROM p_payroll_month)::integer
  );
  v_month := coalesce(
    p_period_month,
    extract(month FROM p_payroll_month)::integer
  );

  SELECT *
  INTO v_existing
  FROM month_end_close
  WHERE tenant_id = p_tenant_id
    AND month = p_payroll_month
    AND business_unit_id IS NOT DISTINCT FROM p_business_unit_id
  LIMIT 1;

  v_is_promote :=
    v_existing.lock_status = 'Partially Locked'
    AND p_lock_status = 'Locked';

  IF v_is_promote THEN
    IF NOT public._payroll_is_month_ended(v_year, v_month) THEN
      RAISE EXCEPTION
        'Permanent lock is only allowed on or after % ends. Keep the period Partially Locked until then.',
        public._payroll_month_label(v_year, v_month);
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM payroll_history
      WHERE tenant_id = p_tenant_id
        AND payroll_month = p_payroll_month
        AND employee_id = ANY (p_employee_ids)
    ) THEN
      RAISE EXCEPTION 'No payroll history rows found for this partially locked period';
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
        'This period already has permanently locked payroll records. Use Release to Open if needed.';
    END IF;

    v_previous_employees := v_existing.employees_recorded;

    UPDATE payroll_history
    SET locked = true,
        locked_at = v_locked_at
    WHERE tenant_id = p_tenant_id
      AND payroll_month = p_payroll_month
      AND employee_id = ANY (p_employee_ids);

    SELECT public._payroll_round_currency(coalesce(sum(net_pay), 0))
    INTO v_total_net_pay
    FROM payroll_history
    WHERE tenant_id = p_tenant_id
      AND payroll_month = p_payroll_month
      AND employee_id = ANY (p_employee_ids);

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
      (
        SELECT count(*)
        FROM payroll_history
        WHERE tenant_id = p_tenant_id
          AND payroll_month = p_payroll_month
          AND employee_id = ANY (p_employee_ids)
      ),
      v_total_net_pay,
      'Locked',
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

    v_finance_rows := public._payroll_history_rows_to_jsonb(
      p_tenant_id,
      p_payroll_month,
      p_employee_ids
    );

    v_finance_result := public._post_payroll_lock_finance(
      p_tenant_id,
      p_business_unit_id,
      p_payroll_month,
      v_year,
      v_month,
      v_finance_rows,
      true,
      true
    );

    RETURN jsonb_build_object(
      'closeRecord', v_close_record,
      'financeResult', v_finance_result,
      'promotedFromPartial', true,
      'previousEmployeesRecorded', v_previous_employees
    );
  END IF;

  IF v_existing.lock_status IN ('Locked', 'Partially Locked') THEN
    RAISE EXCEPTION 'This payroll period is already locked';
  END IF;

  FOR v_elem IN
    SELECT elem
    FROM jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) AS elem
    WHERE trim(coalesce(elem ->> 'employee_id', '')) = ANY (p_employee_ids)
  LOOP
    v_scoped_rows := v_scoped_rows || jsonb_build_array(v_elem);
    v_total_net_pay := public._payroll_round_currency(
      v_total_net_pay + coalesce((v_elem ->> 'net_pay')::numeric, 0)
    );
  END LOOP;

  IF jsonb_array_length(v_scoped_rows) = 0 THEN
    RAISE EXCEPTION 'No payroll rows to lock for this period';
  END IF;

  v_is_full_lock := p_lock_status = 'Locked';

  IF v_is_full_lock AND NOT public._payroll_is_month_ended(v_year, v_month) THEN
    RAISE EXCEPTION
      'Permanent lock is only allowed on or after % ends. Use Partial Lock Period until then.',
      public._payroll_month_label(v_year, v_month);
  END IF;

  IF EXISTS (
    SELECT 1
    FROM payroll_history
    WHERE tenant_id = p_tenant_id
      AND payroll_month = p_payroll_month
      AND employee_id = ANY (p_employee_ids)
  ) THEN
    IF coalesce(v_existing.lock_status, 'Open') NOT IN ('Open', 'Not Started')
       AND v_existing.lock_status IS NOT NULL THEN
      RAISE EXCEPTION 'This payroll period is already locked';
    END IF;

    PERFORM public.admin_delete_payroll_history_for_employees(
      p_payroll_month,
      p_tenant_id,
      p_employee_ids
    );
  END IF;

  FOR v_elem IN SELECT * FROM jsonb_array_elements(v_scoped_rows) LOOP
    v_hist_year := extract(year FROM p_payroll_month)::integer;
    v_hist_month := extract(month FROM p_payroll_month)::integer;

    INSERT INTO payroll_history (
      tenant_id,
      payroll_month,
      year,
      quarter,
      employee_id,
      department,
      project_contract,
      basic_salary,
      housing_allowance,
      transport_allowance,
      other_allowances,
      overtime_amount,
      bonuses,
      arrears,
      net_only_adjustment,
      gross_pay,
      employee_ssnit,
      employer_ssnit,
      tier2,
      paye_tax,
      loan_repayment,
      salary_advance,
      welfare_deduction,
      other_deductions,
      absence_deduction,
      total_deductions,
      net_pay,
      locked,
      locked_at
    ) VALUES (
      p_tenant_id,
      p_payroll_month,
      v_hist_year,
      'Q' || ceil(v_hist_month / 3.0)::integer || ' ' || v_hist_year,
      v_elem ->> 'employee_id',
      v_elem ->> 'department',
      v_elem ->> 'project_contract',
      nullif(v_elem ->> 'basic_salary', '')::numeric,
      nullif(v_elem ->> 'housing_allowance', '')::numeric,
      nullif(v_elem ->> 'transport_allowance', '')::numeric,
      nullif(v_elem ->> 'other_allowances', '')::numeric,
      nullif(v_elem ->> 'overtime_amount', '')::numeric,
      nullif(v_elem ->> 'bonuses', '')::numeric,
      nullif(v_elem ->> 'arrears', '')::numeric,
      nullif(v_elem ->> 'net_only_adjustment', '')::numeric,
      nullif(v_elem ->> 'gross_pay', '')::numeric,
      nullif(v_elem ->> 'employee_ssnit', '')::numeric,
      nullif(v_elem ->> 'employer_ssnit', '')::numeric,
      nullif(v_elem ->> 'tier2', '')::numeric,
      nullif(v_elem ->> 'paye_tax', '')::numeric,
      nullif(v_elem ->> 'loan_repayment', '')::numeric,
      nullif(v_elem ->> 'salary_advance', '')::numeric,
      nullif(v_elem ->> 'welfare_deduction', '')::numeric,
      nullif(v_elem ->> 'other_deductions', '')::numeric,
      nullif(v_elem ->> 'absence_deduction', '')::numeric,
      nullif(v_elem ->> 'total_deductions', '')::numeric,
      nullif(v_elem ->> 'net_pay', '')::numeric,
      v_is_full_lock,
      CASE WHEN v_is_full_lock THEN v_locked_at ELSE NULL END
    );
  END LOOP;

  DELETE FROM payroll_processing
  WHERE tenant_id = p_tenant_id
    AND payroll_month = p_payroll_month
    AND employee_id = ANY (p_employee_ids);

  PERFORM public._promote_payroll_allowance_lines_to_history(
    p_tenant_id,
    p_payroll_month,
    p_business_unit_id
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
    jsonb_array_length(v_scoped_rows),
    v_total_net_pay,
    p_lock_status,
    nullif(trim(coalesce(p_notes, '')), '')
  )
  ON CONFLICT (tenant_id, business_unit_id, month) DO UPDATE
  SET
    employees_recorded = EXCLUDED.employees_recorded,
    total_net_pay = EXCLUDED.total_net_pay,
    lock_status = EXCLUDED.lock_status,
    notes = EXCLUDED.notes;

  v_finance_rows := public._payroll_rows_to_finance_jsonb(v_scoped_rows);

  v_finance_result := public._post_payroll_lock_finance(
    p_tenant_id,
    p_business_unit_id,
    p_payroll_month,
    v_year,
    v_month,
    v_finance_rows,
    v_is_full_lock,
    false
  );

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
    'promotedFromPartial', false,
    'previousEmployeesRecorded', NULL
  );
END;
$$;