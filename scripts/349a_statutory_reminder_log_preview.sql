SELECT
  tenant_id,
  statutory_type,
  period_month,
  reminder_kind,
  channel,
  status,
  count(*) AS row_count,
  max(sent_at) AS last_sent_at
FROM public.statutory_reminder_log
GROUP BY
  tenant_id,
  statutory_type,
  period_month,
  reminder_kind,
  channel,
  status
ORDER BY last_sent_at DESC NULLS LAST, tenant_id, statutory_type, period_month;
