-- Script 133: Tenant-requested early lease termination (pending staff approval).
-- Mirrors rent_change_status / pending_rent_amount_ghs pattern on leases.
--
-- Apply in Supabase SQL Editor (staging first, then production).

BEGIN;

ALTER TABLE public.leases
  ADD COLUMN IF NOT EXISTS termination_request_status text,
  ADD COLUMN IF NOT EXISTS pending_termination_reason text;

COMMENT ON COLUMN public.leases.termination_request_status IS
  'Tenant early-termination request: null | pending_staff_approval | approved | rejected';

COMMENT ON COLUMN public.leases.pending_termination_reason IS
  'Optional reason submitted with a pending tenant termination request';

COMMIT;
