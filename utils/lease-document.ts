/**
 * Client-safe lease document helpers (constants + file validation).
 * Server upload logic lives in lease-document-upload.ts.
 */

const ACCEPTED_MIME_TYPES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
]);

const EXTENSION_BY_MIME: Record<string, string> = {
  "application/pdf": "pdf",
  "application/msword": "doc",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
};

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

export const LEASE_DOCUMENT_ACCEPT =
  ".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document";

export const LEASE_DOCUMENT_HINT = "PDF, DOC, or DOCX.";

function extensionFromFileName(fileName: string): string | null {
  const match = /\.([a-z0-9]+)$/i.exec(fileName.trim());
  return match ? match[1].toLowerCase() : null;
}

export function resolveLeaseDocumentContentType(file: File): string | null {
  const mime = file.type.toLowerCase().trim();
  if (mime && ACCEPTED_MIME_TYPES.has(mime)) {
    return mime;
  }
  const ext = extensionFromFileName(file.name);
  if (ext && MIME_BY_EXTENSION[ext]) {
    return MIME_BY_EXTENSION[ext];
  }
  return null;
}

export function isAcceptedLeaseDocumentFile(file: File): boolean {
  return resolveLeaseDocumentContentType(file) != null;
}

export function getLeaseDocumentStoragePath(
  tenantId: string,
  leaseId: string,
  file: File,
): string {
  const contentType = resolveLeaseDocumentContentType(file) ?? "application/pdf";
  const extension =
    EXTENSION_BY_MIME[contentType] ??
    extensionFromFileName(file.name) ??
    "pdf";
  return `${tenantId}/real-estate/lease/${leaseId}/${crypto.randomUUID()}.${extension}`;
}
