-- Script 117: Global Salary/Compensation Settings foundation.
-- Definition only. Do NOT apply to staging or production until explicitly approved.
--
-- Creates:
--   allowance_types          — admin-configurable allowance catalog (tenant-scoped, soft-deactivate)
--   compensation_policy      — allowance amounts keyed by position × employment_type × shift × allowance_type
--   payroll_allowance_lines  — dynamic allowance snapshot lines for payroll rows (forward-only)
-- Expands the shift enum (salary_rate_config CHECK) with 'Night' and 'Rotating'.
--
-- Locked decisions (David, 2026-07-26):
--   1. Basic salary fully policy-driven (salary_rate_config remains the basic-salary
--      policy table; employee-level compensation becomes read-only in app code).
--   2. Missing policy row => soft warning + zero. Never blocks payroll lock.
--   3. Seed 4 allowance types per tenant: Housing, Transport, Other, Night Differential.
--   4. NO separate shift_type field. employees.shift expands to:
--      Morning | Afternoon | Full Day | Night | Rotating.
--      Duty Roster keeps using Morning/Afternoon/Full Day exactly as before.
--   5. Payslip shows a dynamic list of allowance lines (payroll_allowance_lines),
--      replacing fixed housing/transport/other columns for NEW payroll going forward.
--      Historical payroll_history rows are NOT touched (forward-only).
--
-- Notes:
--   * employees.shift has NO database CHECK constraint (app-level SHIFT_OPTIONS only),
--     so no ALTER is needed there — only a documentation COMMENT.
--   * Legacy pay_rate_structure is unused by the app and is left untouched.
--   * position is stored as text matching positions.position_title, same as the live
--     salary_rate_config pattern (no FK).

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. allowance_types (tenant-scoped, admin-configurable, soft-deactivate)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.allowance_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  code text NOT NULL,
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT allowance_types_code_not_blank CHECK (btrim(code) <> ''),
  CONSTRAINT allowance_types_name_not_blank CHECK (btrim(name) <> ''),
  CONSTRAINT allowance_types_tenant_code_key UNIQUE (tenant_id, code)
);

COMMENT ON TABLE public.allowance_types IS
  'Admin-configurable allowance catalog per tenant (Global Salary Settings). '
  'Soft-deactivate via is_active; hard delete cascades compensation_policy rows '
  'but never touches payroll_allowance_lines snapshots.';

COMMENT ON COLUMN public.allowance_types.is_active IS
  'Soft-deactivate: inactive types stop being applied to new payroll but keep history intact.';

CREATE INDEX IF NOT EXISTS allowance_types_tenant_active_idx
  ON public.allowance_types (tenant_id, is_active, sort_order);

DROP TRIGGER IF EXISTS trg_allowance_types_enforce_tenant_id ON public.allowance_types;
CREATE TRIGGER trg_allowance_types_enforce_tenant_id
  BEFORE INSERT OR UPDATE OF tenant_id ON public.allowance_types
  FOR EACH ROW
  EXECUTE FUNCTION enforce_row_tenant_id();

ALTER TABLE public.allowance_types ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS allowance_types_tenant_select ON public.allowance_types;
CREATE POLICY allowance_types_tenant_select
  ON public.allowance_types
  FOR SELECT
  TO authenticated
  USING (tenant_matches(tenant_id));

DROP POLICY IF EXISTS allowance_types_tenant_insert ON public.allowance_types;
CREATE POLICY allowance_types_tenant_insert
  ON public.allowance_types
  FOR INSERT
  TO authenticated
  WITH CHECK (tenant_matches(tenant_id));

DROP POLICY IF EXISTS allowance_types_tenant_update ON public.allowance_types;
CREATE POLICY allowance_types_tenant_update
  ON public.allowance_types
  FOR UPDATE
  TO authenticated
  USING (tenant_matches(tenant_id))
  WITH CHECK (tenant_matches(tenant_id));

DROP POLICY IF EXISTS allowance_types_tenant_delete ON public.allowance_types;
CREATE POLICY allowance_types_tenant_delete
  ON public.allowance_types
  FOR DELETE
  TO authenticated
  USING (tenant_matches(tenant_id));

