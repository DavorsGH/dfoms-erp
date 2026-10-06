UPDATE public.manual_financial_entries
SET loan_proceeds = 0
WHERE tenant_id = '00000001-0000-4000-8000-000000000001'::uuid
  AND id IN (
    'd45bbd21-2410-41fe-a965-200a6ebf6b28'::uuid,
    '7ae87ddd-a0df-43ba-b8a4-1dbe23f0dc0e'::uuid
  );
