BEGIN;

CREATE OR REPLACE FUNCTION public.resolve_product_sale_cogs_unit_cost(
  p_product_id uuid,
  p_business_unit_id uuid
)
RETURNS numeric
LANGUAGE sql
STABLE
SET search_path = public, extensions, pg_temp
AS $function$
  SELECT round(
    greatest(
      coalesce(
        nullif(
          public.finished_product_weighted_avg_cost_scoped(p_product_id, p_business_unit_id),
          0
        ),
        0
      ),
      coalesce(public.finished_product_weighted_avg_cost(p_product_id), 0),
      0
    ),
    4
  );
$function$;

REVOKE ALL ON FUNCTION public.resolve_product_sale_cogs_unit_cost(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_product_sale_cogs_unit_cost(uuid, uuid) TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.repair_zero_cogs_product_sales_for_tenant(p_tenant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $function$
DECLARE
  r record;
  v_unit numeric(18, 4);
  v_amount numeric(18, 4);
  v_expense_id uuid;
  v_updated integer := 0;
  v_created integer := 0;
  v_skipped integer := 0;
BEGIN
  PERFORM public.assert_caller_can_act_for_tenant(p_tenant_id);

  FOR r IN
    SELECT
      ir.id AS income_id,
      ir.date,
      ir.invoice_no,
      ir.product_id,
      ir.business_unit_id,
      ir.sale_quantity,
      ir.cogs_expense_id,
      coalesce(er.amount, 0) AS booked_cogs,
      fp.product_name,
      fp.unit_of_measure,
      fp.tenant_id AS product_tenant_id
    FROM public.income_register ir
    JOIN public.finished_products fp ON fp.id = ir.product_id
    LEFT JOIN public.expense_register er ON er.id = ir.cogs_expense_id
    WHERE ir.tenant_id = p_tenant_id
      AND ir.entry_type = 'product_sale'
      AND coalesce(ir.sale_status, 'active') <> 'voided'
      AND coalesce(ir.is_sale_return, false) = false
      AND coalesce(ir.sale_quantity, 0) > 0
      AND (
        ir.cogs_expense_id IS NULL
        OR abs(coalesce(er.amount, 0)) < 0.0001
      )
  LOOP
    v_unit := public.resolve_product_sale_cogs_unit_cost(r.product_id, r.business_unit_id);
    IF v_unit <= 0 THEN
      v_skipped := v_skipped + 1;
      CONTINUE;
    END IF;
    v_amount := round(v_unit * coalesce(r.sale_quantity, 0), 4);

    IF r.cogs_expense_id IS NOT NULL THEN
      UPDATE public.expense_register er
      SET date = r.date::date,
          price = v_unit,
          quantity = r.sale_quantity,
          amount = v_amount
      WHERE er.id = r.cogs_expense_id
        AND er.tenant_id = p_tenant_id;
      v_updated := v_updated + 1;
    ELSE
      INSERT INTO public.expense_register (
        tenant_id,
        date,
        expense_category,
        sub_category,
        description,
        vendor,
        price,
        quantity,
        amount,
        payment_method,
        approved_by,
        receipt_no,
        payment_status,
        notes,
        business_unit_id
      )
      VALUES (
        p_tenant_id,
        r.date::date,
        'Cost of Goods Sold',
        'Product Sales',
        'Repair posted COGS for product sale ' || coalesce(r.invoice_no, r.income_id::text)
          || ' (' || r.product_name || ')',
        'Internal',
        v_unit,
        r.sale_quantity,
        v_amount,
        'Internal',
        'System',
        'COGS-' || trim(coalesce(r.invoice_no, r.income_id::text)),
        'Non-Cash',
        'Historical zero-COGS repair linked to income_register ' || r.income_id::text,
        r.business_unit_id
      )
      RETURNING id INTO v_expense_id;
      UPDATE public.income_register
      SET cogs_expense_id = v_expense_id
      WHERE id = r.income_id;
      v_created := v_created + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'tenant_id', p_tenant_id,
    'expenses_updated', v_updated,
    'expenses_created', v_created,
    'skipped_no_unit_cost', v_skipped
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.repair_zero_cogs_product_sales_for_tenant(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.repair_zero_cogs_product_sales_for_tenant(uuid) TO service_role;

COMMIT;

NOTIFY pgrst, 'reload schema';
