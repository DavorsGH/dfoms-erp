BEGIN;

ALTER TABLE public.salary_rate_config
  DROP CONSTRAINT IF EXISTS salary_rate_config_employment_type_check;

ALTER TABLE public.salary_rate_config
  ADD CONSTRAINT salary_rate_config_employment_type_check
  CHECK (employment_type = ANY (ARRAY['Casual'::text, 'Part-Time'::text, 'Full-Time'::text, 'Contract'::text]));

ALTER TABLE public.compensation_policy
  DROP CONSTRAINT IF EXISTS compensation_policy_employment_type_check;

ALTER TABLE public.compensation_policy
  ADD CONSTRAINT compensation_policy_employment_type_check
  CHECK (employment_type = ANY (ARRAY['Casual'::text, 'Part-Time'::text, 'Full-Time'::text, 'Contract'::text]));

ALTER TABLE public.leave_entitlement_policy
  DROP CONSTRAINT IF EXISTS leave_entitlement_policy_employment_type_check;

ALTER TABLE public.leave_entitlement_policy
  ADD CONSTRAINT leave_entitlement_policy_employment_type_check
  CHECK (employment_type = ANY (ARRAY['Casual'::text, 'Part-Time'::text, 'Full-Time'::text, 'Contract'::text]));

COMMIT;

NOTIFY pgrst, 'reload schema';
