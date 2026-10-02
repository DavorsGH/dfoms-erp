SELECT
  t.id AS tenant_id,
  t.name AS tenant_name,
  (SELECT count(*) FROM public.leave_types lt WHERE lt.tenant_id = t.id) AS leave_types_now,
  3 - (
    SELECT count(DISTINCT lt.type_name)
    FROM public.leave_types lt
    WHERE lt.tenant_id = t.id
      AND lt.type_name IN ('Annual Leave', 'Sick Leave', 'Unpaid Leave')
  ) AS types_to_add,
  (SELECT count(*) FROM public.employees e WHERE e.tenant_id = t.id) AS employees
FROM public.tenants t
ORDER BY types_to_add DESC, t.name;
