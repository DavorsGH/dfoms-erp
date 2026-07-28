-- 125_payroll_processing_tenant_unique.sql
-- Align payroll_processing / payroll_history unique keys with multi-tenant upserts.
--
-- App path (payroll-processing.tsx) uses:
--   onConflict: "tenant_id,payroll_month,employee_id"
--
-- Production already accepts that target; staging still has legacy
-- UNIQUE (payroll_month, employee_id) only. This script is idempotent.

BEGIN;

DO $$
DECLARE
  rec record;
BEGIN
  -- Drop any UNIQUE constraint on payroll_processing whose columns are
  -- exactly (payroll_month, employee_id) — the legacy non-tenant key.
  FOR rec IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'payroll_processing'
      AND c.contype = 'u'
      AND (
        SELECT array_agg(a.attname::text ORDER BY u.ord)
        FROM unnest(c.conkey) WITH ORDINALITY AS u(attnum, ord)
        JOIN pg_attribute a
          ON a.attrelid = c.conrelid AND a.attnum = u.attnum
      ) = ARRAY['payroll_month', 'employee_id']::text[]
  LOOP
    EXECUTE format(
      'ALTER TABLE public.payroll_processing DROP CONSTRAINT %I',
      rec.conname
    );
    RAISE NOTICE 'Dropped legacy payroll_processing unique %', rec.conname;
  END LOOP;

  -- Same for payroll_history
  FOR rec IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'payroll_history'
      AND c.contype = 'u'
      AND (
        SELECT array_agg(a.attname::text ORDER BY u.ord)
        FROM unnest(c.conkey) WITH ORDINALITY AS u(attnum, ord)
        JOIN pg_attribute a
          ON a.attrelid = c.conrelid AND a.attnum = u.attnum
      ) = ARRAY['payroll_month', 'employee_id']::text[]
  LOOP
    EXECUTE format(
      'ALTER TABLE public.payroll_history DROP CONSTRAINT %I',
      rec.conname
    );
    RAISE NOTICE 'Dropped legacy payroll_history unique %', rec.conname;
  END LOOP;

  -- Ensure tenant-scoped unique exists on payroll_processing
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'payroll_processing'
      AND c.contype = 'u'
      AND (
        SELECT array_agg(a.attname::text ORDER BY u.ord)
        FROM unnest(c.conkey) WITH ORDINALITY AS u(attnum, ord)
        JOIN pg_attribute a
          ON a.attrelid = c.conrelid AND a.attnum = u.attnum
      ) = ARRAY['tenant_id', 'payroll_month', 'employee_id']::text[]
  ) THEN
    ALTER TABLE public.payroll_processing
      ADD CONSTRAINT payroll_processing_tenant_month_employee_key
      UNIQUE (tenant_id, payroll_month, employee_id);
    RAISE NOTICE 'Added payroll_processing_tenant_month_employee_key';
  ELSE
    RAISE NOTICE 'payroll_processing tenant unique already present';
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_class t ON t.oid = c.conrelid
    JOIN pg_namespace n ON n.oid = t.relnamespace
    WHERE n.nspname = 'public'
      AND t.relname = 'payroll_history'
      AND c.contype = 'u'
      AND (
        SELECT array_agg(a.attname::text ORDER BY u.ord)
        FROM unnest(c.conkey) WITH ORDINALITY AS u(attnum, ord)
        JOIN pg_attribute a
          ON a.attrelid = c.conrelid AND a.attnum = u.attnum
      ) = ARRAY['tenant_id', 'payroll_month', 'employee_id']::text[]
  ) THEN
    ALTER TABLE public.payroll_history
      ADD CONSTRAINT payroll_history_tenant_month_employee_key
      UNIQUE (tenant_id, payroll_month, employee_id);
    RAISE NOTICE 'Added payroll_history_tenant_month_employee_key';
  ELSE
    RAISE NOTICE 'payroll_history tenant unique already present';
  END IF;
END $$;

COMMIT;
