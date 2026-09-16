import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  sendServiceContractDocumentToCustomer,
  shouldSendContractDocumentOnUpdate,
} from "@/utils/service-contract-document-send";
import type { ServiceContractHeaderRow } from "@/utils/service-contracts-types";

function resolveContractCustomerName(contract: ServiceContractHeaderRow): string {
  const client = contract.client;
  if (Array.isArray(client)) {
    return client[0]?.client_name?.trim() || contract.client_id;
  }
  return client?.client_name?.trim() || contract.client_id;
}

export function maybeNotifyServiceContractDocumentChange(options: {
  supabase: SupabaseClient;
  tenantId: string;
  before: { status: string; document_url: string | null };
  after: ServiceContractHeaderRow;
}): void {
  const nextDoc = options.after.document_url?.trim() ?? "";
  if (
    !shouldSendContractDocumentOnUpdate(options.before, {
      status: options.after.status,
      document_url: nextDoc || null,
    })
  ) {
    return;
  }

  void sendServiceContractDocumentToCustomer({
    supabase: options.supabase,
    tenantId: options.tenantId,
    contractId: options.after.id,
    clientId: options.after.client_id,
    contractNumber: options.after.contract_number,
    customerName: resolveContractCustomerName(options.after),
    documentUrl: nextDoc,
    businessUnitId: options.after.business_unit_id,
  });
}

export function notifyServiceContractDocumentResend(options: {
  supabase: SupabaseClient;
  tenantId: string;
  contract: ServiceContractHeaderRow;
}): void {
  const documentUrl = options.contract.document_url?.trim() ?? "";
  if (!documentUrl) {
    return;
  }

  void sendServiceContractDocumentToCustomer({
    supabase: options.supabase,
    tenantId: options.tenantId,
    contractId: options.contract.id,
    clientId: options.contract.client_id,
    contractNumber: options.contract.contract_number,
    customerName: resolveContractCustomerName(options.contract),
    documentUrl,
    businessUnitId: options.contract.business_unit_id,
  });
}
