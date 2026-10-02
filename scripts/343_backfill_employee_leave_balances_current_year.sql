WITH active_emp AS (
  SELECT e.tenant_id, e.employee_id, e."position", e.employment_type
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
  SELECT a.tenant_id, a.employee_id, a."position", a.employment_type, lt.id AS leave_type_id, lt.type_name
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
ins AS (
  INSERT INTO public.employee_leave_balances (
    tenant_id,
    employee_id,
    leave_type_id,
    year,
    entitled_days,
    days_used
  )
  SELECT
    m.tenant_id,
    m.employee_id,
    m.leave_type_id,
    EXTRACT(YEAR FROM CURRENT_DATE)::integer,
    public.resolve_leave_entitlement(m.tenant_id, m."position", m.employment_type, m.type_name),
    0
  FROM missing m
  RETURNING tenant_id, employee_id
)
SELECT
  ins.tenant_id,
  t.name AS tenant_name,
  count(DISTINCT ins.employee_id) AS employees_updated,
  count(*) AS rows_inserted
FROM ins
LEFT JOIN public.tenants t ON t.id = ins.tenant_id
GROUP BY ins.tenant_id, t.name
ORDER BY t.name;
