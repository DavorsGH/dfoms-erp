-- Script 249: Add cost_ghs to property_service_records for FM service cost totals.
ALTER TABLE public.property_service_records
  ADD COLUMN IF NOT EXISTS cost_ghs numeric(12, 2);

COMMENT ON COLUMN public.property_service_records.cost_ghs IS
  'Optional running cost in GHS for the logged service (cleaning, gardening, other).';
