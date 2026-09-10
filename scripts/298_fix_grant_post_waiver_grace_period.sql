-- 298_fix_grant_post_waiver_grace_period.sql
-- Replace broken staging function that referenced non-existent crm_subscriptions.trial_ends_at
-- with the correct trial_end_date implementation from script 294.

BEGIN;

CREATE OR REPLACE FUNCTION public.grant_post_waiver_grace_period(
  p_tenant_id uuid,
  p_grace_days integer DEFAULT 14
)
RETURNS timestamptz
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_subscription_id uuid;
  v_current_trial_end date;
  v_new_trial_end date;
BEGIN
  IF p_tenant_id IS NULL THEN
    RAISE EXCEPTION 'tenant_id is required';
  END IF;

  IF p_grace_days IS NULL OR p_grace_days < 0 THEN
    RAISE EXCEPTION 'grace_days must be a non-negative integer';
  END IF;

  SELECT id, trial_end_date::date
  INTO v_subscription_id, v_current_trial_end
  FROM public.crm_subscriptions
  WHERE linked_tenant_id = p_tenant_id
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF v_subscription_id IS NULL THEN
    RAISE EXCEPTION 'no crm_subscriptions row for linked tenant %', p_tenant_id;
  END IF;

  v_new_trial_end := GREATEST(
    COALESCE(v_current_trial_end, CURRENT_DATE),
    CURRENT_DATE
  ) + make_interval(days => p_grace_days);

  UPDATE public.crm_subscriptions
  SET trial_end_date = v_new_trial_end
  WHERE id = v_subscription_id;

  RETURN v_new_trial_end::timestamptz;
END;
$$;

REVOKE ALL ON FUNCTION public.grant_post_waiver_grace_period(uuid, integer)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.grant_post_waiver_grace_period(uuid, integer)
  TO service_role;

COMMIT;
