-- Script 65: ERP Suite self-serve signup — grants + tenant_id trigger only.
-- crm_subscriptions already exists in production (see script 62 RLS).
-- Supports POST /api/signup (service-role, cross-tenant writes).

BEGIN;

-- Optional no-op if customers.source already exists from production setup.
DO $$
BEGIN
  IF to_regclass('public.customers') IS NOT NULL THEN
    ALTER TABLE customers ADD COLUMN IF NOT EXISTS source TEXT;
    COMMENT ON COLUMN customers.source IS 'Acquisition channel, e.g. erp_suite_signup.';
  ELSIF to_regclass('public.clients') IS NOT NULL THEN
    ALTER TABLE clients ADD COLUMN IF NOT EXISTS source TEXT;
    COMMENT ON COLUMN clients.source IS 'Acquisition channel, e.g. erp_suite_signup.';
  END IF;
END $$;

-- Script 59 granted SELECT only; signup creates new tenant rows via service_role.
GRANT INSERT ON tenants TO service_role;

-- crm_subscriptions was created after script 59 trigger rollout.
DO $$
BEGIN
  IF to_regclass('public.crm_subscriptions') IS NOT NULL THEN
    DROP TRIGGER IF EXISTS trg_crm_subscriptions_enforce_tenant_id ON crm_subscriptions;
    CREATE TRIGGER trg_crm_subscriptions_enforce_tenant_id
      BEFORE INSERT OR UPDATE OF tenant_id ON crm_subscriptions
      FOR EACH ROW
      EXECUTE FUNCTION enforce_row_tenant_id();
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';

COMMIT;
