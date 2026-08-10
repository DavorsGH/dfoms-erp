BEGIN;

ALTER TABLE public.customers
  DROP CONSTRAINT IF EXISTS customers_customer_type_check;

ALTER TABLE public.customers
  ADD CONSTRAINT customers_customer_type_check
  CHECK (
    customer_type = ANY (
      ARRAY[
        'service_client'::text,
        'digital_subscriber'::text,
        'both'::text,
        'all'::text,
        'product_client'::text
      ]
    )
  );

UPDATE public.customers
SET customer_type = 'all'
WHERE customer_type = 'both';

UPDATE public.campaigns
SET audience_filter = jsonb_set(
  audience_filter,
  '{value}',
  to_jsonb('all'::text),
  false
)
WHERE audience_filter->>'type' = 'customer_type'
  AND audience_filter->>'value' = 'both';

ALTER TABLE public.customers
  DROP CONSTRAINT customers_customer_type_check;

ALTER TABLE public.customers
  ADD CONSTRAINT customers_customer_type_check
  CHECK (
    customer_type = ANY (
      ARRAY[
        'service_client'::text,
        'digital_subscriber'::text,
        'all'::text,
        'product_client'::text
      ]
    )
  );

DO $$
DECLARE
  v_both_after INTEGER;
BEGIN
  SELECT COUNT(*)
  INTO v_both_after
  FROM public.customers
  WHERE customer_type = 'both';

  IF v_both_after <> 0 THEN
    RAISE EXCEPTION
      'Migration verify failed: % customer row(s) still have customer_type = both',
      v_both_after;
  END IF;
END;
$$;

COMMIT;

NOTIFY pgrst, 'reload schema';
