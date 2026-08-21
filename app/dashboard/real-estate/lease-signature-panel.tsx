"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { pdf } from "@react-pdf/renderer";
import ImageFileUploadButton from "@/components/image-file-upload-button";
import {
  LEASE_DOCUMENT_ACCEPT,
  LEASE_DOCUMENT_HINT,
} from "@/utils/lease-document";
import {
  LEASE_SIGNATURE_DISCLAIMER,
  formatLeaseSignatureStatus,
  type LeaseSignatureStatus,
} from "@/utils/lease-signature";
import { formatLeaseDate } from "./leases-utils";
import LeasePdfDocument, {
  computeLeaseTermMonths,
  formatTerminationNoticeLabel,
} from "./lease-pdf-document";

export type LeaseSignaturePanelMode =
  | "staff"
  | "landlord_manage"
  | "landlord_view"
  | "tenant";

export type LeaseSignaturePanelProps = {
  mode: LeaseSignaturePanelMode;
  tenantId: string;
  leaseId: string;
  signatureStatus: LeaseSignatureStatus | string;
  landlordAcknowledgedAt: string | null;
  tenantAcknowledgedAt: string | null;
  landlordName: string;
  landlordAddress: string | null;
  landlordPhone: string | null;
  lesseeName: string;
  lesseePhone: string;
  lesseeEmail: string | null;
  propertyName: string;
  propertyAddress: string;
  propertyStreetAddress: string;
  propertyLocation: string;
  unitNumber: string;
  startDate: string;
  endDate: string;
  rentAmountGhs: number;
  /** leases.advance_rent_amount_ghs */
  advanceRentAmountGhs: number;
  /** leases.termination_notice_months */
  terminationNoticeMonths: number;
  depositAmountGhs: number | null;
  agreementDate: string;
  /** Custom uploaded lease PDF/Word; preferred over generated default when set. */
  leaseDocumentUrl: string | null;
  /** Tighter spacing for lease detail pages. */
  compact?: boolean;
};

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButtonClassName =
  "rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

const dangerButtonClassName =
  "rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50";

type ActionResponse = {
  ok?: boolean;
  error?: string;
  status?: string;
  lease_document_url?: string | null;
};

function apiForMode(mode: LeaseSignaturePanelMode): string | null {
  if (mode === "staff") {
    return "/api/admin/leases/signature";
  }
  if (mode === "landlord_manage") {
    return "/api/landlord-portal/leases/signature";
  }
  if (mode === "tenant") {
    return "/api/portal/leases/acknowledge";
  }
  return null;
}

function documentUploadApiForMode(mode: LeaseSignaturePanelMode): string | null {
  if (mode === "staff") {
    return "/api/admin/leases/upload-document";
  }
  if (mode === "landlord_manage") {
    return "/api/landlord-portal/leases/upload-document";
  }
  return null;
}

