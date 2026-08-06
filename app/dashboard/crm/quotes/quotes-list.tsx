"use client";

import Link from "next/link";
import { useState } from "react";
import { getStripedRowClassName } from "@/app/dashboard/finance/register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "@/app/dashboard/scrollable-table";
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

export default function QuotesList({
  initialQuotes,
  fetchError,
}: QuotesListProps) {
  const quotes = initialQuotes.map(normalizeSalesQuoteListRow);
  const [error] = useState<string | null>(fetchError);

  return (
    <div className="space-y-6">
      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <div className="flex justify-end">
        <Link href="/dashboard/crm/quotes/new" className={primaryButtonClassName}>
          New Quote
        </Link>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
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
                    No quotes yet.
                  </td>
                </tr>
              ) : (
                quotes.map((quote, index) => {
                  const clientName = Array.isArray(quote.client)
                    ? quote.client[0]?.client_name
                    : quote.client?.client_name;

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
