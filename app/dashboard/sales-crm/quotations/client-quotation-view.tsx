"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { pdf } from "@react-pdf/renderer";
import { LoadingState } from "@/components/loading-indicator";
import { useTenantBranding } from "@/app/dashboard/tenant-branding-context";
import type { BillingSettingsHeaderFields } from "@/utils/billing-settings-types";
import {
  CLIENT_QUOTATION_PRINT_AREA_ID,
  normalizeClientQuotationDetail,
  resolveBrandingLogoUrl,
  resolveConvertedInvoiceLink,
  resolveSignatureImageUrl,
  type ClientQuotationDetailPayload,
} from "./client-quotation-display-utils";
import { resolveRaisedContractLink } from "@/utils/client-quotations-types";
import ClientQuotationPdfDocument from "./client-quotation-pdf-document";
import ClientQuotationPrintLayout from "./client-quotation-print-layout";
import { ClientQuotationPrintStyles } from "./client-quotation-print-styles";

type ClientQuotationViewProps = {
  quotationId: string;
  billingSettings: BillingSettingsHeaderFields | null;
  canConvertToInvoice?: boolean;
  backHref?: string;
  backLabel?: string;
  showStaffActions?: boolean;
};

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButtonClassName =
  "rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

const traceabilityBadgeClassName =
  "inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1 text-sm font-medium text-emerald-800 transition-colors hover:bg-emerald-100";

const contractTraceabilityBadgeClassName =
  "inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-sm font-medium text-violet-800 transition-colors hover:bg-violet-100";

function ClientQuotationPrintStylesLegacy() {
  return <ClientQuotationPrintStyles printAreaId={CLIENT_QUOTATION_PRINT_AREA_ID} />;
}