export default function LeaseSignaturePanel(props: LeaseSignaturePanelProps) {
  const router = useRouter();
  const [downloading, setDownloading] = useState(false);
  const [working, setWorking] = useState(false);
  const [uploadingDocument, setUploadingDocument] = useState(false);
  const [documentUrl, setDocumentUrl] = useState(props.leaseDocumentUrl);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    setDocumentUrl(props.leaseDocumentUrl);
  }, [props.leaseDocumentUrl]);

  const canMarkSent =
    props.mode === "staff" || props.mode === "landlord_manage";
  const canAckLandlord =
    props.mode === "staff" || props.mode === "landlord_manage";
  const canAckTenant = props.mode === "staff" || props.mode === "tenant";
  const canManageDocument =
    props.mode === "staff" || props.mode === "landlord_manage";

  const status = props.signatureStatus || "unsigned";
  const markSentDisabled =
    status !== "unsigned" && status !== "sent" ? true : status === "sent";
  const landlordAcked = Boolean(props.landlordAcknowledgedAt);
  const tenantAcked = Boolean(props.tenantAcknowledgedAt);
  const customDocumentUrl = documentUrl?.trim() || null;
  const busy = downloading || working || uploadingDocument;

  async function handleDownloadPdf() {
    setError(null);
    setSuccess(null);
    setDownloading(true);
    try {
      if (customDocumentUrl) {
        const params = new URLSearchParams({
          reference: customDocumentUrl,
          tenant_id: props.tenantId,
        });
        const response = await fetch(
          `/api/storage/tenant-logos/signed-url?${params.toString()}`,
        );
        const payload = (await response.json().catch(() => null)) as {
          signedUrl?: string;
          error?: string;
        } | null;
        if (!response.ok || !payload?.signedUrl) {
          throw new Error(payload?.error ?? "Unable to open lease document.");
        }
        window.open(payload.signedUrl, "_blank", "noopener,noreferrer");
        setSuccess("Opened uploaded lease document.");
        return;
      }

      const termMonths = computeLeaseTermMonths(
        props.startDate,
        props.endDate,
      );

      const blob = await pdf(
        <LeasePdfDocument
          agreementDate={props.agreementDate}
          landlordName={props.landlordName}
          landlordAddress={props.landlordAddress ?? "—"}
          landlordPhone={props.landlordPhone ?? "—"}
          lesseeName={props.lesseeName}
          lesseePhone={props.lesseePhone}
          lesseeEmail={props.lesseeEmail}
          propertyAddress={props.propertyAddress}
          propertyStreetAddress={props.propertyStreetAddress}
          propertyName={props.propertyName}
          unitNumber={props.unitNumber}
          locationLabel={props.propertyLocation}
          startDate={props.startDate}
          endDate={props.endDate}
          rentAmountGhs={props.rentAmountGhs}
          termMonths={termMonths}
          advanceAmountGhs={props.advanceRentAmountGhs}
          depositAmountGhs={props.depositAmountGhs}
          noticePeriodLabel={formatTerminationNoticeLabel(
            props.terminationNoticeMonths,
          )}
        />,
      ).toBlob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `lease-${props.unitNumber || props.leaseId}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setSuccess("Lease PDF downloaded.");
    } catch {
      setError("Unable to generate lease PDF.");
    } finally {
      setDownloading(false);
    }
  }

  async function handleUploadDocument(file: File) {
    const endpoint = documentUploadApiForMode(props.mode);
    if (!endpoint) {
      return;
    }

    setUploadingDocument(true);
    setError(null);
    setSuccess(null);

    try {
      const formData = new FormData();
      formData.set("lease_id", props.leaseId);
      formData.set("file", file);
      if (props.mode === "staff") {
        formData.set("tenant_id", props.tenantId);
      }

      const response = await fetch(endpoint, {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json().catch(() => null)) as ActionResponse | null;
      if (!response.ok || !payload?.ok) {
        setError(payload?.error ?? "Unable to upload lease document.");
        setUploadingDocument(false);
        return;
      }

      const nextUrl =
        typeof payload.lease_document_url === "string"
          ? payload.lease_document_url
          : null;
      setDocumentUrl(nextUrl);
      setSuccess("Custom lease document uploaded.");
      setUploadingDocument(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Upload failed.");
      setUploadingDocument(false);
    }
  }

  async function handleRemoveDocument() {
    const endpoint = documentUploadApiForMode(props.mode);
    if (!endpoint) {
      return;
    }

    setUploadingDocument(true);
    setError(null);
    setSuccess(null);

    try {
      const formData = new FormData();
      formData.set("lease_id", props.leaseId);
      formData.set("action", "remove");
      if (props.mode === "staff") {
        formData.set("tenant_id", props.tenantId);
      }

      const response = await fetch(endpoint, {
        method: "POST",
        body: formData,
      });
      const payload = (await response.json().catch(() => null)) as ActionResponse | null;
      if (!response.ok || !payload?.ok) {
        setError(payload?.error ?? "Unable to remove lease document.");
        setUploadingDocument(false);
        return;
      }

      setDocumentUrl(null);
      setSuccess(
        "Custom lease document removed. Download will use the generated lease PDF.",
      );
      setUploadingDocument(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Remove failed.");
      setUploadingDocument(false);
    }
  }

  async function postAction(
    action: "mark_sent" | "acknowledge_landlord" | "acknowledge_tenant",
  ) {
    const endpoint = apiForMode(props.mode);
    if (!endpoint) {
      return;
    }

    setWorking(true);
    setError(null);
    setSuccess(null);

    try {
      const body: Record<string, string> =
        props.mode === "tenant"
          ? {}
          : props.mode === "staff"
            ? {
                tenant_id: props.tenantId,
                lease_id: props.leaseId,
                action,
              }
            : {
                lease_id: props.leaseId,
                action,
              };

      // Tenant route only acknowledges tenant; staff/landlord send action.
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          props.mode === "tenant" ? { lease_id: props.leaseId } : body,
        ),
      });
      const payload = (await response.json().catch(() => null)) as ActionResponse | null;
      if (!response.ok || !payload?.ok) {
        setError(payload?.error ?? "Unable to update lease acknowledgment.");
        setWorking(false);
        return;
      }

      if (action === "mark_sent") {
        setSuccess("Lease marked as sent for acknowledgment.");
      } else if (action === "acknowledge_landlord") {
        setSuccess("Landlord acknowledgment recorded.");
      } else {
        setSuccess("Tenant acknowledgment recorded.");
      }
      setWorking(false);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Request failed.");
      setWorking(false);
    }
  }

  const downloadLabel = downloading
    ? customDocumentUrl
      ? "Opening…"
      : "Generating PDF…"
    : customDocumentUrl
      ? "Download lease document"
      : "Download lease PDF";

  return (
    <section
      className={
        props.compact
          ? "space-y-3 rounded-md border border-slate-200 bg-white p-3"
          : "space-y-4 rounded-md border border-slate-200 bg-white p-4"
      }
    >
      <div>
        <h3 className="text-xs font-semibold uppercase tracking-wide text-[#0f2744]">
          Lease acknowledgment
        </h3>
        <p className="mt-0.5 text-sm text-slate-600">
          Status:{" "}
          <span className="font-medium text-slate-900">
            {formatLeaseSignatureStatus(status)}
          </span>
        </p>
      </div>

      <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Landlord acknowledged
          </dt>
          <dd className="mt-1 text-sm text-slate-900">
            {props.landlordAcknowledgedAt
              ? formatLeaseDate(props.landlordAcknowledgedAt)
              : "Not yet"}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Tenant acknowledged
          </dt>
          <dd className="mt-1 text-sm text-slate-900">
            {props.tenantAcknowledgedAt
              ? formatLeaseDate(props.tenantAcknowledgedAt)
              : "Not yet"}
          </dd>
        </div>
      </dl>

      <p className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs text-slate-600">
        {LEASE_SIGNATURE_DISCLAIMER}
      </p>

      {customDocumentUrl ? (
        <p className="text-xs text-slate-600">
          A custom lease document is on file — download opens that upload instead
          of the generated default agreement.
        </p>
      ) : null}

      {canManageDocument ? (
        <div className="space-y-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-3">
          <p className="text-sm font-medium text-slate-800">
            Custom lease document
          </p>
          <p className="text-xs text-slate-600">
            Upload a PDF or Word file to replace the generated lease PDF. Remove
            to fall back to the generated agreement.
          </p>
          <div className="flex flex-wrap items-end gap-3">
            <ImageFileUploadButton
              files={[]}
              onChange={(next) => {
                const file = next[0];
                if (file) {
                  void handleUploadDocument(file);
                }
              }}
              multiple={false}
              disabled={busy}
              accept={LEASE_DOCUMENT_ACCEPT}
              emptyHint={LEASE_DOCUMENT_HINT}
              addLabel={
                uploadingDocument
                  ? "Uploading…"
                  : customDocumentUrl
                    ? "Replace document"
                    : "Upload document"
              }
              showClear={false}
              resetInputAfterSelect
            />
            {customDocumentUrl ? (
              <button
                type="button"
                onClick={() => void handleRemoveDocument()}
                disabled={busy}
                className={dangerButtonClassName}
              >
                {uploadingDocument ? "Working…" : "Remove custom document"}
              </button>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void handleDownloadPdf()}
          disabled={busy}
          className={secondaryButtonClassName}
        >
          {downloadLabel}
        </button>

        {canMarkSent ? (
          <button
            type="button"
            onClick={() => void postAction("mark_sent")}
            disabled={busy || markSentDisabled}
            className={primaryButtonClassName}
          >
            {status === "sent" ? "Already sent" : "Mark sent"}
          </button>
        ) : null}

        {canAckLandlord ? (
          <button
            type="button"
            onClick={() => void postAction("acknowledge_landlord")}
            disabled={busy || landlordAcked || status === "unsigned"}
            className={primaryButtonClassName}
          >
            {landlordAcked ? "Landlord acknowledged" : "Acknowledge as landlord"}
          </button>
        ) : null}

        {canAckTenant ? (
          <button
            type="button"
            onClick={() => void postAction("acknowledge_tenant")}
            disabled={busy || tenantAcked || status === "unsigned"}
            className={primaryButtonClassName}
          >
            {tenantAcked ? "Tenant acknowledged" : "Acknowledge as tenant"}
          </button>
        ) : null}
      </div>

      {error ? (
        <p className="text-sm text-red-700" role="alert">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="text-sm text-emerald-700" role="status">
          {success}
        </p>
      ) : null}
    </section>
  );
}
