-- =============================================================================
-- 152_lease_signature_status.sql
-- Apply to staging first. Do NOT apply to production until approved.
--
-- Formalizes leases.signature_status (already present live as text) with a
-- CHECK constraint and default 'unsigned'. Keeps lease_document_url for
-- optional custom uploads (generated Ghanaian PDF is the default when null).
-- Adds acknowledgment timestamps/actors used by the unsigned → sent →
-- partially_signed → signed workflow.
--
-- Safe to re-run (idempotent).
-- =============================================================================

BEGIN;

ALTER TABLE public.leases
  ADD COLUMN IF NOT EXISTS signature_status text,
  ADD COLUMN IF NOT EXISTS lease_document_url text,
  ADD COLUMN IF NOT EXISTS landlord_acknowledged_at timestamptz,
  ADD COLUMN IF NOT EXISTS tenant_acknowledged_at timestamptz,
  ADD COLUMN IF NOT EXISTS landlord_acknowledged_by uuid,
  ADD COLUMN IF NOT EXISTS tenant_acknowledged_by uuid;

UPDATE public.leases
SET signature_status = 'unsigned'
WHERE signature_status IS NULL
   OR btrim(signature_status) = ''
   OR signature_status NOT IN (
     'unsigned',
     'sent',
     'partially_signed',
     'signed'
   );

ALTER TABLE public.leases
  ALTER COLUMN signature_status SET DEFAULT 'unsigned';

ALTER TABLE public.leases
  ALTER COLUMN signature_status SET NOT NULL;

ALTER TABLE public.leases
  DROP CONSTRAINT IF EXISTS leases_signature_status_check;

ALTER TABLE public.leases
  ADD CONSTRAINT leases_signature_status_check
  CHECK (
    signature_status = ANY (
      ARRAY[
        'unsigned'::text,
        'sent'::text,
        'partially_signed'::text,
        'signed'::text
      ]
    )
  );

COMMENT ON COLUMN public.leases.signature_status IS
  'Lease acknowledgment workflow: unsigned | sent | partially_signed | signed. Not a legal e-signature; portal acknowledgment only.';

COMMENT ON COLUMN public.leases.lease_document_url IS
  'Optional custom/uploaded lease PDF URL. When set, download uses this instead of the on-demand generated Ghanaian tenancy PDF.';

COMMENT ON COLUMN public.leases.landlord_acknowledged_at IS
  'When landlord (or staff on their behalf) acknowledged the lease terms.';

COMMENT ON COLUMN public.leases.tenant_acknowledged_at IS
  'When tenant/lessee acknowledged the lease terms in the portal.';

COMMENT ON COLUMN public.leases.landlord_acknowledged_by IS
  'auth.users id of the actor who recorded landlord acknowledgment.';

COMMENT ON COLUMN public.leases.tenant_acknowledged_by IS
  'auth.users id of the actor who recorded tenant acknowledgment.';

NOTIFY pgrst, 'reload schema';

COMMIT;
