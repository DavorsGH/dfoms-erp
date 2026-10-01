BEGIN;

ALTER TABLE public.asset_categories
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

CREATE OR REPLACE FUNCTION public.lookup_usage_expense_category(p_name text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'expense_register',
    (SELECT count(*)::bigint FROM public.expense_register er
      WHERE lower(trim(coalesce(er.expense_category, ''))) = lower(trim(p_name))),
    'budgets',
    (SELECT count(*)::bigint FROM public.budgets b
      WHERE lower(trim(coalesce(b.category, ''))) = lower(trim(p_name))),
    'accounts_payable',
    (SELECT count(*)::bigint FROM public.accounts_payable ap
      WHERE lower(trim(coalesce(ap.expense_category, ''))) = lower(trim(p_name))),
    'supplier_contracts',
    (SELECT count(*)::bigint FROM public.supplier_contracts sc
      WHERE lower(trim(coalesce(sc.expense_category, ''))) = lower(trim(p_name))),
    'linked_subcategories',
    (SELECT count(*)::bigint FROM public.expense_subcategories es
      WHERE trim(coalesce(es.expense_category, '')) <> ''
        AND lower(trim(es.expense_category)) = lower(trim(p_name)))
  );
$$;

CREATE OR REPLACE FUNCTION public.lookup_usage_expense_subcategory(
  p_category text,
  p_sub_name text
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'expense_register',
    (SELECT count(*)::bigint FROM public.expense_register er
      WHERE lower(trim(coalesce(er.sub_category, ''))) = lower(trim(p_sub_name))
        AND (
          trim(coalesce(p_category, '')) = ''
          OR lower(trim(coalesce(er.expense_category, ''))) = lower(trim(p_category))
        )),
    'budgets',
    (SELECT count(*)::bigint FROM public.budgets b
      WHERE lower(trim(coalesce(b.subcategory, ''))) = lower(trim(p_sub_name))
        AND (
          trim(coalesce(p_category, '')) = ''
          OR lower(trim(coalesce(b.category, ''))) = lower(trim(p_category))
        )),
    'accounts_payable',
    (SELECT count(*)::bigint FROM public.accounts_payable ap
      WHERE lower(trim(coalesce(ap.sub_category, ''))) = lower(trim(p_sub_name))
        AND (
          trim(coalesce(p_category, '')) = ''
          OR lower(trim(coalesce(ap.expense_category, ''))) = lower(trim(p_category))
        )),
    'supplier_contracts',
    (SELECT count(*)::bigint FROM public.supplier_contracts sc
      WHERE lower(trim(coalesce(sc.sub_category, ''))) = lower(trim(p_sub_name))
        AND (
          trim(coalesce(p_category, '')) = ''
          OR lower(trim(coalesce(sc.expense_category, ''))) = lower(trim(p_category))
        ))
  );
$$;

CREATE OR REPLACE FUNCTION public.lookup_usage_asset_category(p_name text)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY INVOKER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'fixed_assets',
    (SELECT count(*)::bigint FROM public.fixed_assets fa
      WHERE lower(trim(coalesce(fa.asset_category, ''))) = lower(trim(p_name)))
  );
$$;

GRANT EXECUTE ON FUNCTION public.lookup_usage_expense_category(text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lookup_usage_expense_subcategory(text, text) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.lookup_usage_asset_category(text) TO authenticated, service_role;

NOTIFY pgrst, 'reload schema';

COMMIT;
