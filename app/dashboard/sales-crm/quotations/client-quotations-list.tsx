"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { getStripedRowClassName } from "@/app/dashboard/finance/register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "@/app/dashboard/scrollable-table";
import FilteredListCount from "@/app/dashboard/filtered-list-count";
import {
  formatInvoiceDate,
  formatInvoiceMoney,
  formatQuotationDocumentType,
  formatQuotationStatus,
  formatQuotationType,
  normalizeClientQuotationListRow,
  resolveConvertedInvoiceLink,
  type ClientQuotationListRow,
} from "@/utils/client-quotations-types";

type ClientQuotationsListProps = {
  initialQuotations: ClientQuotationListRow[];
  fetchError: string | null;
};

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButtonClassName =
  "rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

const traceabilityBadgeClassName =
  "inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100";

const dangerButtonClassName =
  "rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50";

export default function ClientQuotationsList({
  initialQuotations,
  fetchError,
}: ClientQuotationsListProps) {
  const router = useRouter();
  const [quotations, setQuotations] = useState(
    initialQuotations.map(normalizeClientQuotationListRow),
  );
  const [error, setError] = useState<string | null>(fetchError);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  async function handleDelete(quotation: ClientQuotationListRow) {
    setConfirmingId(null);
    setDeletingId(quotation.id);
    setError(null);

    try {
      const response = await fetch(`/api/client-quotations/${quotation.id}`, {
        method: "DELETE",
      });

      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;

      if (!response.ok) {
        setError(payload?.error ?? "Unable to delete quotation.");
        return;
      }

      setQuotations((current) =>
        current.filter((entry) => entry.id !== quotation.id),
      );
      router.refresh();
    } catch {
      setError("Unable to delete quotation. Check your connection and try again.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-6">
      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <div className="flex justify-end">
        <Link
          href="/dashboard/sales-crm/quotations/new"
          className={primaryButtonClassName}
        >
          New Quotation
        </Link>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <FilteredListCount
          filteredCount={quotations.length}
          totalCount={quotations.length}
          itemSingular="quotation"
          className="mb-4"
        />

        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={scrollableTableThClassName}>Quotation #</th>
                <th className={scrollableTableThClassName}>Document Type</th>
                <th className={scrollableTableThClassName}>Quotation Type</th>
                <th className={scrollableTableThClassName}>Customer</th>
                <th className={scrollableTableThClassName}>Issue Date</th>
                <th className={scrollableTableThClassName}>Valid Until</th>
                <th className={scrollableTableThClassName}>Total Due</th>
                <th className={scrollableTableThClassName}>Status</th>
                <th className={scrollableTableThClassName}>Converted</th>
                <th className={scrollableTableThClassName}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {quotations.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-sm text-slate-500">
                    No quotations yet.
                  </td>
                </tr>
              ) : (
                quotations.map((quotation, index) => {
                  const clientName = Array.isArray(quotation.client)
                    ? quotation.client[0]?.client_name
                    : quotation.client?.client_name;
                  const isConverted = Boolean(quotation.converted_invoice_id);
                  const convertedInvoice = resolveConvertedInvoiceLink(quotation);

                  return (
                    <tr key={quotation.id} className={getStripedRowClassName(index)}>
                      <td className="px-4 py-3 font-medium text-[#0f2744]">
                        {quotation.quotation_number}
                      </td>
                      <td className="px-4 py-3">
                        {formatQuotationDocumentType(quotation.document_type)}
                      </td>
                      <td className="px-4 py-3">
                        {formatQuotationType(quotation.quotation_type)}
                      </td>
                      <td className="px-4 py-3">{clientName ?? quotation.client_id}</td>
                      <td className="px-4 py-3">
                        {formatInvoiceDate(quotation.issue_date)}
                      </td>
                      <td className="px-4 py-3">
                        {formatInvoiceDate(quotation.valid_until)}
                      </td>
                      <td className="px-4 py-3">
                        {formatInvoiceMoney(quotation.total_amount_due)}
                      </td>
                      <td className="px-4 py-3">
                        {formatQuotationStatus(quotation.status)}
                      </td>
                      <td className="px-4 py-3">
                        {convertedInvoice ? (
                          <Link
                            href={`/dashboard/finance/client-invoices/${convertedInvoice.id}`}
                            className={traceabilityBadgeClassName}
                          >
                            Converted → {convertedInvoice.invoice_number}
                          </Link>
                        ) : (
                          <span className="text-sm text-slate-500">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="inline-flex flex-nowrap items-center gap-2">
                          <Link
                            href={`/dashboard/sales-crm/quotations/${quotation.id}`}
                            className={secondaryButtonClassName}
                          >
                            View
                          </Link>
                          {!isConverted ? (
                            <Link
                              href={`/dashboard/sales-crm/quotations/${quotation.id}/edit`}
                              className={secondaryButtonClassName}
                            >
                              Edit
                            </Link>
                          ) : null}
                          {!isConverted ? (
                            confirmingId === quotation.id ? (
                              <span className="inline-flex flex-nowrap items-center gap-2 whitespace-nowrap">
                                <span className="text-sm text-red-700">
                                  Delete {quotation.quotation_number}?
                                </span>
                                <button
                                  type="button"
                                  onClick={() => void handleDelete(quotation)}
                                  className={dangerButtonClassName}
                                >
                                  Yes, delete
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmingId(null)}
                                  className={secondaryButtonClassName}
                                >
                                  Cancel
                                </button>
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  setError(null);
                                  setConfirmingId(quotation.id);
                                }}
                                disabled={deletingId === quotation.id}
                                className={dangerButtonClassName}
                              >
                                {deletingId === quotation.id ? "Deleting…" : "Delete"}
                              </button>
                            )
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </ScrollableTable>
      </section>
    </div>
  );
}
