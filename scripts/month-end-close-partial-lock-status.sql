-- Allow 'Partially Locked' as a month_end_close.lock_status value.
-- Run once in Supabase SQL editor if locking a partial month fails on constraint.

ALTER TABLE public.month_end_close
  DROP CONSTRAINT IF EXISTS month_end_close_lock_status_check;

ALTER TABLE public.month_end_close
  ADD CONSTRAINT month_end_close_lock_status_check
  CHECK (lock_status IN ('Open', 'Locked', 'Partially Locked'));
