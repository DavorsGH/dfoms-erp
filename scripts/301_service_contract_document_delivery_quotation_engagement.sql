-- 301_service_contract_document_delivery_quotation_engagement.sql
-- Part A: contract document delivery timestamp
-- Part B: quotation engagement type (new business / renewal / amendment)
-- Note: quotation_type already stores service|product (209); engagement uses quotation_engagement_type.

ALTER TABLE public.service_contracts
  ADD COLUMN IF NOT EXISTS document_sent_at timestamptz NULL;

COMMENT ON COLUMN public.service_contracts.document_sent_at IS
  'When the signed contract document was last emailed/SMS-notified to the customer (contract_document_sent).';

ALTER TABLE public.client_quotations
  ADD COLUMN IF NOT EXISTS quotation_engagement_type text NOT NULL DEFAULT 'new_business';

ALTER TABLE public.client_quotations
  DROP CONSTRAINT IF EXISTS client_quotations_quotation_engagement_type_check;

ALTER TABLE public.client_quotations
  ADD CONSTRAINT client_quotations_quotation_engagement_type_check
  CHECK (quotation_engagement_type IN ('new_business', 'renewal', 'amendment'));

COMMENT ON COLUMN public.client_quotations.quotation_engagement_type IS
  'Business purpose: new_business, renewal, or amendment against an existing service contract. Distinct from quotation_type (service|product).';
