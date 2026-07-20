-- 78_cleanup_stray_staging_caanta_tenant.sql
-- Removes the stray staging signup for david.avors@mtn.com / tenant Caanta Market
-- (staging project wieflwbfdmjtsdnwbfii)

BEGIN;

DO $$
DECLARE
  v_tenant_id uuid := '8d106943-938d-46fd-be4e-550307014dbc';
  v_davors_tenant_id uuid := '00000001-0000-4000-8000-000000000001';
  v_auth_id uuid := 'cdcbaa98-9ceb-4fb6-8e31-661382734bd5';
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

DELETE FROM billing_settings WHERE tenant_id = '8d106943-938d-46fd-be4e-550307014dbc';
DELETE FROM invoices WHERE tenant_id = '8d106943-938d-46fd-be4e-550307014dbc';
DELETE FROM crm_subscriptions WHERE linked_tenant_id = '8d106943-938d-46fd-be4e-550307014dbc';
DELETE FROM customers WHERE tenant_id = '00000001-0000-4000-8000-000000000001' AND client_id = 'CLI004';
DELETE FROM user_accounts WHERE tenant_id = '8d106943-938d-46fd-be4e-550307014dbc';
DELETE FROM tenants WHERE id = '8d106943-938d-46fd-be4e-550307014dbc';
DELETE FROM auth.users WHERE id = 'cdcbaa98-9ceb-4fb6-8e31-661382734bd5';

COMMIT;
