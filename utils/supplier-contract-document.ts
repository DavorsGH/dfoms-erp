import {
  LEASE_DOCUMENT_ACCEPT,
  LEASE_DOCUMENT_HINT,
  resolveLeaseDocumentContentType,
  isAcceptedLeaseDocumentFile,
} from "@/utils/lease-document";

const IMAGE_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

const IMAGE_EXTENSIONS: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

export const SUPPLIER_CONTRACT_DOCUMENT_ACCEPT = `${LEASE_DOCUMENT_ACCEPT},image/jpeg,image/png,image/webp,.jpg,.jpeg,.png,.webp`;

export const SUPPLIER_CONTRACT_DOCUMENT_HINT = `${LEASE_DOCUMENT_HINT} JPEG, PNG, or WebP also accepted.`;

function extensionFromFileName(fileName: string): string | null {
  const match = /\.([a-z0-9]+)$/i.exec(fileName.trim());
  return match ? match[1].toLowerCase() : null;
}

export function resolveSupplierContractDocumentContentType(file: File): string | null {
  const leaseType = resolveLeaseDocumentContentType(file);
  if (leaseType) {
    return leaseType;
  }

  const mime = file.type.toLowerCase().trim();
  if (mime && IMAGE_MIME_TYPES.has(mime)) {
    return mime;
  }

  const ext = extensionFromFileName(file.name);
  if (ext && IMAGE_EXTENSIONS[ext]) {
    return IMAGE_EXTENSIONS[ext];
  }

  return null;
}

export function isAcceptedSupplierContractDocumentFile(file: File): boolean {
  return (
    isAcceptedLeaseDocumentFile(file) ||
    resolveSupplierContractDocumentContentType(file) != null
  );
}

export function getSupplierContractDocumentStoragePath(
  tenantId: string,
  contractId: string,
  file: File,
  amendmentId?: string | null,
): string {
  const contentType = resolveSupplierContractDocumentContentType(file) ?? "application/pdf";
  const ext =
    contentType === "image/jpeg"
      ? "jpg"
      : contentType === "image/png"
        ? "png"
        : contentType === "image/webp"
          ? "webp"
          : contentType === "application/msword"
            ? "doc"
            : contentType ===
                "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
              ? "docx"
              : extensionFromFileName(file.name) ?? "pdf";

  const segment = amendmentId
    ? `amendments/${amendmentId}`
    : "contract";
  return `${tenantId}/finance/supplier-contracts/${contractId}/${segment}/${crypto.randomUUID()}.${ext}`;
}
