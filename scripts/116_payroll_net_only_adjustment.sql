-- 116: net_only_adjustment for prior-period net top-ups (no PAYE/SSNIT)
-- Applied to payroll_processing + payroll_history.

ALTER TABLE public.payroll_processing
  ADD COLUMN IF NOT EXISTS net_only_adjustment numeric(12, 2) NOT NULL DEFAULT 0;

ALTER TABLE public.payroll_history
  ADD COLUMN IF NOT EXISTS net_only_adjustment numeric(12, 2) NOT NULL DEFAULT 0;

COMMENT ON COLUMN public.payroll_processing.net_only_adjustment IS
  'Net-only prior-period top-up (e.g. June correction). Added to net_pay after tax; excluded from PAYE/SSNIT bases.';

COMMENT ON COLUMN public.payroll_history.net_only_adjustment IS
  'Net-only prior-period top-up (e.g. June correction). Added to net_pay after tax; excluded from PAYE/SSNIT bases.';
