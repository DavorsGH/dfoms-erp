-- 253_service_contracts_client_portal_rls.sql
-- Client portal read access for service contracts and rate card line items.
-- Adds client_quotations.accepted_at for portal "Accepted on" display.

BEGIN;

ALTER TABLE public.client_quotations
  ADD COLUMN IF NOT EXISTS accepted_at timestamptz;

UPDATE public.client_quotations
SET accepted_at = updated_at
WHERE status = 'accepted'
  AND accepted_at IS NULL;

COMMENT ON COLUMN public.client_quotations.accepted_at IS
  'Timestamp when the quotation status was set to accepted.';

DROP POLICY IF EXISTS service_contracts_client_portal_select ON public.service_contracts;
CREATE POLICY service_contracts_client_portal_select
  ON public.service_contracts
  FOR SELECT
  TO authenticated
  USING (
    tenant_matches(tenant_id)
    AND current_user_role() = 'client'::app_role
    AND client_id = current_user_client_id()
  );

DROP POLICY IF EXISTS service_contract_line_items_client_portal_select
  ON public.service_contract_line_items;
CREATE POLICY service_contract_line_items_client_portal_select
  ON public.service_contract_line_items
  FOR SELECT
  TO authenticated
  USING (
    tenant_matches(tenant_id)
    AND current_user_role() = 'client'::app_role
    AND EXISTS (
      SELECT 1
      FROM public.service_contracts sc
      WHERE sc.id = service_contract_line_items.contract_id
        AND sc.tenant_id = service_contract_line_items.tenant_id
        AND sc.client_id = current_user_client_id()
    )
  );

COMMIT;
