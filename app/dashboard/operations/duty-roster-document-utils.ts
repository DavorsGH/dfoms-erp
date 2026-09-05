import type { DutyRosterViewModel } from "./duty-roster-utils";

export type DutyRosterPdfPayload = {
  companyLegalName: string;
  /** Absolute/signed logo URL for PDF header; empty when unavailable. */
  companyLogoUrl?: string;
  clientName: string;
  effectiveLabel: string;
  rotationLabel: string;
  morningTime: string;
  afternoonTime: string;
  supervisorTime: string;
  rows: DutyRosterViewModel["rows"];
  totals: DutyRosterViewModel["totals"];
  preparedBy: string;
  approvedByName: string | null;
  approvedByTitle: string | null;
  approvedAt: string | null;
  rosterDate: string;
  signatureImageUrl: string | null;
};

export function buildDutyRosterPdfFileName(clientName: string, rotationNumber: number): string {
  const slug = clientName
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `duty-roster-${slug || "customer"}-rotation-${rotationNumber}.pdf`;
}

export async function fetchImageAsDataUrl(url: string): Promise<string | null> {
  try {
    const response = await fetch(url, { mode: "cors", credentials: "omit" });
    if (!response.ok) {
      return null;
    }

    const blob = await response.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        resolve(typeof reader.result === "string" ? reader.result : null);
      };
      reader.onerror = () => resolve(null);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

export async function loadTenantSignatureDataUrl(): Promise<string | null> {
  try {
    const response = await fetch("/api/tenant/signature-image");
    if (!response.ok) {
      return null;
    }

    const payload = (await response.json()) as { dataUrl?: string };
    return payload.dataUrl?.trim() || null;
  } catch {
    return null;
  }
}

export async function resolveDocumentSignatureImageUrl(
  signatureImageUrl: string | null | undefined,
): Promise<string | null> {
  if (!signatureImageUrl?.trim()) {
    return null;
  }

  const tenantDataUrl = await loadTenantSignatureDataUrl();
  if (tenantDataUrl) {
    return tenantDataUrl;
  }

  const dataUrl = await fetchImageAsDataUrl(signatureImageUrl);
  return dataUrl ?? signatureImageUrl;
}
