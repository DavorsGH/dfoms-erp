BEGIN;

CREATE OR REPLACE FUNCTION public.get_duty_roster_employee_display_scoped(p_business_unit_id uuid, p_view_all boolean)
RETURNS TABLE(employee_id text, staff_id text, full_name text, "position" text, shift text, contract_project text, employment_status text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT
    e.employee_id,
    e.staff_id,
    e.full_name,
    e."position",
    e.shift,
    e.contract_project,
    e.employment_status
  FROM employees e
  WHERE tenant_matches(e.tenant_id)
    AND (
      can_view_duty_roster_company_wide()
      OR can_access_employee_record(e.assigned_site_id)
      OR e.employee_id = current_user_employee_id()
    )
    AND (
      (
        p_view_all
        AND current_user_view_all_business_units()
        AND (
          e.business_unit_id IS NULL
          OR user_has_business_unit_access(e.business_unit_id)
        )
      )
      OR (
        p_business_unit_id IS NOT NULL
        AND e.business_unit_id = p_business_unit_id
        AND user_has_business_unit_access(p_business_unit_id)
      )
      OR (
        p_business_unit_id IS NULL
        AND e.business_unit_id IS NULL
      )
    )
  ORDER BY e.staff_id ASC;
$function$;

NOTIFY pgrst, 'reload schema';

COMMIT;
