import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ResendEmailAttachment } from "@/utils/resend-email";
import { notifyClientContractDocumentSent } from "@/utils/client-document-notifications";
import {
  serviceContractDocumentFileName,
} from "@/utils/service-contracts-types";
import { TENANT_LOGOS_BUCKET } from "@/utils/tenant-logo";
import { createAdminClient } from "@/utils/supabase/admin";

function contentTypeFromDocumentPath(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".pdf")) return "application/pdf";
  if (lower.endsWith(".doc")) return "application/msword";
  if (lower.endsWith(".docx")) {
    return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  }
  if (lower.endsWith(".png")) return "image/png";
  if (lower.endsWith(".webp")) return "image/webp";
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg";
  return "application/octet-stream";
}

export async function loadServiceContractDocumentAttachment(
  documentPath: string,
): Promise<ResendEmailAttachment | null> {
  const trimmed = documentPath.trim();
  if (!trimmed) {
    return null;
  }

  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(TENANT_LOGOS_BUCKET).download(trimmed);

  if (error || !data) {
    console.error(
      `[service-contract-document-send] storage download failed (${trimmed}):`,
      error?.message ?? "empty file",
    );
    return null;
  }

  const buffer = Buffer.from(await data.arrayBuffer());
  const filename = serviceContractDocumentFileName(trimmed) ?? "service-contract-document";

  return {
    filename,
    content: buffer,
    contentType: contentTypeFromDocumentPath(trimmed),
  };
}

export async function markServiceContractDocumentSent(
  supabase: SupabaseClient,
  tenantId: string,
  contractId: string,
): Promise<void> {
  const { error } = await supabase
    .from("service_contracts")
    .update({
      document_sent_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", contractId)
    .eq("tenant_id", tenantId);

  if (error) {
    console.error(
      `[service-contract-document-send] document_sent_at update failed (${contractId}):`,
      error.message,
    );
  }
}

export async function sendServiceContractDocumentToCustomer(options: {
  supabase: SupabaseClient;
  tenantId: string;
  contractId: string;
  clientId: string;
  contractNumber: string;
  customerName: string;
  documentUrl: string;
  businessUnitId?: string | null;
}): Promise<void> {
  const attachment = await loadServiceContractDocumentAttachment(options.documentUrl);

  await notifyClientContractDocumentSent({
    tenantId: options.tenantId,
    clientId: options.clientId,
    contractId: options.contractId,
    contractNumber: options.contractNumber,
    customerName: options.customerName,
    attachment,
    businessUnitId: options.businessUnitId ?? null,
  });

  await markServiceContractDocumentSent(
    options.supabase,
    options.tenantId,
    options.contractId,
  );
}

export function shouldSendContractDocumentOnUpdate(
  previous: {
    status: string;
    document_url: string | null;
  },
  next: {
    status: string;
    document_url: string | null;
  },
): boolean {
  const prevStatus = (previous.status ?? "").trim().toLowerCase();
  const nextStatus = (next.status ?? "").trim().toLowerCase();
  const prevDoc = (previous.document_url ?? "").trim();
  const nextDoc = (next.document_url ?? "").trim();

  if (!nextDoc) {
    return false;
  }

  if (prevStatus === "draft" && nextStatus === "active") {
    return true;
  }

  if (nextStatus === "active" && prevDoc !== nextDoc) {
    return true;
  }

  return false;
}

export function validateServiceContractActivationRequiresDocument(
  previous: { status: string; document_url: string | null },
  nextStatus: string,
  nextDocumentUrl: string | null,
): string | null {
  const prevStatus = (previous.status ?? "").trim().toLowerCase();
  const normalizedNext = (nextStatus ?? "").trim().toLowerCase();

  if (prevStatus === "draft" && normalizedNext === "active") {
    const doc = (nextDocumentUrl ?? "").trim();
    if (!doc) {
      return "Attach the contract document before activating this contract";
    }
  }

  return null;
}
