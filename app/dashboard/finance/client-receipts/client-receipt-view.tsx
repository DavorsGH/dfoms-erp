"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { pdf } from "@react-pdf/renderer";
import { LoadingState } from "@/components/loading-indicator";
import { useTenantBranding } from "@/app/dashboard/tenant-branding-context";
import ReceiptDocumentActions from "@/app/dashboard/real-estate/receipt-document-actions";
import type { BillingSettingsHeaderFields } from "@/utils/billing-settings-types";
import type { ClientReceiptHeaderRow } from "@/utils/client-receipts-types";
import ClientReceiptPdfDocument from "./client-receipt-pdf-document";
import {
  CLIENT_RECEIPT_PRINT_AREA_ID,
  formatInvoiceDate,
  formatReceiptMoney,
  hasReceiptAuthorizedBy,
  normalizeClientReceiptDetail,
  resolveInvoiceCompanyName,
  resolveSignatureImageUrl,
  tenantHeaderContactLines,
  type ClientReceiptDetailPayload,
} from "./client-receipt-display-utils";
import { resolveBrandingLogoUrl } from "../client-invoices/client-invoice-display-utils";

type ClientReceiptViewProps = {
  receiptId: string;
  billingSettings: BillingSettingsHeaderFields | null;
  backHref?: string;
  backLabel?: string;
};

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButtonClassName =
  "rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

function ClientReceiptPrintStyles() {
  return (
    <style>{`
      @media print {
        body * {
          visibility: hidden;
        }

        #${CLIENT_RECEIPT_PRINT_AREA_ID},
        #${CLIENT_RECEIPT_PRINT_AREA_ID} * {
          visibility: visible;
        }

        #${CLIENT_RECEIPT_PRINT_AREA_ID} {
          position: absolute;
          inset: 0;
          width: 100%;
          padding: 24px;
          background: white;
        }

        .no-print {
          display: none !important;
        }
      }
    `}</style>
  );
}

