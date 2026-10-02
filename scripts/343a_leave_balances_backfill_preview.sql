WITH active_emp AS (
  SELECT e.tenant_id, e.employee_id
  FROM public.employees e
  WHERE e.tenant_id IS NOT NULL
    AND (
      NULLIF(BTRIM(e.employment_status), '') IS NULL
      OR LOWER(BTRIM(e.employment_status)) = 'active'
    )
    AND (
      e.appointment_end_date IS NULL
      OR e.appointment_end_date::date >= CURRENT_DATE
    )
),
missing AS (
  SELECT a.tenant_id, a.employee_id, lt.id AS leave_type_id
  FROM active_emp a
  JOIN public.leave_types lt
    ON lt.tenant_id = a.tenant_id
   AND lt.type_name IN ('Annual Leave', 'Sick Leave', 'Unpaid Leave')
  WHERE NOT EXISTS (
    SELECT 1
    FROM public.employee_leave_balances elb
    WHERE elb.tenant_id = a.tenant_id
      AND elb.employee_id = a.employee_id
      AND elb.leave_type_id = lt.id
      AND elb.year = EXTRACT(YEAR FROM CURRENT_DATE)::integer
  )
),
summary AS (
  SELECT
    t.id AS tenant_id,
    t.name AS tenant_name,
    (SELECT count(*) FROM active_emp a WHERE a.tenant_id = t.id) AS active_employees,
    (SELECT count(DISTINCT m.employee_id) FROM missing m WHERE m.tenant_id = t.id) AS employees_missing_rows,
    (SELECT count(*) FROM missing m WHERE m.tenant_id = t.id) AS rows_to_insert
  FROM public.tenants t
)
SELECT tenant_id, tenant_name, active_employees, employees_missing_rows, rows_to_insert
FROM summary
WHERE active_employees > 0 OR rows_to_insert > 0
ORDER BY tenant_name;
