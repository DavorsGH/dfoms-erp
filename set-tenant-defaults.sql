DO $do$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT table_name FROM information_schema.columns
           WHERE table_schema='public' AND column_name='tenant_id'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ALTER COLUMN tenant_id SET DEFAULT %L::uuid',
      r.table_name,
      '00000001-0000-4000-8000-000000000001'
    );
  END LOOP;
END $do$;
