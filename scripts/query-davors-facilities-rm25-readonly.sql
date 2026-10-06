SELECT rm.material_code, rmp.id, rmp.purchase_date, rmp.quantity, rmp.cost_per_unit, rmp.total_cost, rmp.business_unit_id
FROM public.raw_material_purchases rmp
JOIN public.raw_materials rm ON rm.id = rmp.material_id
WHERE rmp.tenant_id = '00000001-0000-4000-8000-000000000001'::uuid
  AND rmp.business_unit_id = 'de215200-e92b-48e3-a7ba-977d7289868c'::uuid
ORDER BY rm.material_code, rmp.purchase_date;

SELECT rm.material_code, pb.production_date, pbm.quantity_used, pb.business_unit_id, pb.id AS batch_id
FROM public.production_batches pb
JOIN public.production_batch_materials pbm ON pbm.batch_id = pb.id
JOIN public.raw_materials rm ON rm.id = pbm.material_id
WHERE pb.tenant_id = '00000001-0000-4000-8000-000000000001'::uuid
  AND pb.business_unit_id = 'de215200-e92b-48e3-a7ba-977d7289868c'::uuid
ORDER BY pb.production_date, rm.material_code;

SELECT rm.material_code, rmb.current_stock, rmb.average_cost_per_unit,
       round(rmb.current_stock * rmb.average_cost_per_unit, 2) AS balance_value
FROM public.raw_material_balances rmb
JOIN public.raw_materials rm ON rm.id = rmb.material_id
WHERE rmb.tenant_id = '00000001-0000-4000-8000-000000000001'::uuid
  AND rmb.business_unit_id = 'de215200-e92b-48e3-a7ba-977d7289868c'::uuid;
