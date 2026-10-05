BEGIN;

CREATE OR REPLACE FUNCTION public._backfill_null_business_unit_ids_core(
  p_tenant_id uuid,
  p_business_unit_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_bu_count integer;
  v_table text;
  v_updated bigint;
  v_updates jsonb := '{}'::jsonb;
  v_total bigint := 0;
BEGIN
  IF p_tenant_id IS NULL OR p_business_unit_id IS NULL THEN
    RETURN jsonb_build_object(
      'skipped', true,
      'reason', 'missing_tenant_or_business_unit_id'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM public.business_units bu
    WHERE bu.id = p_business_unit_id
      AND bu.tenant_id = p_tenant_id
  ) THEN
    RETURN jsonb_build_object(
      'skipped', true,
      'reason', 'business_unit_not_in_tenant'
    );
  END IF;

  SELECT count(*)::integer
  INTO v_bu_count
  FROM public.business_units bu
  WHERE bu.tenant_id = p_tenant_id;

  IF v_bu_count <> 1 THEN
    RETURN jsonb_build_object(
      'skipped', true,
      'reason', 'not_single_business_unit_tenant',
      'business_unit_count', v_bu_count
    );
  END IF;

  FOR v_table IN
    SELECT DISTINCT c1.table_name
    FROM information_schema.columns c1
    INNER JOIN information_schema.columns c2
      ON c1.table_schema = c2.table_schema
      AND c1.table_name = c2.table_name
    WHERE c1.table_schema = 'public'
      AND c1.column_name = 'tenant_id'
      AND c2.column_name = 'business_unit_id'
      AND c1.table_name NOT IN ('payment_account_business_units')
    ORDER BY 1
  LOOP
    EXECUTE format(
      'UPDATE public.%I SET business_unit_id = $1 WHERE tenant_id = $2 AND business_unit_id IS NULL',
      v_table
    )
    USING p_business_unit_id, p_tenant_id;

    GET DIAGNOSTICS v_updated = ROW_COUNT;
    IF v_updated > 0 THEN
      v_updates := v_updates || jsonb_build_object(v_table, v_updated);
      v_total := v_total + v_updated;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'skipped', false,
    'tenant_id', p_tenant_id,
    'business_unit_id', p_business_unit_id,
    'rows_updated_total', v_total,
    'rows_updated_by_table', v_updates
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.backfill_null_business_unit_ids_after_first_unit(
  p_tenant_id uuid,
  p_business_unit_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  PERFORM public.assert_caller_can_act_for_tenant(p_tenant_id);
  RETURN public._backfill_null_business_unit_ids_core(p_tenant_id, p_business_unit_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.backfill_null_business_unit_ids_for_single_unit_tenant(
  p_tenant_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_business_unit_id uuid;
BEGIN
  PERFORM public.assert_caller_can_act_for_tenant(p_tenant_id);

  SELECT bu.id
  INTO v_business_unit_id
  FROM public.business_units bu
  WHERE bu.tenant_id = p_tenant_id
  ORDER BY bu.created_at NULLS LAST, bu.id
  LIMIT 1;

  IF v_business_unit_id IS NULL THEN
    RETURN jsonb_build_object(
      'skipped', true,
      'reason', 'no_business_unit_for_tenant'
    );
  END IF;

  RETURN public._backfill_null_business_unit_ids_core(p_tenant_id, v_business_unit_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.trg_business_units_after_insert_first_bu_backfill()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  PERFORM public._backfill_null_business_unit_ids_core(NEW.tenant_id, NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_business_units_after_insert_first_bu_backfill ON public.business_units;

CREATE TRIGGER trg_business_units_after_insert_first_bu_backfill
  AFTER INSERT ON public.business_units
  FOR EACH ROW
  EXECUTE FUNCTION public.trg_business_units_after_insert_first_bu_backfill();

CREATE OR REPLACE FUNCTION public.audit_single_business_unit_tenant_null_bu_counts()
RETURNS TABLE (
  tenant_id uuid,
  tenant_slug text,
  business_unit_id uuid,
  business_unit_name text,
  scoped_table text,
  null_business_unit_row_count bigint
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_tenant record;
  v_table text;
  v_count bigint;
BEGIN
  FOR v_tenant IN
    SELECT
      t.id AS tenant_id,
      t.slug AS tenant_slug,
      bu.id AS business_unit_id,
      bu.name AS business_unit_name
    FROM public.tenants t
    INNER JOIN public.business_units bu ON bu.tenant_id = t.id
    WHERE (
      SELECT count(*)::integer
      FROM public.business_units bu2
      WHERE bu2.tenant_id = t.id
    ) = 1
  LOOP
    FOR v_table IN
      SELECT DISTINCT c1.table_name
      FROM information_schema.columns c1
      INNER JOIN information_schema.columns c2
        ON c1.table_schema = c2.table_schema
        AND c1.table_name = c2.table_name
      WHERE c1.table_schema = 'public'
        AND c1.column_name = 'tenant_id'
        AND c2.column_name = 'business_unit_id'
        AND c1.table_name NOT IN ('payment_account_business_units')
      ORDER BY 1
    LOOP
      EXECUTE format(
        'SELECT count(*)::bigint FROM public.%I WHERE tenant_id = $1 AND business_unit_id IS NULL',
        v_table
      )
      INTO v_count
      USING v_tenant.tenant_id;

      IF v_count > 0 THEN
        tenant_id := v_tenant.tenant_id;
        tenant_slug := v_tenant.tenant_slug;
        business_unit_id := v_tenant.business_unit_id;
        business_unit_name := v_tenant.business_unit_name;
        scoped_table := v_table;
        null_business_unit_row_count := v_count;
        RETURN NEXT;
      END IF;
    END LOOP;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public._backfill_null_business_unit_ids_core(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._backfill_null_business_unit_ids_core(uuid, uuid) FROM anon;
REVOKE ALL ON FUNCTION public._backfill_null_business_unit_ids_core(uuid, uuid) FROM authenticated;

REVOKE ALL ON FUNCTION public.backfill_null_business_unit_ids_after_first_unit(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.backfill_null_business_unit_ids_after_first_unit(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.backfill_null_business_unit_ids_after_first_unit(uuid, uuid) TO service_role;

REVOKE ALL ON FUNCTION public.backfill_null_business_unit_ids_for_single_unit_tenant(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.backfill_null_business_unit_ids_for_single_unit_tenant(uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.backfill_null_business_unit_ids_for_single_unit_tenant(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.audit_single_business_unit_tenant_null_bu_counts() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.audit_single_business_unit_tenant_null_bu_counts() FROM anon;
GRANT EXECUTE ON FUNCTION public.audit_single_business_unit_tenant_null_bu_counts() TO service_role;

REVOKE EXECUTE ON FUNCTION public._backfill_null_business_unit_ids_core(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._backfill_null_business_unit_ids_core(uuid, uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.backfill_null_business_unit_ids_after_first_unit(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_null_business_unit_ids_after_first_unit(uuid, uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.backfill_null_business_unit_ids_for_single_unit_tenant(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.backfill_null_business_unit_ids_for_single_unit_tenant(uuid) TO service_role;

REVOKE EXECUTE ON FUNCTION public.audit_single_business_unit_tenant_null_bu_counts() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.audit_single_business_unit_tenant_null_bu_counts() TO service_role;

REVOKE EXECUTE ON FUNCTION public.trg_business_units_after_insert_first_bu_backfill() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.trg_business_units_after_insert_first_bu_backfill() TO service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
