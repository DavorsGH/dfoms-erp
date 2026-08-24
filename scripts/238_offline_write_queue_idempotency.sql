-- Script 238: Offline write-queue idempotency (staging first)
--
-- Attendance: UNIQUE (tenant_id, staff_id, date) so offline sync can safely
--   INSERT … ON CONFLICT DO NOTHING (first write wins for a given staff-day).
-- Expense: client_op_id UUID UNIQUE — offline queue UUID survives retries without
--   creating duplicate expense_register rows (PK id remains server/client row id;
--   client_op_id is the durable idempotency key from the offline queue).
--
-- Pre-check (staging): zero duplicate (tenant_id, staff_id, date) groups.

BEGIN;

-- ---------------------------------------------------------------------------
-- attendance_register: one row per staff per day per tenant
-- ---------------------------------------------------------------------------
ALTER TABLE public.attendance_register
  DROP CONSTRAINT IF EXISTS attendance_register_tenant_staff_date_key;

ALTER TABLE public.attendance_register
  ADD CONSTRAINT attendance_register_tenant_staff_date_key
  UNIQUE (tenant_id, staff_id, date);

COMMENT ON CONSTRAINT attendance_register_tenant_staff_date_key
  ON public.attendance_register IS
  'Idempotent offline attendance sync: first write wins for (tenant, staff, date).';

-- ---------------------------------------------------------------------------
-- expense_register: durable client idempotency key for offline queue drains
-- ---------------------------------------------------------------------------
ALTER TABLE public.expense_register
  ADD COLUMN IF NOT EXISTS client_op_id uuid;

COMMENT ON COLUMN public.expense_register.client_op_id IS
  'Client-generated offline write-queue UUID; unique when set for idempotent sync.';

CREATE UNIQUE INDEX IF NOT EXISTS expense_register_client_op_id_key
  ON public.expense_register (client_op_id)
  WHERE client_op_id IS NOT NULL;

COMMIT;
