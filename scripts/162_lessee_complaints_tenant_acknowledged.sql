-- Tenant acknowledgment when their own complaint is resolved (separate from status).
ALTER TABLE public.lessee_complaints
  ADD COLUMN IF NOT EXISTS tenant_acknowledged_at timestamptz;

COMMENT ON COLUMN public.lessee_complaints.tenant_acknowledged_at IS
  'When the tenant confirmed satisfaction with resolution of a tenant-raised complaint.';
