"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { pdf } from "@react-pdf/renderer";
import { LoadingState } from "@/components/loading-indicator";
import { useTenantBranding } from "@/app/dashboard/tenant-branding-context";
import type { BillingSettingsHeaderFields } from "@/utils/billing-settings-types";
import {
  CLIENT_INVOICE_PRINT_AREA_ID,
  formatInvoiceDate,
  formatInvoiceMoney,
  normalizeClientInvoiceDetail,
  resolveBrandingLogoUrl,
  resolveDocumentLogoUrl,
  resolveSignatureImageUrl,
  type ClientInvoiceDetailPayload,
} from "./client-invoice-display-utils";
import ClientInvoicePdfDocument from "./client-invoice-pdf-document";
import ClientInvoicePrintLayout from "./client-invoice-print-layout";
import { ClientInvoicePrintStyles } from "./client-invoice-print-styles";
import RecordPaymentDialog from "./record-payment-dialog";
import { formatReceiptMoney } from "@/utils/client-receipts-types";
import type { ClientReceiptHeaderRow } from "@/utils/client-receipts-types";
import { toNumber, resolveSourceContractLink, resolveSourceQuotationLink } from "@/utils/client-invoices-types";

type ClientInvoiceViewProps = {
  invoiceId: string;
  billingSettings: BillingSettingsHeaderFields | null;
  graTin: string | null;
  paymentMethods?: string[];
  backHref?: string;
  backLabel?: string;
  showStaffActions?: boolean;
};

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButtonClassName =
  "rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

const traceabilityBadgeClassName =
  "inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-3 py-1 text-sm font-medium text-sky-800 transition-colors hover:bg-sky-100";

const contractTraceabilityBadgeClassName =
  "inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-3 py-1 text-sm font-medium text-violet-800 transition-colors hover:bg-violet-100";

function ClientInvoicePrintStylesLegacy() {
  return <ClientInvoicePrintStyles printAreaId={CLIENT_INVOICE_PRINT_AREA_ID} />;
}

