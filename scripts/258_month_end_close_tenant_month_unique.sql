-- Restore month_end_close unique to match deployed lock/reopen/release APIs.
-- Live bug: constraint was changed to (tenant_id, business_unit_id, month) out-of-band,
-- while app still upserts with onConflict "tenant_id,month" → Postgres 42P10.
-- business_unit_id column is kept for future stamping; locks remain tenant+month scoped.

ALTER TABLE public.month_end_close
  DROP CONSTRAINT IF EXISTS month_end_close_tenant_bu_month_unique;

DROP INDEX IF EXISTS public.month_end_close_tenant_bu_month_unique;

ALTER TABLE public.month_end_close
  DROP CONSTRAINT IF EXISTS month_end_close_tenant_month_unique;

ALTER TABLE public.month_end_close
  ADD CONSTRAINT month_end_close_tenant_month_unique
  UNIQUE (tenant_id, month);