export default function ClientReceiptView({
  receiptId,
  billingSettings,
  backHref = "/dashboard/finance/client-receipts",
  backLabel = "Back to receipts",
}: ClientReceiptViewProps) {
  const branding = useTenantBranding();
  const [payload, setPayload] = useState<ClientReceiptDetailPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;

    async function loadReceipt() {
      setLoading(true);
      setError(null);

      const response = await fetch(`/api/client-receipts/${receiptId}`);
      const body = (await response.json().catch(() => null)) as
        | (ClientReceiptDetailPayload & { error?: string })
        | null;

      if (cancelled) {
        return;
      }

      if (!response.ok || !body?.receipt) {
        setError(body?.error ?? "Unable to load receipt.");
        setPayload(null);
        setLoading(false);
        return;
      }

      setPayload({
        receipt: body.receipt as ClientReceiptHeaderRow,
        invoice: body.invoice,
      });
      setLoading(false);
    }

    void loadReceipt();

    return () => {
      cancelled = true;
    };
  }, [receiptId]);

  const display = useMemo(() => {
    if (!payload) {
      return null;
    }

    const normalized = normalizeClientReceiptDetail(payload);
    return {
      ...normalized,
      branding,
      billingSettings,
    };
  }, [payload, branding, billingSettings]);

  const logoUrl = display
    ? resolveBrandingLogoUrl(display.branding.workspaceLogoUrl)
    : "";
  const signatureImageUrl = display
    ? resolveSignatureImageUrl(display.branding.signatureImageUrl)
    : null;

  const renderPdfDocument = useCallback(() => {
    if (!display) {
      throw new Error("Receipt not loaded");
    }

    return (
      <ClientReceiptPdfDocument
        {...display}
        logoUrl={logoUrl}
        signatureImageUrl={signatureImageUrl}
      />
    );
  }, [display, logoUrl, signatureImageUrl]);

  if (loading) {
    return <LoadingState label="Loading receipt…" />;
  }

  if (error || !display) {
    return (
      <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {error ?? "Receipt not found."}
      </p>
    );
  }

  const { receipt, invoice } = display;
  const companyName = resolveInvoiceCompanyName(display.branding, display.billingSettings);
  const companyContactLines = tenantHeaderContactLines(
    display.branding,
    display.billingSettings,
  );

  return (
    <div className="space-y-4">
      <ClientReceiptPrintStyles />

      <div className="no-print">
        <ReceiptDocumentActions
          fileName={`${receipt.receipt_number}.pdf`}
          printAreaId={CLIENT_RECEIPT_PRINT_AREA_ID}
          renderPdfDocument={renderPdfDocument}
          primaryButtonClassName={primaryButtonClassName}
          secondaryButtonClassName={secondaryButtonClassName}
        />
        <Link href={backHref} className={`${secondaryButtonClassName} ml-2 inline-block`}>
          {backLabel}
        </Link>
      </div>

      <div
        id={CLIENT_RECEIPT_PRINT_AREA_ID}
        className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"
      >
        <header className="bg-[#0f2744] px-6 py-6">
          <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
            <div className="flex items-start gap-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={display.branding.workspaceLogoUrl}
                alt={`${companyName} logo`}
                className="h-16 w-16 rounded-md object-cover ring-2 ring-white/25"
              />
              <div>
                <h3 className="text-lg font-bold text-white">{companyName}</h3>
                {companyContactLines.map((line, index) => (
                  <p key={`contact-${index}`} className="mt-1 text-sm text-[#e2e8f0]">
                    {line}
                  </p>
                ))}
              </div>
            </div>
            <div className="rounded-md border-2 border-[#0f2744] bg-[#e8f4f8] p-4 text-left md:min-w-[220px] md:text-right">
              <p className="text-3xl font-bold tracking-wide text-[#c9a227]">RECEIPT</p>
              <dl className="mt-3 space-y-1 text-sm text-slate-800">
                <div>
                  <dt className="inline font-semibold text-[#0f2744]">Receipt #: </dt>
                  <dd className="inline text-slate-900">{receipt.receipt_number}</dd>
                </div>
                <div>
                  <dt className="inline font-semibold text-[#0f2744]">Date: </dt>
                  <dd className="inline text-slate-900">
                    {formatInvoiceDate(receipt.receipt_date)}
                  </dd>
                </div>
                <div>
                  <dt className="inline font-semibold text-[#0f2744]">Invoice #: </dt>
                  <dd className="inline text-slate-900">{invoice.invoice_number}</dd>
                </div>
              </dl>
            </div>
          </div>
        </header>

        <div className="space-y-6 p-8">
          <section className="overflow-hidden rounded-lg border border-[#0f2744]/25">
            <h4 className="bg-[#0f2744] px-4 py-2 text-sm font-semibold uppercase tracking-wide text-white">
              Received From
            </h4>
            <div className="border-t border-[#0f2744]/10 bg-[#e8f4f8]/50 px-4 py-3">
              <p className="text-sm font-medium text-slate-900">{invoice.bill_to_name}</p>
              {invoice.bill_to_address?.trim() ? (
                <p className="text-sm text-slate-800">{invoice.bill_to_address.trim()}</p>
              ) : null}
              {invoice.bill_to_phone?.trim() ? (
                <p className="text-sm text-slate-800">{invoice.bill_to_phone.trim()}</p>
              ) : null}
            </div>
          </section>

          <section className="overflow-hidden rounded-lg border border-[#0f2744]/25">
            <h4 className="bg-[#0f2744] px-4 py-2 text-sm font-semibold uppercase tracking-wide text-white">
              Payment Details
            </h4>
            <div className="border-t border-[#0f2744]/10 bg-[#e8f4f8]/50 px-4 py-3 text-sm text-slate-800">
              {receipt.payment_method?.trim() ? (
                <p>Method: {receipt.payment_method.trim()}</p>
              ) : null}
              {receipt.notes?.trim() ? (
                <p className="mt-1">Notes: {receipt.notes.trim()}</p>
              ) : null}
            </div>
          </section>

          <div className="flex items-center justify-between rounded-md bg-[#0f2744] px-4 py-3">
            <span className="font-semibold text-white">Amount Received</span>
            <span className="text-lg font-bold text-[#c9a227]">
              {formatReceiptMoney(receipt.amount)}
            </span>
          </div>

          {hasReceiptAuthorizedBy(receipt) ? (
            <section className="pt-2 text-left">
              <p className="text-xs font-medium text-slate-600">Authorized By:</p>
              {signatureImageUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={signatureImageUrl}
                  alt="Authorized signature"
                  className="mt-2 h-12 max-w-[180px] object-contain"
                />
              ) : (
                <span
                  className="mt-2 mb-1 inline-block h-0 w-[180px] border-b border-solid border-[#0f2744]"
                  aria-hidden="true"
                />
              )}
              <p className="mt-2 text-sm font-bold text-[#0f2744]">
                {receipt.authorized_by_name?.trim()}
              </p>
              {receipt.authorized_by_title?.trim() ? (
                <p className="text-sm text-slate-700">{receipt.authorized_by_title.trim()}</p>
              ) : null}
            </section>
          ) : null}
        </div>
      </div>
    </div>
  );
}
