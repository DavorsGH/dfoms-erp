-- Script 47: RBAC Phase 1 foundation — role enum, client/supervisor links.
-- Does NOT change page access or existing table RLS policies.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Role enum (fixed set of 7 roles; keeps existing super_admin = Admin)
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  CREATE TYPE app_role AS ENUM (
    'super_admin',
    'finance',
    'hr',
    'operations_manager',
    'supervisor',
    'employee',
    'client'
  );
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Reference roles table (labels for admin UI / future metadata)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS roles (
  code app_role PRIMARY KEY,
  label TEXT NOT NULL,
  sort_order INTEGER NOT NULL
);

INSERT INTO roles (code, label, sort_order) VALUES
  ('super_admin', 'Admin', 1),
  ('finance', 'Finance', 2),
  ('hr', 'HR', 3),
  ('operations_manager', 'Operations', 4),
  ('supervisor', 'Supervisor', 5),
  ('employee', 'Employee', 6),
  ('client', 'Client', 7)
ON CONFLICT (code) DO UPDATE
SET label = EXCLUDED.label,
    sort_order = EXCLUDED.sort_order;

-- ---------------------------------------------------------------------------
-- 3. user_accounts: enum role, nullable employee_id, client link
-- ---------------------------------------------------------------------------
ALTER TABLE user_accounts
  ALTER COLUMN employee_id DROP NOT NULL;

ALTER TABLE user_accounts
  ADD COLUMN IF NOT EXISTS client_id TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'user_accounts_client_id_fkey'
  ) THEN
    ALTER TABLE user_accounts
      ADD CONSTRAINT user_accounts_client_id_fkey
      FOREIGN KEY (client_id) REFERENCES clients (client_id)
      ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE user_accounts
  ALTER COLUMN role DROP DEFAULT;

ALTER TABLE user_accounts
  ALTER COLUMN role TYPE app_role
  USING role::app_role;

ALTER TABLE user_accounts
  ALTER COLUMN role SET DEFAULT 'super_admin'::app_role;

-- ---------------------------------------------------------------------------
-- 4. Supervisor site assignments (Phase 2 will scope access from this)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS user_account_supervisor_sites (
  auth_uid UUID NOT NULL REFERENCES user_accounts (auth_uid) ON DELETE CASCADE,
  site_code TEXT NOT NULL REFERENCES sites (site_code) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (auth_uid, site_code)
);

CREATE INDEX IF NOT EXISTS idx_user_account_supervisor_sites_site_code
  ON user_account_supervisor_sites (site_code);

-- ---------------------------------------------------------------------------
-- 5. Grants (Data API exposure; RLS unchanged on existing tables)
-- ---------------------------------------------------------------------------
GRANT SELECT ON roles TO authenticated, service_role;
GRANT SELECT, INSERT, UPDATE, DELETE ON user_account_supervisor_sites TO authenticated, service_role;

ALTER TABLE roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE user_account_supervisor_sites ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS roles_read_authenticated ON roles;
CREATE POLICY roles_read_authenticated
  ON roles
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS supervisor_sites_super_admin_all ON user_account_supervisor_sites;
CREATE POLICY supervisor_sites_super_admin_all
  ON user_account_supervisor_sites
  FOR ALL
  TO authenticated
  USING (is_super_admin())
  WITH CHECK (is_super_admin());

COMMIT;

NOTIFY pgrst, 'reload schema';
