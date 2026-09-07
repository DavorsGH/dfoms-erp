"use client";

import WorkspaceLogo from "@/app/dashboard/workspace-logo";
import { tableWrapCellClassName } from "@/app/dashboard/scrollable-table";
import {
  CLIENT_INVOICE_PAYMENT_FOOTER,
  buildClientInvoiceGroups,
  clientInvoiceTaxBasisNote,
  formatBillingPeriodLabel,
  formatInvoiceDate,
  formatInvoiceMoney,
  hasAuthorizedBySignature,
  paymentAccountDetailLines,
  resolveAuthorizedByDisplayTitle,
  resolveDocumentLogoUrl,
  resolveInvoiceCompanyName,
  resolveSignatureImageUrl,
  sumLineItemColumns,
  tenantHeaderContactLines,
  type ClientInvoiceDisplayProps,
} from "./client-invoice-display-utils";

type ClientInvoicePrintLayoutProps = {
  display: ClientInvoiceDisplayProps;
  printAreaId: string;
  className?: string;
};

export default function ClientInvoicePrintLayout({
  display,
  printAreaId,
  className = "overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm",
}: ClientInvoicePrintLayoutProps) {
  const { invoice, lineItems, paymentAccounts, branding, billingSettings, graTin, businessUnitContact } =
    display;
  const groupedLines = buildClientInvoiceGroups(lineItems);
  const lineColumnTotals = sumLineItemColumns(lineItems);
  const taxBasisNote = clientInvoiceTaxBasisNote(invoice, lineItems);
  const billingPeriod = formatBillingPeriodLabel(
    invoice.billing_period_start,
    invoice.billing_period_end,
  );
  const companyName = resolveInvoiceCompanyName(
    branding,
    billingSettings,
    businessUnitContact,
  );
  const companyContactLines = tenantHeaderContactLines(
    branding,
    billingSettings,
    graTin,
    businessUnitContact,
  );
  const documentLogoUrl = resolveDocumentLogoUrl(branding, businessUnitContact);
  const signatureImageUrl = resolveSignatureImageUrl(branding.signatureImageUrl);
  const authorizedByTitle = resolveAuthorizedByDisplayTitle(
    invoice.authorized_by_title,
    branding,
  );

  return (
    <div id={printAreaId} className={className}>
      <header className="bg-[#0f2744] px-6 py-6">
        <div className="flex flex-col gap-6 md:flex-row md:items-start md:justify-between">
          <div className="flex items-start gap-4">
            <WorkspaceLogo
              workspaceLogoUrl={documentLogoUrl}
              name={companyName}
              size="md"
              className="ring-2 ring-white/25"
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
                            <td className={`${tableWrapCellClassName} px-3 py-2 text-slate-900`}>
                              {line.description}
                            </td>
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
                <span className="mt-1 block text-xs text-slate-600">{taxBasisNote}</span>
              </dt>
              <dd className="font-semibold text-[#0f2744]">
                {formatInvoiceMoney(invoice.tax_due)}
              </dd>
            </div>
            <div className="flex items-start justify-between border-b border-slate-200 py-2">
              <dt className="text-slate-700">
                WHT ({invoice.wht_rate}%)
                <span className="mt-1 block text-xs text-slate-600">{taxBasisNote}</span>
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
  );
}
