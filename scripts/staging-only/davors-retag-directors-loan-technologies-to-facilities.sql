UPDATE public.directors_loan_entries
SET business_unit_id = 'de215200-e92b-48e3-a7ba-977d7289868c'::uuid
WHERE tenant_id = '00000001-0000-4000-8000-000000000001'::uuid
  AND business_unit_id = 'd251c562-d522-43ec-8d9c-d1d00d4105b0'::uuid;

UPDATE public.directors_loan_repayments
SET business_unit_id = 'de215200-e92b-48e3-a7ba-977d7289868c'::uuid
WHERE tenant_id = '00000001-0000-4000-8000-000000000001'::uuid
  AND business_unit_id = 'd251c562-d522-43ec-8d9c-d1d00d4105b0'::uuid;

UPDATE public.manual_financial_entries
SET business_unit_id = 'de215200-e92b-48e3-a7ba-977d7289868c'::uuid
WHERE tenant_id = '00000001-0000-4000-8000-000000000001'::uuid
  AND business_unit_id = 'd251c562-d522-43ec-8d9c-d1d00d4105b0'::uuid;
