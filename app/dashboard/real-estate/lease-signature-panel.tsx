"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { pdf } from "@react-pdf/renderer";
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
  /** Custom uploaded lease PDF; preferred over generated default when set. */
  leaseDocumentUrl: string | null;
};

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButtonClassName =
  "rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

type ActionResponse = {
  ok?: boolean;
  error?: string;
  status?: string;
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

export default function LeaseSignaturePanel(props: LeaseSignaturePanelProps) {
  const router = useRouter();
  const [downloading, setDownloading] = useState(false);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const canMarkSent =
    props.mode === "staff" || props.mode === "landlord_manage";
  const canAckLandlord =
    props.mode === "staff" || props.mode === "landlord_manage";
  const canAckTenant = props.mode === "staff" || props.mode === "tenant";

  const status = props.signatureStatus || "unsigned";
  const markSentDisabled =
    status !== "unsigned" && status !== "sent" ? true : status === "sent";
  const landlordAcked = Boolean(props.landlordAcknowledgedAt);
  const tenantAcked = Boolean(props.tenantAcknowledgedAt);
  const customDocumentUrl = props.leaseDocumentUrl?.trim() || null;

  async function handleDownloadPdf() {
    setError(null);
    setSuccess(null);
    setDownloading(true);
    try {
      if (customDocumentUrl) {
        window.open(customDocumentUrl, "_blank", "noopener,noreferrer");
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

  return (
    <section className="space-y-4 rounded-md border border-slate-200 bg-white p-4">
      <div>
        <h3 className="text-sm font-semibold uppercase tracking-wide text-[#0f2744]">
          Lease acknowledgment
        </h3>
        <p className="mt-1 text-sm text-slate-600">
          Status:{" "}
          <span className="font-medium text-slate-900">
            {formatLeaseSignatureStatus(status)}
          </span>
        </p>
      </div>

      <dl className="grid gap-3 sm:grid-cols-2">
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

      <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
        {LEASE_SIGNATURE_DISCLAIMER}
      </p>

      {customDocumentUrl ? (
        <p className="text-xs text-slate-600">
          A custom lease document is on file — download opens that upload instead
          of the generated default agreement.
        </p>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => void handleDownloadPdf()}
          disabled={downloading || working}
          className={secondaryButtonClassName}
        >
          {downloading
            ? customDocumentUrl
              ? "Opening…"
              : "Generating PDF…"
            : customDocumentUrl
              ? "Open uploaded lease"
              : "Download lease PDF"}
        </button>

        {canMarkSent ? (
          <button
            type="button"
            onClick={() => void postAction("mark_sent")}
            disabled={working || downloading || markSentDisabled}
            className={primaryButtonClassName}
          >
            {status === "sent" ? "Already sent" : "Mark sent"}
          </button>
        ) : null}

        {canAckLandlord ? (
          <button
            type="button"
            onClick={() => void postAction("acknowledge_landlord")}
            disabled={
              working || downloading || landlordAcked || status === "unsigned"
            }
            className={primaryButtonClassName}
          >
            {landlordAcked ? "Landlord acknowledged" : "Acknowledge as landlord"}
          </button>
        ) : null}

        {canAckTenant ? (
          <button
            type="button"
            onClick={() => void postAction("acknowledge_tenant")}
            disabled={
              working || downloading || tenantAcked || status === "unsigned"
            }
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
