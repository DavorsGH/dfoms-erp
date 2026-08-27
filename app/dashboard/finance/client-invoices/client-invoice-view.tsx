"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { pdf } from "@react-pdf/renderer";
import { LoadingState } from "@/components/loading-indicator";
import { useTenantBranding } from "@/app/dashboard/tenant-branding-context";
import WorkspaceLogo from "@/app/dashboard/workspace-logo";
import { tableWrapCellClassName } from "@/app/dashboard/scrollable-table";
import type { BillingSettingsHeaderFields } from "@/utils/billing-settings-types";
import {
  CLIENT_INVOICE_PAYMENT_FOOTER,
  CLIENT_INVOICE_PRINT_AREA_ID,
  buildClientInvoiceGroups,
  formatBillingPeriodLabel,
  formatInvoiceDate,
  formatInvoiceMoney,
  hasAuthorizedBySignature,
  normalizeClientInvoiceDetail,
  resolveAuthorizedByDisplayTitle,
  paymentAccountDetailLines,
  resolveBrandingLogoUrl,
  resolveSignatureImageUrl,
  resolveInvoiceCompanyName,
  sumLineItemColumns,
  tenantHeaderContactLines,
  clientInvoiceTaxBasisNote,
  CLIENT_INVOICE_LABOUR_TAX_NOTE,
  type ClientInvoiceDetailPayload,
} from "./client-invoice-display-utils";
import ClientInvoicePdfDocument from "./client-invoice-pdf-document";
import RecordPaymentDialog from "./record-payment-dialog";
import {
  formatReceiptMoney,
} from "@/utils/client-receipts-types";
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

