-- Bidirectional lessee complaints: who filed (tenant vs landlord).
ALTER TABLE public.lessee_complaints
  ADD COLUMN IF NOT EXISTS raised_by text NOT NULL DEFAULT 'tenant';

ALTER TABLE public.lessee_complaints
  DROP CONSTRAINT IF EXISTS lessee_complaints_raised_by_check;

ALTER TABLE public.lessee_complaints
  ADD CONSTRAINT lessee_complaints_raised_by_check
  CHECK (raised_by IN ('tenant', 'landlord'));

COMMENT ON COLUMN public.lessee_complaints.raised_by IS
  'Who filed the complaint: tenant (lessee portal) or landlord (landlord portal / staff on behalf).';
