BEGIN;

ALTER TABLE public.expense_categories
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

ALTER TABLE public.expense_subcategories
  ADD COLUMN IF NOT EXISTS id uuid DEFAULT gen_random_uuid();

UPDATE public.expense_subcategories
SET id = gen_random_uuid()
WHERE id IS NULL;

ALTER TABLE public.expense_subcategories
  ALTER COLUMN id SET NOT NULL;

ALTER TABLE public.expense_subcategories
  ADD COLUMN IF NOT EXISTS expense_category text;

ALTER TABLE public.expense_subcategories
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

ALTER TABLE public.expense_subcategories
  DROP CONSTRAINT IF EXISTS expense_subcategories_pkey;

ALTER TABLE public.expense_subcategories
  ADD CONSTRAINT expense_subcategories_pkey PRIMARY KEY (id);

DROP INDEX IF EXISTS public.expense_subcategories_tenant_category_name_lower_uidx;

WITH register_spelling AS (
  SELECT
    er.tenant_id,
    trim(er.expense_category) AS expense_category,
    lower(trim(er.sub_category)) AS name_key,
    trim(er.sub_category) AS spelling,
    count(*) AS use_count
  FROM public.expense_register er
  WHERE er.tenant_id IS NOT NULL
    AND trim(coalesce(er.sub_category, '')) <> ''
    AND trim(coalesce(er.expense_category, '')) <> ''
  GROUP BY er.tenant_id, trim(er.expense_category), lower(trim(er.sub_category)), trim(er.sub_category)
),
register_canonical AS (
  SELECT DISTINCT ON (tenant_id, expense_category, name_key)
    tenant_id,
    expense_category,
    name_key,
    spelling AS canonical_name
  FROM register_spelling
  ORDER BY tenant_id, expense_category, name_key, use_count DESC, spelling ASC
),
lookup_spelling AS (
  SELECT
    es.tenant_id,
    es.expense_category,
    lower(trim(es.name)) AS name_key,
    trim(es.name) AS spelling,
    count(*) AS lookup_count
  FROM public.expense_subcategories es
  WHERE es.expense_category IS NOT NULL
  GROUP BY es.tenant_id, es.expense_category, lower(trim(es.name)), trim(es.name)
),
lookup_canonical AS (
  SELECT DISTINCT ON (tenant_id, expense_category, name_key)
    tenant_id,
    expense_category,
    name_key,
    spelling AS canonical_name
  FROM lookup_spelling
  ORDER BY tenant_id, expense_category, name_key, lookup_count DESC, spelling ASC
),
insert_candidates AS (
  SELECT
    rc.tenant_id,
    coalesce(lc.canonical_name, rc.canonical_name) AS canonical_name,
    rc.expense_category,
    rc.name_key
  FROM register_canonical rc
  LEFT JOIN lookup_canonical lc
    ON lc.tenant_id = rc.tenant_id
   AND lc.expense_category IS NOT DISTINCT FROM rc.expense_category
   AND lc.name_key = rc.name_key
)
INSERT INTO public.expense_subcategories (tenant_id, name, expense_category, is_active)
SELECT
  ic.tenant_id,
  ic.canonical_name,
  ic.expense_category,
  true
FROM insert_candidates ic
WHERE NOT EXISTS (
  SELECT 1
  FROM public.expense_subcategories es
  WHERE es.tenant_id = ic.tenant_id
    AND es.expense_category IS NOT DISTINCT FROM ic.expense_category
    AND lower(trim(es.name)) = ic.name_key
);

WITH single_category AS (
  SELECT
    er.tenant_id,
    lower(trim(er.sub_category)) AS name_key,
    min(trim(er.expense_category)) AS single_category
  FROM public.expense_register er
  WHERE er.tenant_id IS NOT NULL
    AND trim(coalesce(er.sub_category, '')) <> ''
    AND trim(coalesce(er.expense_category, '')) <> ''
  GROUP BY er.tenant_id, lower(trim(er.sub_category))
  HAVING count(DISTINCT trim(er.expense_category)) = 1
),
register_spelling AS (
  SELECT
    er.tenant_id,
    trim(er.expense_category) AS expense_category,
    lower(trim(er.sub_category)) AS name_key,
    trim(er.sub_category) AS spelling,
    count(*) AS use_count
  FROM public.expense_register er
  WHERE er.tenant_id IS NOT NULL
    AND trim(coalesce(er.sub_category, '')) <> ''
    AND trim(coalesce(er.expense_category, '')) <> ''
  GROUP BY er.tenant_id, trim(er.expense_category), lower(trim(er.sub_category)), trim(er.sub_category)
),
register_canonical AS (
  SELECT DISTINCT ON (tenant_id, expense_category, name_key)
    tenant_id,
    expense_category,
    name_key,
    spelling AS canonical_name
  FROM register_spelling
  ORDER BY tenant_id, expense_category, name_key, use_count DESC, spelling ASC
)
UPDATE public.expense_subcategories es
SET expense_category = sc.single_category,
    name = coalesce(rc.canonical_name, es.name)
