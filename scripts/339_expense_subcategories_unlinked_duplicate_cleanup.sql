BEGIN;

DELETE FROM public.expense_subcategories es
USING (
  WITH linked_name_keys AS (
    SELECT
      es_agg.tenant_id,
      lower(trim(es_agg.name)) AS name_key,
      count(DISTINCT es_agg.expense_category) AS linked_category_count
    FROM public.expense_subcategories es_agg
    WHERE es_agg.expense_category IS NOT NULL
    GROUP BY es_agg.tenant_id, lower(trim(es_agg.name))
  )
  SELECT es_candidate.id
  FROM public.expense_subcategories es_candidate
  INNER JOIN linked_name_keys lk
    ON lk.tenant_id = es_candidate.tenant_id
   AND lk.name_key = lower(trim(es_candidate.name))
  WHERE es_candidate.expense_category IS NULL
    AND lk.linked_category_count = 1
) target
WHERE es.id = target.id;

UPDATE public.expense_subcategories es
SET is_active = false
FROM (
  WITH linked_name_keys AS (
    SELECT
      es_agg.tenant_id,
      lower(trim(es_agg.name)) AS name_key,
      count(DISTINCT es_agg.expense_category) AS linked_category_count
    FROM public.expense_subcategories es_agg
    WHERE es_agg.expense_category IS NOT NULL
    GROUP BY es_agg.tenant_id, lower(trim(es_agg.name))
  )
  SELECT tenant_id, name_key, linked_category_count
  FROM linked_name_keys
  WHERE linked_category_count > 1
) lk
WHERE es.expense_category IS NULL
  AND es.tenant_id = lk.tenant_id
  AND lower(trim(es.name)) = lk.name_key
  AND es.is_active = true;

NOTIFY pgrst, 'reload schema';

COMMIT;
