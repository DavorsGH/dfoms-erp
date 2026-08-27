"use client";

import Link from "next/link";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import {
  formatInvoiceDate,
  formatInvoiceMoney,
  formatQuotationDocumentType,
  formatQuotationStatus,
  formatQuotationType,
  normalizeClientQuotationPortalListRow,
  resolvePortalQuotationExpiryDisplay,
  resolveRaisedContractLink,
  type ClientQuotationPortalListRow,
} from "@/utils/client-quotations-types";

type MyQuotationsProps = {
  initialQuotations: ClientQuotationPortalListRow[];
  fetchError: string | null;
};

export default function MyQuotations({
  initialQuotations,
  fetchError,
}: MyQuotationsProps) {
  if (fetchError) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        Failed to load quotations: {fetchError}
      </div>
    );
  }

  const quotations = initialQuotations.map(normalizeClientQuotationPortalListRow);
  const expiryColumnLabel =
    quotations.some((quotation) => quotation.status === "accepted")
      ? "Accepted / Valid Until"
      : "Valid Until";

  if (quotations.length === 0) {
    return (
      <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-600">
        No quotations found for your account.
      </div>
    );
  }

  return (
    <ScrollableTable>
      <table className={scrollableTableClassName}>
        <thead className={scrollableTableHeadClassName}>
          <tr>
            <th className={scrollableTableThClassName}>Quotation No</th>
            <th className={scrollableTableThClassName}>Type</th>
            <th className={scrollableTableThClassName}>Document</th>
            <th className={scrollableTableThClassName}>Issue Date</th>
            <th className={scrollableTableThClassName}>{expiryColumnLabel}</th>
            <th className={scrollableTableThClassName}>Total</th>
            <th className={scrollableTableThClassName}>Status</th>
            <th className={scrollableTableThClassName}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {quotations.map((quotation) => {
            const expiryDisplay = resolvePortalQuotationExpiryDisplay(quotation);
            const linkedContract = resolveRaisedContractLink(quotation);

            return (
            <tr key={quotation.id} className="border-b border-slate-100">
              <td className="px-4 py-3 text-sm font-medium text-[#0f2744]">
                {quotation.quotation_number}
              </td>
              <td className="px-4 py-3 text-sm text-slate-700">
                {formatQuotationType(quotation.quotation_type)}
              </td>
              <td className="px-4 py-3 text-sm text-slate-700">
                {formatQuotationDocumentType(quotation.document_type)}
              </td>
              <td className="px-4 py-3 text-sm text-slate-700">
                {formatInvoiceDate(quotation.issue_date)}
              </td>
              <td className="px-4 py-3 text-sm text-slate-700">
                {expiryDisplay.metaValue}
              </td>
              <td className="px-4 py-3 text-sm text-slate-700">
                {formatInvoiceMoney(quotation.total_amount_due)}
              </td>
              <td className="px-4 py-3 text-sm text-slate-700">
                <div className="space-y-1">
                  <p>{formatQuotationStatus(quotation.status)}</p>
                  {linkedContract ? (
                    <Link
                      href="/dashboard/client-portal/contract"
                      className="inline-flex text-xs font-medium text-violet-800 hover:underline"
                    >
                      Linked to Service Contract {linkedContract.contract_number} — View My
                      Contract
                    </Link>
                  ) : null}
                </div>
              </td>
              <td className="px-4 py-3 text-sm">
                <Link
                  href={`/dashboard/client-portal/quotations/${quotation.id}`}
                  className="font-medium text-[#0f2744] hover:underline"
                >
                  View
                </Link>
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </ScrollableTable>
  );
}