DROP POLICY IF EXISTS allowance_types_super_admin_full_access ON public.allowance_types;
CREATE POLICY allowance_types_super_admin_full_access
  ON public.allowance_types
  FOR ALL
  TO authenticated
  USING (tenant_matches(tenant_id) AND is_super_admin())
  WITH CHECK (tenant_matches(tenant_id) AND is_super_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.allowance_types TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.allowance_types TO service_role;

-- ---------------------------------------------------------------------------
-- 2. compensation_policy (allowance amount matrix)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.compensation_policy (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  "position" text NOT NULL,
  employment_type text NOT NULL,
  shift text NOT NULL,
  allowance_type_id uuid NOT NULL REFERENCES public.allowance_types (id) ON DELETE CASCADE,
  amount numeric(12, 2) NOT NULL DEFAULT 0,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT compensation_policy_employment_type_check
    CHECK (employment_type = ANY (ARRAY['Casual'::text, 'Part-Time'::text, 'Full-Time'::text])),
  CONSTRAINT compensation_policy_shift_check
    CHECK (shift = ANY (ARRAY[
      'Full Day'::text, 'Morning'::text, 'Afternoon'::text, 'Night'::text, 'Rotating'::text
    ])),
  CONSTRAINT compensation_policy_amount_nonneg CHECK (amount >= 0),
  CONSTRAINT compensation_policy_key UNIQUE
    (tenant_id, "position", employment_type, shift, allowance_type_id)
);

COMMENT ON TABLE public.compensation_policy IS
  'Global Salary Settings allowance matrix: flat GHS amount per '
  '(position, employment_type, shift, allowance_type). Employee compensation reads '
  'from this policy (read-only at employee level). Basic salary remains in salary_rate_config. '
  'Missing combination => allowances resolve to zero with a soft warning (never blocks lock).';

COMMENT ON COLUMN public.compensation_policy.amount IS
  'Flat monthly GHS amount. Night Differential is an allowance type configured with an '
  'amount on Night (and optionally Rotating) rows.';

CREATE INDEX IF NOT EXISTS compensation_policy_tenant_lookup_idx
  ON public.compensation_policy (tenant_id, "position", employment_type, shift);

CREATE INDEX IF NOT EXISTS compensation_policy_allowance_type_idx
  ON public.compensation_policy (allowance_type_id);

DROP TRIGGER IF EXISTS trg_compensation_policy_enforce_tenant_id ON public.compensation_policy;
CREATE TRIGGER trg_compensation_policy_enforce_tenant_id
  BEFORE INSERT OR UPDATE OF tenant_id ON public.compensation_policy
  FOR EACH ROW
  EXECUTE FUNCTION enforce_row_tenant_id();

ALTER TABLE public.compensation_policy ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS compensation_policy_tenant_select ON public.compensation_policy;
CREATE POLICY compensation_policy_tenant_select
  ON public.compensation_policy
  FOR SELECT
  TO authenticated
  USING (tenant_matches(tenant_id));

DROP POLICY IF EXISTS compensation_policy_tenant_insert ON public.compensation_policy;
CREATE POLICY compensation_policy_tenant_insert
  ON public.compensation_policy
  FOR INSERT
  TO authenticated
  WITH CHECK (tenant_matches(tenant_id));

DROP POLICY IF EXISTS compensation_policy_tenant_update ON public.compensation_policy;
CREATE POLICY compensation_policy_tenant_update
  ON public.compensation_policy
  FOR UPDATE
  TO authenticated
  USING (tenant_matches(tenant_id))
  WITH CHECK (tenant_matches(tenant_id));

DROP POLICY IF EXISTS compensation_policy_tenant_delete ON public.compensation_policy;
CREATE POLICY compensation_policy_tenant_delete
  ON public.compensation_policy
  FOR DELETE
  TO authenticated
  USING (tenant_matches(tenant_id));

DROP POLICY IF EXISTS compensation_policy_super_admin_full_access ON public.compensation_policy;
CREATE POLICY compensation_policy_super_admin_full_access
  ON public.compensation_policy
  FOR ALL
  TO authenticated
  USING (tenant_matches(tenant_id) AND is_super_admin())
  WITH CHECK (tenant_matches(tenant_id) AND is_super_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.compensation_policy TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.compensation_policy TO service_role;

-- ---------------------------------------------------------------------------
-- 3. Expand shift enum: salary_rate_config CHECK + employees.shift comment
-- ---------------------------------------------------------------------------
-- Only DB-level shift CHECK in the schema. Additive change: existing
-- Full Day / Morning / Afternoon rows remain valid.
ALTER TABLE public.salary_rate_config
  DROP CONSTRAINT IF EXISTS salary_rate_config_shift_check;
ALTER TABLE public.salary_rate_config
  ADD CONSTRAINT salary_rate_config_shift_check
  CHECK (shift = ANY (ARRAY[
    'Full Day'::text, 'Morning'::text, 'Afternoon'::text, 'Night'::text, 'Rotating'::text
  ]));

-- employees.shift has no DB CHECK (app-level SHIFT_OPTIONS only) — document the set.
COMMENT ON COLUMN public.employees.shift IS
  'Shift: Morning | Afternoon | Full Day | Night | Rotating. '
  'Morning/Afternoon/Full Day drive Duty Roster placement (unchanged); '
  'Night/Rotating exist for pay policy (Night Differential). Enforced in app code.';

-- ---------------------------------------------------------------------------
-- 4. payroll_allowance_lines (dynamic allowance snapshots, forward-only)
-- ---------------------------------------------------------------------------
-- One row per (payroll row, allowance type). stage='processing' lines are
-- recomputed from compensation_policy while the month is Open; on lock they are
-- copied to stage='history' and become immutable snapshots. Code/name are
-- snapshotted so payslips survive later allowance_type renames/deletes.
CREATE TABLE IF NOT EXISTS public.payroll_allowance_lines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES public.tenants (id) ON DELETE CASCADE,
  stage text NOT NULL,
  payroll_month date NOT NULL,
  employee_id text NOT NULL,
  allowance_type_id uuid REFERENCES public.allowance_types (id) ON DELETE SET NULL,
  allowance_code text NOT NULL,
  allowance_name text NOT NULL,
  amount numeric(12, 2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payroll_allowance_lines_stage_check
    CHECK (stage IN ('processing', 'history')),
  CONSTRAINT payroll_allowance_lines_month_is_month_start
    CHECK (payroll_month = date_trunc('month', payroll_month::timestamp)::date),
  CONSTRAINT payroll_allowance_lines_amount_nonneg CHECK (amount >= 0),
  CONSTRAINT payroll_allowance_lines_key UNIQUE
    (tenant_id, stage, payroll_month, employee_id, allowance_code)
);

COMMENT ON TABLE public.payroll_allowance_lines IS
  'Dynamic allowance lines per payroll row (replaces fixed housing/transport/other '
  'columns for NEW payroll, forward-only — historical payroll_history untouched). '
  'stage=processing: recomputed from compensation_policy while Open. '
  'stage=history: immutable snapshot written at payroll lock.';

COMMENT ON COLUMN public.payroll_allowance_lines.allowance_code IS
  'Snapshot of allowance_types.code at calculation time; stable for payslip display '
  'even if the type is later renamed or deleted (allowance_type_id set NULL).';

CREATE INDEX IF NOT EXISTS payroll_allowance_lines_tenant_month_idx
  ON public.payroll_allowance_lines (tenant_id, stage, payroll_month);

CREATE INDEX IF NOT EXISTS payroll_allowance_lines_employee_idx
  ON public.payroll_allowance_lines (tenant_id, employee_id, payroll_month);

DROP TRIGGER IF EXISTS trg_payroll_allowance_lines_enforce_tenant_id
  ON public.payroll_allowance_lines;
CREATE TRIGGER trg_payroll_allowance_lines_enforce_tenant_id
  BEFORE INSERT OR UPDATE OF tenant_id ON public.payroll_allowance_lines
  FOR EACH ROW
  EXECUTE FUNCTION enforce_row_tenant_id();

ALTER TABLE public.payroll_allowance_lines ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS payroll_allowance_lines_tenant_select ON public.payroll_allowance_lines;
CREATE POLICY payroll_allowance_lines_tenant_select
  ON public.payroll_allowance_lines
  FOR SELECT
  TO authenticated
  USING (tenant_matches(tenant_id));

DROP POLICY IF EXISTS payroll_allowance_lines_tenant_insert ON public.payroll_allowance_lines;
CREATE POLICY payroll_allowance_lines_tenant_insert
  ON public.payroll_allowance_lines
  FOR INSERT
  TO authenticated
  WITH CHECK (tenant_matches(tenant_id));

DROP POLICY IF EXISTS payroll_allowance_lines_tenant_update ON public.payroll_allowance_lines;
CREATE POLICY payroll_allowance_lines_tenant_update
  ON public.payroll_allowance_lines
  FOR UPDATE
  TO authenticated
  USING (tenant_matches(tenant_id))
  WITH CHECK (tenant_matches(tenant_id));

DROP POLICY IF EXISTS payroll_allowance_lines_tenant_delete ON public.payroll_allowance_lines;
CREATE POLICY payroll_allowance_lines_tenant_delete
  ON public.payroll_allowance_lines
  FOR DELETE
  TO authenticated
  USING (tenant_matches(tenant_id));

DROP POLICY IF EXISTS payroll_allowance_lines_super_admin_full_access
  ON public.payroll_allowance_lines;
CREATE POLICY payroll_allowance_lines_super_admin_full_access
  ON public.payroll_allowance_lines
  FOR ALL
  TO authenticated
  USING (tenant_matches(tenant_id) AND is_super_admin())
  WITH CHECK (tenant_matches(tenant_id) AND is_super_admin());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_allowance_lines TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.payroll_allowance_lines TO service_role;

-- ---------------------------------------------------------------------------
-- 5. Seed the 4 starting allowance types for every existing tenant
-- ---------------------------------------------------------------------------
-- enforce_row_tenant_id allows explicit tenant_id when no session tenant exists
-- (migration runs as postgres/service_role). Idempotent via ON CONFLICT.
INSERT INTO public.allowance_types (tenant_id, code, name, is_active, sort_order)
SELECT t.id, seed.code, seed.name, true, seed.sort_order
FROM public.tenants t
CROSS JOIN (
  VALUES
    ('HOUSING', 'Housing Allowance', 10),
    ('TRANSPORT', 'Transport Allowance', 20),
    ('OTHER', 'Other Allowances', 30),
    ('NIGHT_DIFF', 'Night Differential', 40)
) AS seed (code, name, sort_order)
ON CONFLICT (tenant_id, code) DO NOTHING;

NOTIFY pgrst, 'reload schema';

COMMIT;
