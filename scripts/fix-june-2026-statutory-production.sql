-- ONE-SHOT production SQL: June 2026 Davors statutory recalculation
-- Project: tvcurcnmasnocwdxzgvz
-- Tenant: 00000001-0000-4000-8000-000000000001
-- Period: 2026-06-01
--
-- Paste into Supabase SQL Editor (production) and Run.
-- Expected totals: emp=188.38 er=274.03 tier2=171.28 paye=275.03 er+tier2=445.31
-- Does NOT modify salary/net pay.

begin;

alter table payroll_history disable trigger trg_protect_locked_payroll;

update payroll_history as ph set
  employee_ssnit = v.employee_ssnit,
  employer_ssnit = v.employer_ssnit,
  tier2 = v.tier2,
  paye_tax = v.paye_tax
from (
  values
    ('51253fe4-7be6-49c2-98e5-f5c0e3ab670d'::uuid, 44.42, 64.62, 40.38, 24.32),
    ('2c2cf8c0-0be4-4dde-af12-2c729bf9d709'::uuid, 36.25, 52.73, 32.96, 7.79),
    ('86872631-c788-4720-b8b0-47457d1eeb28'::uuid, 0, 0, 0, 16.7),
    ('a81c9ffb-5ba6-44d4-bfd7-11b063afaeb7'::uuid, 23.38, 34.01, 21.26, 0),
    ('40e2938a-bb11-46ed-9849-c00b083e491e'::uuid, 0, 0, 0, 16.7),
    ('f0ddcdda-762e-411a-8ee6-ee6dca3e37ce'::uuid, 0, 0, 0, 16.7),
    ('401dde09-768c-4e62-a8f0-ec7429df9ba9'::uuid, 0, 0, 0, 16.7),
    ('19714a3e-1db3-4155-bd14-6cdfda1a7ce9'::uuid, 0, 0, 0, 16.7),
    ('531bcab6-4d26-486b-a25a-6cc25d86bf04'::uuid, 0, 0, 0, 16.7),
    ('9e8d87a1-5a5a-44b4-8def-b07d46541863'::uuid, 28.11, 40.89, 25.56, 0),
    ('2776196f-17ed-4797-8169-9cafb840250f'::uuid, 0, 0, 0, 16.7),
    ('92a5ace4-6d61-445f-a520-1ff1e9d52cd8'::uuid, 0, 0, 0, 16.7),
    ('0ab9c515-3ac3-4cc4-a979-6b44c42a6573'::uuid, 28.11, 40.89, 25.56, 0),
    ('9f2f8a43-067d-4f30-9415-7cd7a1ba0531'::uuid, 0, 0, 0, 16.7),
    ('b0eba677-125d-4c56-a7cc-b49075c208b7'::uuid, 0, 0, 0, 21.26),
    ('0daf0bc2-de18-4655-ac7e-bef0087b7d05'::uuid, 0, 0, 0, 16.7),
    ('f383a482-37bf-478e-a78b-cfe27e467b85'::uuid, 0, 0, 0, 16.7),
    ('5cbd194b-4345-41da-a027-03d1b952cd3c'::uuid, 0, 0, 0, 16.7),
    ('9dd2b451-e84d-4f1c-86a2-65a8afaeb7aa'::uuid, 0, 0, 0, 21.26),
    ('316e39af-0981-4e87-a148-aae1622da6b1'::uuid, 28.11, 40.89, 25.56, 0)
) as v(id, employee_ssnit, employer_ssnit, tier2, paye_tax)
where ph.tenant_id = '00000001-0000-4000-8000-000000000001'::uuid
  and ph.payroll_month = '2026-06-01'::date
  and ph.id = v.id;

alter table payroll_history enable trigger trg_protect_locked_payroll;

select
  round(sum(employee_ssnit)::numeric, 2) as employee_ssnit,
  round(sum(employer_ssnit)::numeric, 2) as employer_ssnit,
  round(sum(tier2)::numeric, 2) as tier2,
  round(sum(paye_tax)::numeric, 2) as paye_tax,
  round(sum(employer_ssnit + tier2)::numeric, 2) as er_plus_tier2,
  count(*) as row_count
from payroll_history
where tenant_id = '00000001-0000-4000-8000-000000000001'::uuid
  and payroll_month = '2026-06-01'::date;

commit;
