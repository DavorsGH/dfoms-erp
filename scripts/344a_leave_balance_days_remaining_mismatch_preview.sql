SELECT
  elb.tenant_id,
  t.name AS tenant_name,
  elb.employee_id,
  lt.type_name,
  elb.year,
  elb.entitled_days,
  elb.days_used,
  elb.days_remaining,
  (elb.entitled_days - elb.days_used) AS expected_remaining
FROM employee_leave_balances elb
LEFT JOIN tenants t ON t.id = elb.tenant_id
LEFT JOIN leave_types lt ON lt.id = elb.leave_type_id
WHERE elb.days_remaining IS DISTINCT FROM (elb.entitled_days - elb.days_used)
ORDER BY t.name, elb.employee_id, elb.year, lt.type_name;
