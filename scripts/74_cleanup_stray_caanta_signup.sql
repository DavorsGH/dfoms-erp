-- 74_cleanup_stray_caanta_signup.sql
-- Removes the accidental production signup for info@caanta.com / tenant Caanta Market
-- (created when .env.local was mistakenly pointed at production during staging testing)

BEGIN;

DO $$
DECLARE
  v_tenant_id uuid := 'b22700bb-b75d-42b9-a17c-3fd5f5f199c5';
  v_davors_tenant_id uuid := '00000001-0000-4000-8000-000000000001';
  v_auth_id uuid := '96a53971-17f9-4ed3-8b6e-45db878c1417';
  v_client_id text := 'CLI004';
BEGIN
  IF v_tenant_id = v_davors_tenant_id THEN
    RAISE EXCEPTION 'Refusing to delete Davors own tenant';
  END IF;

  RAISE NOTICE 'user_accounts rows: %', (SELECT count(*) FROM user_accounts WHERE tenant_id = v_tenant_id);
  RAISE NOTICE 'crm_subscriptions rows (linked_tenant_id): %', (SELECT count(*) FROM crm_subscriptions WHERE linked_tenant_id = v_tenant_id);
  RAISE NOTICE 'customers rows (Davors-scoped, client_id): %', (SELECT count(*) FROM customers WHERE tenant_id = v_davors_tenant_id AND client_id = v_client_id);
  RAISE NOTICE 'billing_settings rows: %', (SELECT count(*) FROM billing_settings WHERE tenant_id = v_tenant_id);
  RAISE NOTICE 'invoices rows: %', (SELECT count(*) FROM invoices WHERE tenant_id = v_tenant_id);
  RAISE NOTICE 'tenants rows: %', (SELECT count(*) FROM tenants WHERE id = v_tenant_id);
END $$;

-- Review the NOTICE counts above. If they match what you expect (1 each for
-- user_accounts, crm_subscriptions, customers, tenants; 0 for billing_settings/invoices),
-- uncomment and run the DELETEs below in the same transaction.

DELETE FROM billing_settings WHERE tenant_id = 'b22700bb-b75d-42b9-a17c-3fd5f5f199c5';
DELETE FROM invoices WHERE tenant_id = 'b22700bb-b75d-42b9-a17c-3fd5f5f199c5';
DELETE FROM crm_subscriptions WHERE linked_tenant_id = 'b22700bb-b75d-42b9-a17c-3fd5f5f199c5';
DELETE FROM customers WHERE tenant_id = '00000001-0000-4000-8000-000000000001' AND client_id = 'CLI004';
DELETE FROM user_accounts WHERE tenant_id = 'b22700bb-b75d-42b9-a17c-3fd5f5f199c5';
DELETE FROM tenants WHERE id = 'b22700bb-b75d-42b9-a17c-3fd5f5f199c5';
DELETE FROM auth.users WHERE id = '96a53971-17f9-4ed3-8b6e-45db878c1417';

COMMIT;
