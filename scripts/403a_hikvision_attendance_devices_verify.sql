SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'attendance_devices'
  AND column_name IN ('brand', 'protocol', 'serial_number', 'push_token_hash', 'mac_address', 'vendor')
ORDER BY column_name;

SELECT
  column_name,
  data_type,
  is_nullable,
  column_default
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'biometric_punches'
  AND column_name IN ('source', 'vendor_event_serial', 'device_id', 'device_pin', 'punch_time')
ORDER BY column_name;

SELECT
  conname AS constraint_name,
  pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.attendance_devices'::regclass
  AND conname IN (
    'attendance_devices_protocol_check',
    'attendance_devices_serial_required_for_adms',
    'attendance_devices_push_token_required_for_isapi',
    'attendance_devices_push_token_hash_key',
    'attendance_devices_serial_number_key',
    'attendance_devices_vendor_check',
    'attendance_devices_serial_required_for_zkteco'
  )
ORDER BY conname;

SELECT
  conname AS constraint_name,
  pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE conrelid = 'public.biometric_punches'::regclass
  AND conname IN (
    'biometric_punches_source_check',
    'biometric_punches_tenant_device_pin_punch_time_key'
  )
ORDER BY conname;

SELECT
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
  AND tablename = 'biometric_punches'
  AND (
    indexname = 'biometric_punches_device_vendor_event_serial_key'
    OR indexdef ILIKE '%vendor_event_serial%'
  )
ORDER BY indexname;

SELECT
  tablename,
  policyname,
  cmd,
  roles,
  qual,
  with_check
FROM pg_policies
WHERE schemaname = 'public'
  AND tablename IN (
    'attendance_devices',
    'employee_biometric_ids',
    'biometric_punches',
    'tenant_device_settings',
    'attendance_unclaimed_devices',
    'attendance_api_keys'
  )
ORDER BY tablename, policyname;

SELECT
  protocol,
  count(*) AS device_count,
  count(*) FILTER (WHERE serial_number IS NULL) AS null_serial_count,
  count(*) FILTER (WHERE push_token_hash IS NOT NULL) AS with_push_token_hash
FROM public.attendance_devices
GROUP BY protocol
ORDER BY protocol;

SELECT
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind = 'r'
  AND c.relname IN (
    'attendance_devices',
    'attendance_unclaimed_devices',
    'employee_biometric_ids',
    'biometric_punches',
    'tenant_device_settings',
    'attendance_api_keys'
  )
ORDER BY c.relname;
