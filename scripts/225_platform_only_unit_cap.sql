-- Platform-only landlord active-unit billing cap (editable via Platform Unit Pricing admin).
-- Units beyond the cap incur no activation or recurring platform_only charges.

INSERT INTO public.platform_billing_config (config_key, price_ghs)
VALUES ('platform_only_unit_cap', 25.00)
ON CONFLICT (config_key) DO NOTHING;

ALTER TABLE public.landlord_unit_activation_charges
  DROP CONSTRAINT IF EXISTS landlord_unit_activation_charges_charge_status_check;

ALTER TABLE public.landlord_unit_activation_charges
  ADD CONSTRAINT landlord_unit_activation_charges_charge_status_check
  CHECK (
    charge_status IN (
      'success',
      'failed',
      'skipped_trial',
      'skipped_over_cap',
      'pending'
    )
  );

COMMENT ON TABLE public.platform_billing_config IS
  'Platform-wide billing rates and limits editable by Davors platform super_admin. '
  'price_ghs holds GHS amounts for rate keys and whole-unit counts for cap keys. '
  'Charge-time code reads from here; historical charges stay in audit tables.';
