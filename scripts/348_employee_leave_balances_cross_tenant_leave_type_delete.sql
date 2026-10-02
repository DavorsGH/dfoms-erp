WITH deleted AS (
  DELETE FROM public.employee_leave_balances b
  USING public.leave_types lt
  WHERE lt.id = b.leave_type_id
    AND lt.tenant_id IS DISTINCT FROM b.tenant_id
    AND COALESCE(b.days_used, 0) = 0
    AND NOT EXISTS (
      SELECT 1
      FROM public.leave_requests r
      WHERE r.leave_type_id = b.leave_type_id
        AND r.employee_id = b.employee_id
        AND r.tenant_id = b.tenant_id
    )
  RETURNING b.tenant_id, b.employee_id, b.year, lt.type_name
)
SELECT t.name AS tenant_name, d.employee_id, d.year, d.type_name
FROM deleted d
LEFT JOIN public.tenants t ON t.id = d.tenant_id
ORDER BY t.name, d.employee_id, d.type_name;
