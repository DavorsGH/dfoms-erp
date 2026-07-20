-- Script 80: Payment accounts hardening — tenant-scoped company payment profiles for client invoices.
-- Apply on staging/local before production.

BEGIN;

CREATE TABLE IF NOT EXISTS payment_accounts (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id           UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  account_name        TEXT NOT NULL,
  bank_name           TEXT,
  bank_account_number TEXT,
  momo_provider       TEXT,
  momo_number         TEXT,
  momo_merchant_id    TEXT,
  is_active           BOOLEAN NOT NULL DEFAULT true,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

COMMENT ON TABLE payment_accounts IS
  'Company payment profiles (bank / MoMo) shown on client invoices, scoped per tenant.';

CREATE INDEX IF NOT EXISTS payment_accounts_tenant_id_idx
  ON payment_accounts (tenant_id);

GRANT SELECT, INSERT, UPDATE, DELETE ON payment_accounts TO authenticated;

ALTER TABLE payment_accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payment_accounts_super_admin_all ON payment_accounts;
CREATE POLICY payment_accounts_super_admin_all
  ON payment_accounts
  FOR ALL
  TO authenticated
  USING (tenant_matches(tenant_id) AND is_super_admin())
  WITH CHECK (tenant_matches(tenant_id) AND is_super_admin());

COMMIT;
