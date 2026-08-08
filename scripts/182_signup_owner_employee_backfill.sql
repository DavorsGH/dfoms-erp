-- Script 182: Backfill owner employee + approvers for tenants with super_admin but no employees.
-- Idempotent: skips tenants that already have any employee rows.
-- Does not touch Davors/Caanta or any tenant with existing employee data.

BEGIN;

DO $$
DECLARE
  v_row RECORD;
  v_employee_id text;
  v_staff_raw text;
  v_staff_id text;
  v_signup_date date := CURRENT_DATE;
BEGIN
  FOR v_row IN
    SELECT DISTINCT ON (t.id)
      t.id AS tenant_id,
      ua.auth_uid,
      ua.email,
      COALESCE(
        NULLIF(TRIM(u.raw_user_meta_data->>'full_name'), ''),
        initcap(replace(split_part(ua.email, '@', 1), '.', ' ')),
        t.name || ' Admin'
      ) AS full_name
    FROM public.tenants t
    INNER JOIN public.user_accounts ua
      ON ua.tenant_id = t.id
     AND ua.role = 'super_admin'::public.app_role
     AND ua.is_active IS NOT FALSE
    LEFT JOIN auth.users u ON u.id = ua.auth_uid
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.employees e
      WHERE e.tenant_id = t.id
    )
    ORDER BY t.id, ua.email
  LOOP
    v_employee_id := public.generate_next_code(v_row.tenant_id, 'EMP', 4);
    v_staff_raw := public.generate_next_code(v_row.tenant_id, 'STAFF', 4);

    IF v_staff_raw ~* '^[A-Z0-9]{2,5}-STAFF-[0-9]+$' THEN
      v_staff_id := upper(regexp_replace(v_staff_raw, '^([A-Z0-9]{2,5})-STAFF-([0-9]+)$', '\1\2', 'i'));
    ELSE
      v_staff_id := v_staff_raw;
    END IF;

    INSERT INTO public.positions (tenant_id, position_title)
    VALUES (v_row.tenant_id, 'Administrator')
    ON CONFLICT (tenant_id, position_title) DO NOTHING;

    INSERT INTO public.employees (
      tenant_id,
      employee_id,
      staff_id,
      full_name,
      email,
      employment_type,
      employment_status,
      position,
      date_hired
    )
    VALUES (
      v_row.tenant_id,
      v_employee_id,
      v_staff_id,
      v_row.full_name,
      v_row.email,
      'Full-Time',
      'Active',
      'Administrator',
      v_signup_date
    );

    UPDATE public.user_accounts
    SET employee_id = v_employee_id
    WHERE auth_uid = v_row.auth_uid
      AND tenant_id = v_row.tenant_id
      AND employee_id IS NULL;

    INSERT INTO public.approvers (tenant_id, employee_id)
    VALUES (v_row.tenant_id, v_employee_id)
    ON CONFLICT (tenant_id, employee_id) DO NOTHING;

    INSERT INTO public.leave_approver_config (
      tenant_id,
      approver_user_account_id,
      effective_from,
      notes
    )
    SELECT
      v_row.tenant_id,
      v_row.auth_uid,
      v_signup_date,
      'Backfill: initial tenant owner'
    WHERE NOT EXISTS (
      SELECT 1
      FROM public.leave_approver_config lac
      WHERE lac.tenant_id = v_row.tenant_id
    );
  END LOOP;
END $$;

COMMIT;
