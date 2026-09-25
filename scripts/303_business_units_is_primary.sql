BEGIN;

ALTER TABLE public.business_units
  ADD COLUMN IF NOT EXISTS is_primary boolean NOT NULL DEFAULT false;

CREATE UNIQUE INDEX IF NOT EXISTS business_units_one_primary_per_tenant_idx
  ON public.business_units (tenant_id)
  WHERE (is_primary IS TRUE);

ALTER TABLE public.business_units
  DROP CONSTRAINT IF EXISTS business_units_primary_must_be_active;

ALTER TABLE public.business_units
  ADD CONSTRAINT business_units_primary_must_be_active
  CHECK ((NOT is_primary) OR is_active);

UPDATE public.business_units SET is_primary = false;

DO $$
DECLARE
  v_tenant_id uuid;
  v_tenant_name text;
  v_chosen_id uuid;
  v_count integer;
BEGIN
  FOR v_tenant_id IN SELECT DISTINCT tenant_id FROM public.business_units
  LOOP
    SELECT count(*)::integer INTO v_count
    FROM public.business_units
    WHERE tenant_id = v_tenant_id AND is_active IS TRUE;

    IF v_count = 0 THEN
      CONTINUE;
    END IF;

    IF v_count = 1 THEN
      UPDATE public.business_units
      SET is_primary = true
      WHERE tenant_id = v_tenant_id AND is_active IS TRUE;
      CONTINUE;
    END IF;

    SELECT name INTO v_tenant_name FROM public.tenants WHERE id = v_tenant_id;

    SELECT id INTO v_chosen_id
    FROM public.business_units
    WHERE tenant_id = v_tenant_id
      AND is_active IS TRUE
      AND lower(trim(name)) = lower(trim(coalesce(v_tenant_name, '')))
    LIMIT 1;

    IF v_chosen_id IS NOT NULL THEN
      UPDATE public.business_units SET is_primary = true WHERE id = v_chosen_id;
      CONTINUE;
    END IF;

    SELECT bu.id INTO v_chosen_id
    FROM public.business_units bu
    WHERE bu.tenant_id = v_tenant_id
      AND bu.is_active IS TRUE
      AND (
        position(lower(trim(bu.name)) in lower(trim(coalesce(v_tenant_name, '')))) > 0
        OR position(lower(trim(coalesce(v_tenant_name, ''))) in lower(trim(bu.name))) > 0
      )
    ORDER BY bu.name
    LIMIT 1;

    IF v_chosen_id IS NOT NULL THEN
      UPDATE public.business_units SET is_primary = true WHERE id = v_chosen_id;
      CONTINUE;
    END IF;

    SELECT id INTO v_chosen_id
    FROM public.business_units
    WHERE tenant_id = v_tenant_id AND is_active IS TRUE
    ORDER BY name
    LIMIT 1;

    UPDATE public.business_units SET is_primary = true WHERE id = v_chosen_id;
  END LOOP;
END $$;

COMMIT;
