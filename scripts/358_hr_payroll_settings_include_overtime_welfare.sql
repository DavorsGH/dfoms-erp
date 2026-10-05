ALTER TABLE public.hr_payroll_settings
  ADD COLUMN IF NOT EXISTS include_overtime_in_welfare boolean NOT NULL DEFAULT true;