function ClientInvoicePrintStyles() {
  return (
    <style>{`
      @media print {
        body * {
          visibility: hidden;
        }

        #${CLIENT_INVOICE_PRINT_AREA_ID},
        #${CLIENT_INVOICE_PRINT_AREA_ID} * {
          visibility: visible;
        }

        #${CLIENT_INVOICE_PRINT_AREA_ID} {
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
    };
  }, [payload, branding, billingSettings, graTin]);

  const groupedLines = useMemo(
    () => (display ? buildClientInvoiceGroups(display.lineItems) : []),
    [display],
  );

  const lineColumnTotals = useMemo(
    () => (display ? sumLineItemColumns(display.lineItems) : null),
    [display],
  );

  const taxBasisNote = useMemo(
    () =>
      display
        ? clientInvoiceTaxBasisNote(display.invoice, display.lineItems)
        : CLIENT_INVOICE_LABOUR_TAX_NOTE,
    [display],
  );

  const billingPeriod = display
    ? formatBillingPeriodLabel(
        display.invoice.billing_period_start,
        display.invoice.billing_period_end,
      )
    : null;

  const companyName = display
    ? resolveInvoiceCompanyName(display.branding, display.billingSettings)
    : "";

  const companyContactLines = display
    ? tenantHeaderContactLines(display.branding, display.billingSettings, display.graTin)
    : [];

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

  const { invoice, paymentAccounts } = display;
  const signatureImageUrl = resolveSignatureImageUrl(display.branding.signatureImageUrl);
  const authorizedByTitle = resolveAuthorizedByDisplayTitle(
    invoice.authorized_by_title,
    display.branding,
  );
  const sourceQuotation = resolveSourceQuotationLink(invoice);
  const sourceContract = resolveSourceContractLink(invoice);
  const canRecordPayment =
    showStaffActions &&
    invoice.status !== "draft" &&
    invoice.status !== "paid" &&
    invoice.status !== "voided";

  return (
    <div className="space-y-4">
      <ClientInvoicePrintStyles />

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
          amountReceived={toNumber(invoice.amount_received ?? 0)}
          paymentMethods={paymentMethods}
          onClose={() => setShowRecordPayment(false)}
          onSuccess={() => {
            setShowRecordPayment(false);
            void loadInvoice();
          }}
        />
      ) : null}

      <div
        id={CLIENT_INVOICE_PRINT_AREA_ID}
        className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm"
      >
        <header className="bg-[#0f2744] px-6 py-6">
          <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
            <div className="flex items-start gap-4">
              <WorkspaceLogo
                workspaceLogoUrl={display.branding.workspaceLogoUrl}
                name={companyName}
                size="md"
                className="ring-2 ring-white/25"
              />
              <div>
                <h3 className="text-lg font-bold text-white">
                  {companyName}
                </h3>
                {companyContactLines.map((line, index) => (
                  <p key={`contact-${index}`} className="mt-1 text-sm text-[#e2e8f0]">
                    {line}
                  </p>
                ))}
              </div>
            </div>
            <div className="rounded-md border-2 border-[#0f2744] bg-[#e8f4f8] p-4 text-left md:min-w-[220px] md:text-right">
              <p className="text-3xl font-bold tracking-wide text-[#c9a227]">INVOICE</p>
              <dl className="mt-3 space-y-1 text-sm text-slate-800">
                <div>
                  <dt className="inline font-semibold text-[#0f2744]">Invoice #: </dt>
                  <dd className="inline text-slate-900">{invoice.invoice_number}</dd>
                </div>
                <div>
                  <dt className="inline font-semibold text-[#0f2744]">Date: </dt>
                  <dd className="inline text-slate-900">
                    {formatInvoiceDate(invoice.invoice_date)}
                  </dd>
                </div>
                <div>
                  <dt className="inline font-semibold text-[#0f2744]">Due Date: </dt>
                  <dd className="inline text-slate-900">
                    {formatInvoiceDate(invoice.due_date)}
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </header>

        <div className="space-y-8 p-8">
        <section className="overflow-hidden rounded-lg border border-[#0f2744]/25">
          <h4 className="bg-[#0f2744] px-4 py-2 text-sm font-semibold uppercase tracking-wide text-white">
            Bill To
          </h4>
          <div className="border-t border-[#0f2744]/10 bg-[#e8f4f8]/50 px-4 py-3">
          <p className="text-sm font-medium text-slate-900">{invoice.bill_to_name}</p>
          {invoice.bill_to_address?.trim() ? (
            <p className="text-sm text-slate-800">{invoice.bill_to_address.trim()}</p>
          ) : null}
          {invoice.bill_to_phone?.trim() ? (
            <p className="text-sm text-slate-800">{invoice.bill_to_phone.trim()}</p>
          ) : null}
          {billingPeriod ? (
            <p className="mt-2 text-sm text-slate-700">Billing period: {billingPeriod}</p>
          ) : null}
          </div>
        </section>

        <section className="space-y-4">
          <h4 className="rounded-t-lg bg-[#0f2744] px-4 py-2 text-sm font-semibold uppercase tracking-wide text-white">
            Line Items
          </h4>
          {groupedLines.length === 0 ? (
            <p className="text-sm text-slate-600">No line items.</p>
          ) : (
            <div className="overflow-x-auto rounded-b-lg border border-t-0 border-[#0f2744]/25">
              <table className="w-full table-fixed text-left text-sm">
                <colgroup>
                  <col className="w-[40%]" />
                  <col className="w-[15%]" />
                  <col className="w-[15%]" />
                  <col className="w-[15%]" />
                  <col className="w-[15%]" />
                </colgroup>
                <thead className="bg-[#0f2744] text-white">
                  <tr>
                    <th className="px-3 py-2 font-semibold">Description</th>
                    <th className="px-3 py-2 text-right font-semibold">Service</th>
                    <th className="px-3 py-2 text-right font-semibold">Material</th>
                    <th className="px-3 py-2 text-right font-semibold">Discount</th>
                    <th className="px-3 py-2 text-right font-semibold">Total Cost</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-200">
                  {(() => {
                    let lineRowIndex = 0;

                    return groupedLines.flatMap((group) => [
                      <tr key={`category-${group.label}`} className="bg-[#d4ecef]">
                        <td
                          colSpan={5}
                          className="px-3 py-2 font-semibold text-[#0f2744]"
                        >
                          {group.label}
                        </td>
                      </tr>,
                      ...group.items.map((line) => {
                        const rowShade =
                          lineRowIndex % 2 === 0 ? "bg-[#faf8f5]" : "bg-white";
                        lineRowIndex += 1;

                        return (
                          <tr key={line.id} className={rowShade}>
                            <td className={`${tableWrapCellClassName} px-3 py-2 text-slate-900`}>{line.description}</td>
                            <td className="px-3 py-2 text-right text-slate-900">
                              {formatInvoiceMoney(line.labour_amount)}
                            </td>
                            <td className="px-3 py-2 text-right text-slate-900">
                              {formatInvoiceMoney(line.material_amount)}
                            </td>
                            <td className="px-3 py-2 text-right text-slate-900">
                              {formatInvoiceMoney(line.discount_amount)}
                            </td>
                            <td className="px-3 py-2 text-right font-medium text-[#0f2744]">
                              {formatInvoiceMoney(line.total_cost)}
                            </td>
                          </tr>
                        );
                      }),
                    ]);
                  })()}
                </tbody>
                {lineColumnTotals ? (
                  <tfoot>
                    <tr className="border-t-2 border-[#0f2744]/30 bg-[#dce4ed] font-bold text-[#0f2744]">
                      <td className="px-3 py-2">Subtotal</td>
                      <td className="px-3 py-2 text-right">
                        {formatInvoiceMoney(lineColumnTotals.labour)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {formatInvoiceMoney(lineColumnTotals.material)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {formatInvoiceMoney(lineColumnTotals.discount)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {formatInvoiceMoney(lineColumnTotals.total_cost)}
                      </td>
                    </tr>
                  </tfoot>
                ) : null}
              </table>
            </div>
          )}
        </section>

        <section className="flex justify-end">
          <dl className="w-full max-w-md space-y-2 text-sm">
            <div className="flex items-center justify-between border-b border-slate-200 py-2">
              <dt className="text-slate-700">Subtotal</dt>
              <dd className="font-semibold text-[#0f2744]">
                {formatInvoiceMoney(invoice.subtotal)}
              </dd>
            </div>
            <div className="flex items-start justify-between border-b border-slate-200 py-2">
              <dt className="text-slate-700">
                VAT/NHIL/GETFund ({invoice.vat_nhil_getfund_rate}%)
                <span className="mt-1 block text-xs text-slate-600">
                  {taxBasisNote}
                </span>
              </dt>
              <dd className="font-semibold text-[#0f2744]">
                {formatInvoiceMoney(invoice.tax_due)}
              </dd>
            </div>
            <div className="flex items-start justify-between border-b border-slate-200 py-2">
              <dt className="text-slate-700">
                WHT ({invoice.wht_rate}%)
                <span className="mt-1 block text-xs text-slate-600">
                  {taxBasisNote}
                </span>
                <span className="mt-1 block text-xs text-slate-600">
                  For your records — not deducted from total
                </span>
              </dt>
              <dd className="font-semibold text-slate-800">
                {formatInvoiceMoney(invoice.wht_amount)}
              </dd>
            </div>
            <div className="flex items-center justify-between rounded-md bg-[#0f2744] px-4 py-3">
              <dt className="font-semibold text-white">Total Amount Due</dt>
              <dd className="text-lg font-bold text-[#c9a227]">
                {formatInvoiceMoney(invoice.total_amount_due)}
              </dd>
            </div>
          </dl>
        </section>

        {paymentAccounts.length > 0 ? (
          <section className="overflow-hidden rounded-lg border border-[#0f2744]/25">
            <h4 className="bg-[#0f2744] px-4 py-2 text-sm font-semibold uppercase tracking-wide text-white">
              Payment Details
            </h4>
            <div className="space-y-4 border-t border-[#0f2744]/10 bg-[#e8f4f8]/50 p-4">
              {paymentAccounts.map((account) => {
                const details = paymentAccountDetailLines(account);
                if (details.length === 0) {
                  return null;
                }

                return (
                  <div
                    key={account.id}
                    className="rounded-md border border-[#0f2744]/20 bg-white px-4 py-3"
                  >
                    <dl className="space-y-1 text-sm">
                      {details.map((detail) => (
                        <div key={`${account.id}-${detail.label}`}>
                          <dt className="inline font-medium text-slate-800">
                            {detail.label}:{" "}
                          </dt>
                          <dd className="inline text-slate-900">{detail.value}</dd>
                        </div>
                      ))}
                    </dl>
                  </div>
                );
              })}
            </div>
          </section>
        ) : null}

        {invoice.notes?.trim() ? (
          <section className="overflow-hidden rounded-lg border border-[#0f2744]/25">
            <h4 className="bg-[#0f2744] px-4 py-2 text-sm font-semibold uppercase tracking-wide text-white">
              Notes
            </h4>
            <p className="border-t border-[#0f2744]/10 bg-[#e8f4f8]/50 px-4 py-3 text-sm text-slate-800">
              {invoice.notes.trim()}
            </p>
          </section>
        ) : null}

        <footer className="rounded-lg border-2 border-[#0f2744]/25 bg-[#e8f4f8] px-4 py-3 text-sm text-slate-800">
          {CLIENT_INVOICE_PAYMENT_FOOTER}
        </footer>

        {hasAuthorizedBySignature(invoice) ? (
          <section className="pt-4 text-left">
            <p className="text-xs font-medium text-slate-600">Authorized By:</p>
            {signatureImageUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={signatureImageUrl}
                alt="Authorized signature"
                className="mt-2 h-12 max-w-[180px] object-contain"
              />
            ) : null}
            <p className="mt-1 text-sm font-bold text-[#0f2744]">
              {invoice.authorized_by_name?.trim()}
            </p>
            <div className="mt-2 flex flex-wrap items-end text-sm text-slate-700">
              {authorizedByTitle ? (
                <>
                  <span>{authorizedByTitle},</span>
                  {!signatureImageUrl ? (
                    <>
                      <span className="ml-3">Signature:</span>
                      <span
                        className="ml-1.5 mb-1 inline-block h-0 w-[180px] min-w-[180px] shrink-0 border-b border-solid border-[#0f2744]"
                        aria-hidden="true"
                      />
                    </>
                  ) : null}
                </>
              ) : !signatureImageUrl ? (
                <>
                  <span>Signature:</span>
                  <span
                    className="ml-1.5 mb-1 inline-block h-0 w-[180px] min-w-[180px] shrink-0 border-b border-solid border-[#0f2744]"
                    aria-hidden="true"
                  />
                </>
              ) : null}
            </div>
          </section>
        ) : null}
        </div>
      </div>
    </div>
  );
}