export default function ClientQuotationView({
  quotationId,
  billingSettings,
  canConvertToInvoice = false,
  backHref = "/dashboard/sales-crm/quotations",
  backLabel = "Back to list",
  showStaffActions = true,
}: ClientQuotationViewProps) {
  const router = useRouter();
  const branding = useTenantBranding();
  const [payload, setPayload] = useState<ClientQuotationDetailPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [converting, setConverting] = useState(false);
  const [raisingContract, setRaisingContract] = useState(false);
  const [confirmAction, setConfirmAction] = useState<"convert" | "raise-contract" | null>(
    null,
  );

  useEffect(() => {
    let cancelled = false;

    async function loadQuotation() {
      setLoading(true);
      setError(null);

      const response = await fetch(`/api/client-quotations/${quotationId}`);
      const body = (await response.json().catch(() => null)) as
        | (ClientQuotationDetailPayload & { error?: string })
        | null;

      if (cancelled) {
        return;
      }

      if (!response.ok || !body?.client_quotation) {
        setError(body?.error ?? "Unable to load quotation.");
        setPayload(null);
        setLoading(false);
        return;
      }

      setPayload({
        client_quotation: body.client_quotation,
        line_items: body.line_items ?? [],
        payment_account_ids: body.payment_account_ids ?? [],
        payment_accounts: body.payment_accounts ?? [],
      });
      setLoading(false);
    }

    void loadQuotation();

    return () => {
      cancelled = true;
    };
  }, [quotationId]);

  const display = useMemo(() => {
    if (!payload) {
      return null;
    }

    const normalized = normalizeClientQuotationDetail(payload);
    return {
      ...normalized,
      branding,
      billingSettings,
    };
  }, [payload, branding, billingSettings]);

  const convertedInvoice = display
    ? resolveConvertedInvoiceLink(display.quotation)
    : null;

  const raisedContract = display
    ? resolveRaisedContractLink(display.quotation)
    : null;

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  const handleDownloadPdf = useCallback(async () => {
    if (!display) {
      return;
    }

    setDownloading(true);

    try {
      const logoUrl = resolveBrandingLogoUrl(display.branding.workspaceLogoUrl);
      const signatureImageUrl = resolveSignatureImageUrl(display.branding.signatureImageUrl);
      const blob = await pdf(
        <ClientQuotationPdfDocument
          {...display}
          logoUrl={logoUrl}
          signatureImageUrl={signatureImageUrl}
        />,
      ).toBlob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${display.quotation.quotation_number}.pdf`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError("Unable to generate PDF. Try again or use Print.");
    } finally {
      setDownloading(false);
    }
  }, [display]);

  const handleConvertToInvoice = useCallback(async () => {
    setConverting(true);
    setError(null);

    try {
      const response = await fetch(`/api/client-quotations/${quotationId}/convert`, {
        method: "POST",
      });

      const body = (await response.json().catch(() => null)) as
        | { client_invoice?: { id: string }; error?: string }
        | null;

      if (!response.ok || !body?.client_invoice?.id) {
        setError(body?.error ?? "Unable to convert quotation to invoice.");
        return;
      }

      setConfirmAction(null);
      router.push(`/dashboard/finance/client-invoices/${body.client_invoice.id}`);
      router.refresh();
    } catch {
      setError("Unable to convert quotation. Check your connection and try again.");
    } finally {
      setConverting(false);
    }
  }, [quotationId, router]);

  const handleRaiseContract = useCallback(async () => {
    setRaisingContract(true);
    setError(null);

    try {
      const response = await fetch(
        `/api/client-quotations/${quotationId}/raise-contract`,
        { method: "POST" },
      );

      const body = (await response.json().catch(() => null)) as
        | { service_contract?: { id: string }; error?: string }
        | null;

      if (!response.ok || !body?.service_contract?.id) {
        setError(body?.error ?? "Unable to raise contract from quotation.");
        return;
      }

      setConfirmAction(null);
      router.push(
        `/dashboard/finance/service-contracts/${body.service_contract.id}/edit`,
      );
      router.refresh();
    } catch {
      setError("Unable to raise contract. Check your connection and try again.");
    } finally {
      setRaisingContract(false);
    }
  }, [quotationId, router]);

  if (loading) {
    return <LoadingState label="Loading quotation…" />;
  }

  if (error && !display) {
    return (
      <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {error}
      </p>
    );
  }

  if (!display) {
    return (
      <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        Quotation not found.
      </p>
    );
  }

  const { quotation } = display;
  const showConvertButton =
    showStaffActions &&
    canConvertToInvoice &&
    quotation.status === "accepted" &&
    !quotation.converted_invoice_id;

  const showRaiseContractButton =
    showStaffActions &&
    quotation.status === "accepted" &&
    !quotation.contract_id;

  return (
    <div className="space-y-4">
      <ClientQuotationPrintStylesLegacy />

      {error ? (
        <p className="no-print rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {convertedInvoice ? (
        <div className="no-print">
          <Link
            href={`/dashboard/finance/client-invoices/${convertedInvoice.id}`}
            className={traceabilityBadgeClassName}
          >
            Converted → {convertedInvoice.invoice_number}
          </Link>
        </div>
      ) : null}

      {raisedContract ? (
        <div className="no-print">
          <Link
            href={`/dashboard/finance/service-contracts/${raisedContract.id}`}
            className={contractTraceabilityBadgeClassName}
          >
            Contract Raised → {raisedContract.contract_number}
          </Link>
        </div>
      ) : null}

      {confirmAction === "convert" ? (
        <p className="no-print rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          Convert {quotation.quotation_number} to a customer invoice?
          <span className="ml-3 inline-flex gap-2">
            <button
              type="button"
              onClick={() => void handleConvertToInvoice()}
              disabled={converting}
              className={primaryButtonClassName}
            >
              {converting ? "Converting…" : "Confirm"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmAction(null)}
              disabled={converting}
              className={secondaryButtonClassName}
            >
              Cancel
            </button>
          </span>
        </p>
      ) : null}

      {confirmAction === "raise-contract" ? (
        <p className="no-print rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          Raise a service contract from {quotation.quotation_number}?
          <span className="ml-3 inline-flex gap-2">
            <button
              type="button"
              onClick={() => void handleRaiseContract()}
              disabled={raisingContract}
              className={primaryButtonClassName}
            >
              {raisingContract ? "Raising…" : "Confirm"}
            </button>
            <button
              type="button"
              onClick={() => setConfirmAction(null)}
              disabled={raisingContract}
              className={secondaryButtonClassName}
            >
              Cancel
            </button>
          </span>
        </p>
      ) : null}

      <div className="no-print flex flex-wrap gap-3">
        <button
          type="button"
          onClick={handlePrint}
          className={primaryButtonClassName}
        >
          Print
        </button>
        <button
          type="button"
          onClick={() => void handleDownloadPdf()}
          disabled={downloading}
          className={primaryButtonClassName}
        >
          {downloading ? "Generating PDF…" : "Download PDF"}
        </button>
        {showRaiseContractButton ? (
          <button
            type="button"
            onClick={() => setConfirmAction("raise-contract")}
            disabled={raisingContract || confirmAction !== null}
            className={primaryButtonClassName}
          >
            Raise Contract
          </button>
        ) : null}
        {showConvertButton ? (
          <button
            type="button"
            onClick={() => setConfirmAction("convert")}
            disabled={converting || confirmAction !== null}
            className={primaryButtonClassName}
          >
            Convert to Invoice
          </button>
        ) : null}
        {showStaffActions && !quotation.converted_invoice_id ? (
          <Link
            href={`/dashboard/sales-crm/quotations/${quotationId}/edit`}
            className={secondaryButtonClassName}
          >
            Edit
          </Link>
        ) : null}
        <Link href={backHref} className={secondaryButtonClassName}>
          {backLabel}
        </Link>
      </div>

      {showStaffActions && display.quotation.internal_notes?.trim() ? (
        <section className="no-print rounded-lg border border-amber-200 bg-amber-50 p-4">
          <h3 className="text-sm font-semibold text-amber-900">Internal Notes</h3>
          <p className="mt-2 whitespace-pre-wrap text-sm text-amber-950">
            {display.quotation.internal_notes.trim()}
          </p>
          <p className="mt-2 text-xs text-amber-800">
            Staff only — not shown on print/PDF or client portal.
          </p>
        </section>
      ) : null}

      <ClientQuotationPrintLayout
        display={display}
        printAreaId={CLIENT_QUOTATION_PRINT_AREA_ID}
      />
    </div>
  );
}
