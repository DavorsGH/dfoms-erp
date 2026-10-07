BEGIN;

INSERT INTO public.leave_types (tenant_id, type_name, default_annual_entitlement)
SELECT t.id, 'Compassionate Leave', 0
FROM public.tenants t
WHERE NOT EXISTS (
  SELECT 1
  FROM public.leave_types lt
  WHERE lt.tenant_id = t.id
    AND lt.type_name = 'Compassionate Leave'
);

ALTER TABLE public.leave_entitlement_policy
  DROP CONSTRAINT IF EXISTS leave_entitlement_policy_leave_type_check;

ALTER TABLE public.leave_entitlement_policy
  ADD CONSTRAINT leave_entitlement_policy_leave_type_check
  CHECK (
    leave_type = ANY (
      ARRAY[
        'Annual Leave'::text,
        'Sick Leave'::text,
        'Unpaid Leave'::text,
        'Maternity Leave'::text,
        'Compassionate Leave'::text
      ]
    )
  );

INSERT INTO public.leave_entitlement_policy (
  tenant_id,
  "position",
  employment_type,
  leave_type,
  entitled_days
)
SELECT t.id, '__DEFAULT__', '__ALL__', 'Compassionate Leave', 0
FROM public.tenants t
WHERE NOT EXISTS (
  SELECT 1
  FROM public.leave_entitlement_policy lep
  WHERE lep.tenant_id = t.id
    AND lep."position" = '__DEFAULT__'
    AND lep.employment_type = '__ALL__'
    AND lep.leave_type = 'Compassionate Leave'
);

UPDATE public.leave_requests lr
SET leave_type_id = lt.id
FROM public.leave_types lt
WHERE lt.tenant_id = lr.tenant_id
  AND lt.type_name = 'Compassionate Leave'
  AND lr.leave_type_id IS DISTINCT FROM lt.id
  AND EXISTS (
    SELECT 1
    FROM public.leave_types cur
    WHERE cur.id = lr.leave_type_id
      AND cur.type_name ILIKE 'compassionate%'
  );

COMMIT;
