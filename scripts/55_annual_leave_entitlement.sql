-- Script 55: Set Annual Leave entitlement to 15 days (Ghana Labour Act 2003, Act 651)
-- employee_leave_balances.entitled_days is copied at seed time, not live-linked
-- to leave_types — update both the default and existing 2026 balance rows.

BEGIN;

UPDATE leave_types
SET default_annual_entitlement = 15
WHERE type_name = 'Annual Leave';

UPDATE employee_leave_balances elb
SET entitled_days = 15,
    updated_at = now()
FROM leave_types lt
WHERE elb.leave_type_id = lt.id
  AND lt.type_name = 'Annual Leave'
  AND elb.year = 2026;

NOTIFY pgrst, 'reload schema';

COMMIT;
