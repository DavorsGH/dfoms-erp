ALTER TABLE public.salary_rate_config DROP CONSTRAINT IF EXISTS salary_rate_config_position_employment_type_shift_effective_key;

DROP INDEX IF EXISTS public.salary_rate_config_position_employment_type_shift_effective_key;

CREATE UNIQUE INDEX salary_rate_config_tenant_bu_position_type_shift_effective_key ON public.salary_rate_config USING btree (tenant_id, business_unit_id, "position", employment_type, shift, effective_date) NULLS NOT DISTINCT;
