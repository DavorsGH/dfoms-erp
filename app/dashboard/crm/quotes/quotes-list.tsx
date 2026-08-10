"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { getStripedRowClassName } from "@/app/dashboard/finance/register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "@/app/dashboard/scrollable-table";
import FilteredListCount from "@/app/dashboard/filtered-list-count";
import {
  formatQuoteDate,
  formatQuoteMoney,
  formatQuoteStatus,
  formatQuoteType,
  normalizeSalesQuoteListRow,
  quoteStatusBadgeClassName,
  type SalesQuoteListRow,
} from "@/utils/sales-quotes-types";

type QuotesListProps = {
  initialQuotes: SalesQuoteListRow[];
  fetchError: string | null;
};

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButtonClassName =
  "rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

const deleteButtonClassName =
  "rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50";

function canDeleteQuote(quote: SalesQuoteListRow): boolean {
  return quote.status !== "converted" && !quote.converted_invoice_id;
}

export default function QuotesList({
  initialQuotes,
  fetchError,
}: QuotesListProps) {
  const router = useRouter();
  const supabase = createClient();
  const quotes = initialQuotes.map(normalizeSalesQuoteListRow);
  const legacyServiceQuotes = quotes.filter((quote) => quote.quote_type === "service");
  const [error, setError] = useState<string | null>(fetchError);
  const [deleteTarget, setDeleteTarget] = useState<SalesQuoteListRow | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleDeleteQuote() {
    if (!deleteTarget) {
      return;
    }

    if (!canDeleteQuote(deleteTarget)) {
      setError(
        "Cannot delete a quote that has been converted to an invoice or sale.",
      );
      setDeleteTarget(null);
      return;
    }

    setDeletingId(deleteTarget.id);
    setError(null);

    const { error: lineDeleteError } = await supabase
      .from("sales_quote_line_items")
      .delete()
      .eq("quote_id", deleteTarget.id);

    if (lineDeleteError) {
      setError(lineDeleteError.message);
      setDeletingId(null);
      return;
    }

    const { error: quoteDeleteError } = await supabase
      .from("sales_quotes")
      .delete()
      .eq("id", deleteTarget.id);

    if (quoteDeleteError) {
      setError(quoteDeleteError.message);
      setDeletingId(null);
      return;
    }

    setDeleteTarget(null);
    setDeletingId(null);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {legacyServiceQuotes.length > 0 ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          You have {legacyServiceQuotes.length} legacy service{" "}
          {legacyServiceQuotes.length === 1 ? "quote" : "quotes"} on this list. New
          service quotations should be created in{" "}
          <Link
            href="/dashboard/sales-crm/quotations"
            className="font-medium text-[#0f2744] underline-offset-2 hover:underline"
          >
            Quotations
          </Link>
          .
        </div>
      ) : null}

      <div className="flex justify-end">
        <Link href="/dashboard/crm/quotes/new" className={primaryButtonClassName}>
          New Product Quote
        </Link>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <FilteredListCount
          filteredCount={quotes.length}
          totalCount={quotes.length}
          itemSingular="quote"
          className="mb-4"
        />

        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={scrollableTableThClassName}>Quote #</th>
                <th className={scrollableTableThClassName}>Customer</th>
                <th className={scrollableTableThClassName}>Type</th>
                <th className={scrollableTableThClassName}>Total</th>
                <th className={scrollableTableThClassName}>Status</th>
                <th className={scrollableTableThClassName}>Expiry</th>
                <th className={scrollableTableThClassName}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {quotes.length === 0 ? (
                <tr>
                  <td
                    colSpan={7}
                    className="px-4 py-8 text-center text-sm text-slate-500"
                  >
                    No product quotes yet.
                  </td>
                </tr>
              ) : (
                quotes.map((quote, index) => {
                  const clientName = Array.isArray(quote.client)
                    ? quote.client[0]?.client_name
                    : quote.client?.client_name;
                  const deleteAllowed = canDeleteQuote(quote);

                  return (
                    <tr key={quote.id} className={getStripedRowClassName(index)}>
                      <td className="px-4 py-3 font-medium text-[#0f2744]">
                        {quote.quote_number}
                      </td>
                      <td className="px-4 py-3">
                        {clientName ?? quote.client_id}
                      </td>
                      <td className="px-4 py-3">
                        {formatQuoteType(quote.quote_type)}
                      </td>
                      <td className="px-4 py-3">
                        {formatQuoteMoney(quote.total_amount)}
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${quoteStatusBadgeClassName(quote.status)}`}
                        >
                          {formatQuoteStatus(quote.status)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {formatQuoteDate(quote.expiry_date)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <Link
                            href={`/dashboard/crm/quotes/${quote.id}`}
                            className={secondaryButtonClassName}
                          >
                            View
                          </Link>
                          {quote.status === "draft" ? (
                            <Link
                              href={`/dashboard/crm/quotes/${quote.id}/edit`}
                              className={secondaryButtonClassName}
                            >
                              Edit
                            </Link>
                          ) : null}
                          {deleteAllowed ? (
                            <button
                              type="button"
                              onClick={() => setDeleteTarget(quote)}
                              disabled={deletingId === quote.id}
                              className={deleteButtonClassName}
                            >
                              {deletingId === quote.id ? "Deleting…" : "Delete"}
                            </button>
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

      {deleteTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-quote-title"
            className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-xl"
          >
            <h3
              id="delete-quote-title"
              className="text-lg font-semibold text-[#0f2744]"
            >
              Delete quote?
            </h3>
            <p className="mt-2 text-sm text-slate-600">
              This will permanently remove quote{" "}
              <span className="font-medium text-slate-800">
                {deleteTarget.quote_number}
              </span>{" "}
              and its line items. Deletion is blocked once a quote has been converted
              to an invoice or sale.
            </p>
            <div className="mt-6 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeleteTarget(null)}
                disabled={Boolean(deletingId)}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleDeleteQuote()}
                disabled={Boolean(deletingId)}
                className="rounded-md bg-red-700 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-red-800 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {deletingId ? "Deleting…" : "Delete"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
