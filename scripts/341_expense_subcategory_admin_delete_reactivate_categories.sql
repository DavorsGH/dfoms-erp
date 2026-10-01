BEGIN;

CREATE OR REPLACE FUNCTION public.expense_subcategory_unlinked_is_linked_duplicate(p_subcategory_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.expense_subcategories u
    WHERE u.id = p_subcategory_id
      AND u.expense_category IS NULL
      AND EXISTS (
        SELECT 1
        FROM public.expense_subcategories l
        WHERE l.tenant_id = u.tenant_id
          AND lower(trim(l.name)) = lower(trim(u.name))
          AND l.expense_category IS NOT NULL
      )
  );
$$;

CREATE OR REPLACE FUNCTION public.admin_delete_expense_subcategory(p_subcategory_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_row public.expense_subcategories%ROWTYPE;
  v_usage jsonb;
  v_total bigint;
  v_deleted integer;
BEGIN
  SELECT * INTO v_row
  FROM public.expense_subcategories
  WHERE id = p_subcategory_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sub-category not found.');
  END IF;

  IF v_row.expense_category IS NULL
    AND public.expense_subcategory_unlinked_is_linked_duplicate(p_subcategory_id) THEN
    DELETE FROM public.expense_subcategories
    WHERE id = p_subcategory_id
      AND expense_category IS NULL;
    GET DIAGNOSTICS v_deleted = ROW_COUNT;
    IF v_deleted = 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'You do not have permission to delete this sub-category.');
    END IF;
    RETURN jsonb_build_object('ok', true);
  END IF;

  v_usage := public.lookup_usage_expense_subcategory(
    coalesce(v_row.expense_category, ''),
    v_row.name
  );

  v_total :=
    coalesce((v_usage->>'expense_register')::bigint, 0)
    + coalesce((v_usage->>'budgets')::bigint, 0)
    + coalesce((v_usage->>'accounts_payable')::bigint, 0)
    + coalesce((v_usage->>'supplier_contracts')::bigint, 0);

  IF v_total > 0 THEN
    RETURN jsonb_build_object(
      'ok',
      false,
      'error',
      format(
        'Can''t delete ''%s'': it''s used on %s record(s). Move those records first, or use Hide from new entries instead.',
        v_row.name,
        v_total
      )
    );
  END IF;

  DELETE FROM public.expense_subcategories WHERE id = p_subcategory_id;
  GET DIAGNOSTICS v_deleted = ROW_COUNT;
  IF v_deleted = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'You do not have permission to delete this sub-category.');
  END IF;
  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.expense_subcategory_unlinked_is_linked_duplicate(uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.admin_delete_expense_subcategory(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.expense_subcategory_unlinked_is_linked_duplicate(uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_delete_expense_subcategory(uuid) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;