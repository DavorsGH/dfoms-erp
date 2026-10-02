BEGIN;

DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.conname
    FROM pg_constraint c
    WHERE c.conrelid = 'public.leave_types'::regclass
      AND c.contype = 'u'
      AND c.conkey = ARRAY[
        (SELECT a.attnum FROM pg_attribute a WHERE a.attrelid = 'public.leave_types'::regclass AND a.attname = 'type_name')
      ]::smallint[]
  LOOP
    EXECUTE format('ALTER TABLE public.leave_types DROP CONSTRAINT %I', r.conname);
  END LOOP;

  FOR r IN
    SELECT i.indexrelid::regclass::text AS index_name
    FROM pg_index i
    WHERE i.indrelid = 'public.leave_types'::regclass
      AND i.indisunique
      AND NOT i.indisprimary
      AND i.indnkeyatts = 1
      AND i.indkey[0] = (SELECT a.attnum FROM pg_attribute a WHERE a.attrelid = 'public.leave_types'::regclass AND a.attname = 'type_name')
      AND NOT EXISTS (SELECT 1 FROM pg_constraint c WHERE c.conindid = i.indexrelid)
  LOOP
    EXECUTE format('DROP INDEX %s', r.index_name);
  END LOOP;

  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint c
    WHERE c.conrelid = 'public.leave_types'::regclass
      AND c.conname = 'leave_types_tenant_id_type_name_key'
  ) THEN
    ALTER TABLE public.leave_types
      ADD CONSTRAINT leave_types_tenant_id_type_name_key UNIQUE (tenant_id, type_name);
  END IF;
END;
$$;

INSERT INTO public.leave_types (tenant_id, type_name, default_annual_entitlement)
SELECT t.id, v.type_name, v.default_days
FROM public.tenants t
CROSS JOIN (
  VALUES
    ('Annual Leave'::text, 15::numeric),
    ('Sick Leave'::text, NULL::numeric),
    ('Unpaid Leave'::text, 0::numeric)
) AS v(type_name, default_days)
WHERE NOT EXISTS (
  SELECT 1
  FROM public.leave_types lt
  WHERE lt.tenant_id = t.id
    AND lt.type_name = v.type_name
);

COMMIT;

SELECT
  t.name AS tenant_name,
  count(lt.id) AS leave_types
FROM public.tenants t
LEFT JOIN public.leave_types lt ON lt.tenant_id = t.id
GROUP BY t.name
ORDER BY t.name;
