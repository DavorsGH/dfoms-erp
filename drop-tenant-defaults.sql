DO $do$
DECLARE
  r RECORD;
BEGIN
  FOR r IN SELECT table_name FROM information_schema.columns
           WHERE table_schema='public' AND column_name='tenant_id'
  LOOP
    EXECUTE format(
      'ALTER TABLE public.%I ALTER COLUMN tenant_id DROP DEFAULT',
      r.table_name
    );
  END LOOP;
END $do$;
