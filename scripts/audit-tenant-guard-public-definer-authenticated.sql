SELECT
  p.proname,
  pg_get_function_identity_arguments(p.oid) AS args,
  pg_get_function_result(p.oid) AS returns,
  (p.prosrc ILIKE '%assert_caller_can_act_for_tenant%') AS has_guard,
  (p.prosrc ~* 'current_user_tenant_id|tenant_matches') AS uses_session_tenant,
  (pg_get_function_identity_arguments(p.oid) ILIKE '%tenant_id%') AS takes_tenant_param
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.prosecdef
  AND p.prokind = 'f'
  AND has_function_privilege('authenticated', p.oid, 'EXECUTE')
  AND NOT (p.proname ~ '__impl$')
ORDER BY takes_tenant_param DESC, has_guard, p.proname;
