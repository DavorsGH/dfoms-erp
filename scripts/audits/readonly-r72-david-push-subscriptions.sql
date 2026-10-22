WITH target AS (
  SELECT lower(trim('david.avors@gmail.com')) AS email
),
tenant_user AS (
  SELECT
    ua.auth_uid AS recipient_user_id,
    ua.tenant_id,
    ua.email AS account_email,
    ua.role,
    ua.is_active,
    t.name AS tenant_name
  FROM public.user_accounts ua
  CROSS JOIN target tg
  LEFT JOIN public.tenants t ON t.id = ua.tenant_id
  WHERE lower(trim(ua.email)) = tg.email
),
subs AS (
  SELECT
    ps.id,
    ps.persona,
    ps.tenant_id,
    tu.tenant_name,
    tu.account_email,
    tu.role,
    tu.is_active,
    ps.recipient_user_id,
    ps.endpoint,
    CASE
      WHEN ps.endpoint ILIKE '%fcm.googleapis.com%' THEN 'fcm.googleapis.com'
      WHEN ps.endpoint ILIKE '%web.push.apple.com%' THEN 'web.push.apple.com'
      WHEN ps.endpoint ILIKE '%notify.windows.com%' THEN 'notify.windows.com'
      ELSE split_part(regexp_replace(ps.endpoint, '^https?://', ''), '/', 1)
    END AS endpoint_host,
    ps.is_standalone_pwa,
    ps.user_agent,
    ps.created_at,
    ps.last_used_at,
    ps.revoked_at,
    CASE
      WHEN ps.revoked_at IS NOT NULL THEN 'revoked_or_expired'
      WHEN ps.last_used_at IS NOT NULL THEN 'last_delivery_ok_proxy'
      ELSE 'never_delivered_or_unlogged'
    END AS last_push_result_proxy
  FROM public.push_subscriptions ps
  INNER JOIN tenant_user tu
    ON tu.recipient_user_id = ps.recipient_user_id
   AND tu.tenant_id = ps.tenant_id
)
SELECT
  'summary'::text AS result_set,
  (SELECT count(*)::int FROM tenant_user) AS tenant_user_rows,
  (SELECT count(*)::int FROM subs) AS push_subscription_rows,
  (SELECT count(*)::int FROM subs WHERE revoked_at IS NULL) AS active_subscription_rows,
  (SELECT count(*)::int FROM subs WHERE revoked_at IS NOT NULL) AS revoked_subscription_rows,
  NULL::text AS persona,
  NULL::text AS endpoint_host,
  NULL::uuid AS subscription_id,
  NULL::text AS tenant_name,
  NULL::boolean AS is_standalone_pwa,
  NULL::timestamptz AS created_at,
  NULL::timestamptz AS last_used_at,
  NULL::timestamptz AS revoked_at,
  NULL::text AS last_push_result_proxy,
  NULL::text AS endpoint_prefix,
  NULL::text AS user_agent_prefix
UNION ALL
SELECT
  'by_host'::text,
  NULL::int,
  count(*)::int,
  count(*) FILTER (WHERE revoked_at IS NULL)::int,
  count(*) FILTER (WHERE revoked_at IS NOT NULL)::int,
  persona,
  endpoint_host,
  NULL::uuid,
  NULL::text,
  NULL::boolean,
  min(created_at),
  max(last_used_at),
  max(revoked_at),
  NULL::text,
  NULL::text,
  NULL::text
FROM subs
GROUP BY persona, endpoint_host
UNION ALL
SELECT
  'detail'::text,
  NULL::int,
  NULL::int,
  NULL::int,
  NULL::int,
  persona,
  endpoint_host,
  id,
  tenant_name,
  is_standalone_pwa,
  created_at,
  last_used_at,
  revoked_at,
  last_push_result_proxy,
  left(endpoint, 80),
  left(coalesce(user_agent, ''), 120)
FROM subs
ORDER BY 1, 6 NULLS FIRST, 7 NULLS FIRST, 12 DESC NULLS LAST, 11 DESC;