FROM single_category sc
LEFT JOIN register_canonical rc
  ON rc.tenant_id = sc.tenant_id
 AND rc.name_key = sc.name_key
 AND rc.expense_category IS NOT DISTINCT FROM sc.single_category
WHERE es.tenant_id = sc.tenant_id
  AND es.expense_category IS NULL
  AND lower(trim(es.name)) = sc.name_key;

WITH register_spelling AS (
  SELECT
    er.tenant_id,
    trim(er.expense_category) AS expense_category,
    lower(trim(er.sub_category)) AS name_key,
    trim(er.sub_category) AS spelling,
    count(*) AS use_count
  FROM public.expense_register er
  WHERE er.tenant_id IS NOT NULL
    AND trim(coalesce(er.sub_category, '')) <> ''
    AND trim(coalesce(er.expense_category, '')) <> ''
  GROUP BY er.tenant_id, trim(er.expense_category), lower(trim(er.sub_category)), trim(er.sub_category)
),
register_canonical AS (
  SELECT DISTINCT ON (tenant_id, expense_category, name_key)
    tenant_id,
    expense_category,
    name_key,
    spelling AS canonical_name
  FROM register_spelling
  ORDER BY tenant_id, expense_category, name_key, use_count DESC, spelling ASC
),
ranked AS (
  SELECT
    es.id,
    es.tenant_id,
    es.expense_category,
    lower(trim(es.name)) AS name_key,
    row_number() OVER (
      PARTITION BY es.tenant_id, es.expense_category, lower(trim(es.name))
      ORDER BY es.id
    ) AS rn,
    rc.canonical_name
  FROM public.expense_subcategories es
  LEFT JOIN register_canonical rc
    ON rc.tenant_id = es.tenant_id
   AND rc.expense_category IS NOT DISTINCT FROM es.expense_category
   AND rc.name_key = lower(trim(es.name))
  WHERE es.expense_category IS NOT NULL
),
keepers AS (
  SELECT id, canonical_name
  FROM ranked
  WHERE rn = 1
)
UPDATE public.expense_subcategories es
SET name = coalesce(k.canonical_name, es.name)
FROM keepers k
WHERE es.id = k.id;

DELETE FROM public.expense_subcategories es
USING (
  SELECT id
  FROM (
    SELECT
      id,
      row_number() OVER (
        PARTITION BY tenant_id, expense_category, lower(trim(name))
        ORDER BY id
      ) AS rn
    FROM public.expense_subcategories
    WHERE expense_category IS NOT NULL
  ) ranked
  WHERE rn > 1
) dup
WHERE es.id = dup.id;

UPDATE public.expense_subcategories es
SET is_active = false
WHERE es.expense_category IS NULL
  AND EXISTS (
    SELECT 1
    FROM public.expense_subcategories es2
    WHERE es2.tenant_id = es.tenant_id
      AND lower(trim(es2.name)) = lower(trim(es.name))
      AND es2.expense_category IS NOT NULL
      AND es2.id <> es.id
  );

DO $$
DECLARE
  collision record;
  details text := '';
BEGIN
  FOR collision IN
    SELECT
      es.tenant_id,
      es.expense_category,
      lower(trim(es.name)) AS name_key,
      count(*) AS row_count,
      string_agg(trim(es.name), ', ' ORDER BY trim(es.name)) AS spellings
    FROM public.expense_subcategories es
    WHERE es.expense_category IS NOT NULL
    GROUP BY es.tenant_id, es.expense_category, lower(trim(es.name))
    HAVING count(*) > 1
  LOOP
    details := details || format(
      E'\ntenant_id=%s category=%s name_key=%s rows=%s spellings=[%s]',
      collision.tenant_id,
      collision.expense_category,
      collision.name_key,
      collision.row_count,
      collision.spellings
    );
  END LOOP;

  IF details <> '' THEN
    RAISE EXCEPTION 'expense_subcategories deduplication incomplete:%', details;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS expense_subcategories_tenant_category_name_lower_uidx
  ON public.expense_subcategories (
    tenant_id,
    expense_category,
    lower(trim(name))
  )
  WHERE expense_category IS NOT NULL;

NOTIFY pgrst, 'reload schema';

COMMIT;
