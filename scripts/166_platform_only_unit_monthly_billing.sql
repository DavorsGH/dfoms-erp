-- Monthly recurring platform-only unit billing (cron: /api/cron/platform-unit-billing).
-- Apply on staging before production. Required before the monthly billing cron runs.
--
-- Extends script 156 (activation-only audit log) for landlord-level monthly charges.

-- Monthly rows are landlord-scoped (combined active-unit charge), not tied to one unit.
ALTER TABLE public.landlord_unit_activation_charges
  ALTER COLUMN unit_id DROP NOT NULL;

COMMENT ON COLUMN public.landlord_unit_activation_charges.unit_id IS
  'Property unit for per-unit activation/reactivation/create charges. '
  'NULL for landlord-level monthly_recurring combined charges.';

-- Extend trigger_type allowed values (inline CHECK from script 156).
ALTER TABLE public.landlord_unit_activation_charges
  DROP CONSTRAINT IF EXISTS landlord_unit_activation_charges_trigger_type_check;

ALTER TABLE public.landlord_unit_activation_charges
  ADD CONSTRAINT landlord_unit_activation_charges_trigger_type_check
  CHECK (trigger_type IN (
    'activation',
    'reactivation',
    'create',
    'monthly_recurring'
  ));

COMMENT ON TABLE public.landlord_unit_activation_charges IS
  'Immutable audit trail for platform_only per-unit activation charges and '
  'monthly recurring combined unit billing. Application inserts only.';
