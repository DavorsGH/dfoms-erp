BEGIN;

ALTER TABLE public.attendance_devices
  DROP CONSTRAINT IF EXISTS attendance_devices_protocol_check;

ALTER TABLE public.attendance_devices
  ADD CONSTRAINT attendance_devices_protocol_check CHECK (protocol = ANY (ARRAY['adms'::text, 'api'::text, 'isapi'::text]));

ALTER TABLE public.attendance_devices
  ALTER COLUMN serial_number DROP NOT NULL;

ALTER TABLE public.attendance_devices
  DROP CONSTRAINT IF EXISTS attendance_devices_serial_required_for_adms;

ALTER TABLE public.attendance_devices
  ADD CONSTRAINT attendance_devices_serial_required_for_adms CHECK (protocol <> 'adms'::text OR serial_number IS NOT NULL);

ALTER TABLE public.attendance_devices
  ADD COLUMN IF NOT EXISTS push_token_hash text;

ALTER TABLE public.attendance_devices
  DROP CONSTRAINT IF EXISTS attendance_devices_push_token_hash_key;

ALTER TABLE public.attendance_devices
  ADD CONSTRAINT attendance_devices_push_token_hash_key UNIQUE (push_token_hash);

ALTER TABLE public.attendance_devices
  ADD COLUMN IF NOT EXISTS mac_address text;

ALTER TABLE public.attendance_devices
  DROP CONSTRAINT IF EXISTS attendance_devices_push_token_required_for_isapi;

ALTER TABLE public.attendance_devices
  ADD CONSTRAINT attendance_devices_push_token_required_for_isapi CHECK (protocol <> 'isapi'::text OR push_token_hash IS NOT NULL);

ALTER TABLE public.biometric_punches
  DROP CONSTRAINT IF EXISTS biometric_punches_source_check;

ALTER TABLE public.biometric_punches
  ADD CONSTRAINT biometric_punches_source_check CHECK (source = ANY (ARRAY['adms'::text, 'api'::text, 'isapi'::text]));

ALTER TABLE public.biometric_punches
  ADD COLUMN IF NOT EXISTS vendor_event_serial text;

COMMIT;

NOTIFY pgrst, 'reload schema';
