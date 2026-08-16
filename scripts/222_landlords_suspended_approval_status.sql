-- Script 222: Add suspended to landlords.approval_status check constraint.
-- Required for staff "Suspend access" on approved landlords (Phase 3).

BEGIN;

ALTER TABLE public.landlords
  DROP CONSTRAINT IF EXISTS landlords_approval_status_check;

ALTER TABLE public.landlords
  ADD CONSTRAINT landlords_approval_status_check
  CHECK (approval_status IN ('pending', 'approved', 'rejected', 'suspended'));

COMMIT;