export default function ClientInvoiceView({
  invoiceId,
  billingSettings,
  graTin,
  paymentMethods = [],
  backHref = "/dashboard/finance/client-invoices",
  backLabel = "Back to list",
  showStaffActions = true,
}: ClientInvoiceViewProps) {
  const branding = useTenantBranding();
  const [payload, setPayload] = useState<ClientInvoiceDetailPayload | null>(null);
  const [receipts, setReceipts] = useState<ClientReceiptHeaderRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [showRecordPayment, setShowRecordPayment] = useState(false);

  const loadInvoice = useCallback(async () => {
    setLoading(true);
    setError(null);

    const response = await fetch(`/api/client-invoices/${invoiceId}`);
    const body = (await response.json().catch(() => null)) as
      | (ClientInvoiceDetailPayload & { error?: string })
      | null;

    if (!response.ok || !body?.client_invoice) {
      setError(body?.error ?? "Unable to load invoice.");
      setPayload(null);
      setReceipts([]);
      setLoading(false);
      return;
    }

    setPayload({
      client_invoice: body.client_invoice,
      line_items: body.line_items ?? [],
      payment_account_ids: body.payment_account_ids ?? [],
      payment_accounts: body.payment_accounts ?? [],
      receipts: body.receipts ?? [],
      business_unit_contact: body.business_unit_contact ?? null,
    });
    setReceipts(body.receipts ?? []);
    setLoading(false);
  }, [invoiceId]);

  useEffect(() => {
    void loadInvoice();
  }, [loadInvoice]);

  const display = useMemo(() => {
    if (!payload) {
      return null;
    }

    const normalized = normalizeClientInvoiceDetail(payload);
    return {
      ...normalized,
      branding,
      billingSettings,
      graTin,
      businessUnitContact: payload.business_unit_contact ?? null,
    };
  }, [payload, branding, billingSettings, graTin]);

  const handlePrint = useCallback(() => {
    window.print();
  }, []);

  const handleDownloadPdf = useCallback(async () => {
    if (!display) {
      return;
    }

    setDownloading(true);

    try {
      const logoUrl = resolveBrandingLogoUrl(
        resolveDocumentLogoUrl(display.branding, display.businessUnitContact),
      );
      const signatureImageUrl = resolveSignatureImageUrl(display.branding.signatureImageUrl);
      const blob = await pdf(
        <ClientInvoicePdfDocument
          {...display}
          logoUrl={logoUrl}
          signatureImageUrl={signatureImageUrl}
        />,
      ).toBlob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `${display.invoice.invoice_number}.pdf`;
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

  if (loading) {
    return <LoadingState label="Loading invoice…" />;
  }

  if (error || !display) {
    return (
      <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {error ?? "Invoice not found."}
      </p>
    );
  }

  const { invoice } = display;
  const sourceQuotation = resolveSourceQuotationLink(invoice);
  const sourceContract = resolveSourceContractLink(invoice);
  const canRecordPayment =
    showStaffActions &&
    invoice.status !== "draft" &&
    invoice.status !== "paid" &&
    invoice.status !== "voided";

  return (
    <div className="space-y-4">
      <ClientInvoicePrintStylesLegacy />

      {invoice.status === "voided" ? (
        <div className="no-print rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          This invoice has been voided and is no longer payable.
        </div>
      ) : null}

      {showStaffActions && sourceQuotation ? (
        <div className="no-print">
          <Link
            href={`/dashboard/sales-crm/quotations/${sourceQuotation.id}`}
            className={traceabilityBadgeClassName}
          >
            From Quotation {sourceQuotation.quotation_number}
          </Link>
        </div>
      ) : null}

      {showStaffActions && sourceContract ? (
        <div className="no-print">
          <Link
            href={`/dashboard/finance/service-contracts/${sourceContract.id}`}
            className={contractTraceabilityBadgeClassName}
          >
            From Contract {sourceContract.contract_number}
          </Link>
        </div>
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
        {canRecordPayment ? (
          <button
            type="button"
            onClick={() => setShowRecordPayment(true)}
            className={primaryButtonClassName}
          >
            Record Payment
          </button>
        ) : null}
        {showStaffActions ? (
          <Link
            href={`/dashboard/finance/client-invoices/${invoiceId}/edit`}
            className={secondaryButtonClassName}
          >
            Edit
          </Link>
        ) : null}
        <Link href={backHref} className={secondaryButtonClassName}>
          {backLabel}
        </Link>
      </div>

      {receipts.length > 0 ? (
        <section className="no-print rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <h3 className="mb-3 text-sm font-semibold text-[#0f2744]">Receipts issued</h3>
          <ul className="divide-y divide-slate-100">
            {receipts.map((receipt) => (
              <li
                key={receipt.id}
                className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"
              >
                <span>
                  {receipt.receipt_number} — {formatInvoiceDate(receipt.receipt_date)} —{" "}
                  {formatReceiptMoney(receipt.amount)}
                </span>
                <Link
                  href={
                    showStaffActions
                      ? `/dashboard/finance/client-receipts/${receipt.id}`
                      : `/dashboard/client-portal/receipts/${receipt.id}`
                  }
                  className={secondaryButtonClassName}
                >
                  View receipt
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {showRecordPayment ? (
        <RecordPaymentDialog
          invoiceId={invoiceId}
          invoiceNumber={invoice.invoice_number}
          totalDue={toNumber(invoice.total_amount_due)}
          whtRate={toNumber(invoice.wht_rate)}
          whtAmount={toNumber(invoice.wht_amount)}
          amountReceived={toNumber(invoice.amount_received ?? 0)}
          paymentMethods={paymentMethods}
          onClose={() => setShowRecordPayment(false)}
          onSuccess={() => {
            setShowRecordPayment(false);
            void loadInvoice();
          }}
        />
      ) : null}

      <ClientInvoicePrintLayout
        display={display}
        printAreaId={CLIENT_INVOICE_PRINT_AREA_ID}
      />
    </div>
  );
}
