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
import {
  formatQuoteDate,
  formatQuoteMoney,
  formatQuoteStatus,
  formatQuoteType,
  quoteStatusBadgeClassName,
  type QuoteStatus,
  type SalesQuoteHeaderRow,
  type SalesQuoteLineItemRow,
} from "@/utils/sales-quotes-types";

type QuoteViewProps = {
  quote: SalesQuoteHeaderRow;
  lineItems: SalesQuoteLineItemRow[];
  clientName: string;
  fetchError?: string | null;
};

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButtonClassName =
  "rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

export default function QuoteView({
  quote,
  lineItems,
  clientName,
  fetchError = null,
}: QuoteViewProps) {
  const router = useRouter();
  const supabase = createClient();
  const [error, setError] = useState<string | null>(fetchError);
  const [statusUpdating, setStatusUpdating] = useState(false);

  async function handleStatusChange(newStatus: QuoteStatus) {
    setStatusUpdating(true);
    setError(null);

    const { error: rpcError } = await supabase.rpc("set_quote_status", {
      p_quote_id: quote.id,
      p_new_status: newStatus,
    });

    if (rpcError) {
      setError(rpcError.message);
      setStatusUpdating(false);
      return;
    }

    router.refresh();
    setStatusUpdating(false);
  }

  const canSend = quote.status === "draft";
  const canConvert = quote.status === "accepted";

  return (
    <div className="space-y-6">
      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-sm text-slate-600">
            Quote {quote.quote_number} · {formatQuoteType(quote.quote_type)}
          </p>
          <h3 className="mt-1 text-xl font-semibold text-[#0f2744]">
            {quote.bill_to_name}
          </h3>
          <p className="mt-1 text-sm text-slate-600">Customer: {clientName}</p>
          <p className="mt-2">
            <span
              className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${quoteStatusBadgeClassName(quote.status)}`}
            >
              {formatQuoteStatus(quote.status)}
            </span>
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Link href="/dashboard/crm/quotes" className={secondaryButtonClassName}>
            Back to product quotes
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
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Quote Date
            </p>
            <p className="mt-1 text-sm text-slate-900">
              {formatQuoteDate(quote.quote_date)}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Expiry Date
            </p>
            <p className="mt-1 text-sm text-slate-900">
              {formatQuoteDate(quote.expiry_date)}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Subtotal
            </p>
            <p className="mt-1 text-sm text-slate-900">
              {formatQuoteMoney(quote.subtotal)}
            </p>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Total
            </p>
            <p className="mt-1 text-lg font-semibold text-[#0f2744]">
              {formatQuoteMoney(quote.total_amount)}
            </p>
          </div>
        </div>

        {quote.bill_to_address ? (
          <p className="mt-4 text-sm text-slate-600">
            Bill to address: {quote.bill_to_address}
          </p>
        ) : null}

        {quote.notes ? (
          <p className="mt-4 text-sm text-slate-600">Notes: {quote.notes}</p>
        ) : null}

        {quote.converted_invoice_id ? (
          <p className="mt-4 text-sm text-slate-600">
            Converted invoice:{" "}
            <Link
              href={`/dashboard/finance/client-invoices/${quote.converted_invoice_id}`}
              className="font-medium text-[#0f2744] underline-offset-2 hover:underline"
            >
              View invoice
            </Link>
          </p>
        ) : null}
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h4 className="mb-4 text-lg font-semibold text-[#0f2744]">Line Items</h4>
        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                {quote.quote_type === "service" ? (
                  <>
                    <th className={scrollableTableThClassName}>Description</th>
                    <th className={scrollableTableThClassName}>Site</th>
                    <th className={scrollableTableThClassName}>Category</th>
                    <th className={scrollableTableThClassName}>Service Cost (GHS)</th>
                    <th className={scrollableTableThClassName}>Material Cost (GHS)</th>
                    <th className={scrollableTableThClassName}>Discount</th>
                  </>
                ) : (
                  <>
                    <th className={scrollableTableThClassName}>Product</th>
                    <th className={scrollableTableThClassName}>Quantity</th>
                    <th className={scrollableTableThClassName}>Unit Price</th>
                  </>
                )}
                <th className={scrollableTableThClassName}>Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {lineItems.length === 0 ? (
                <tr>
                  <td
                    colSpan={quote.quote_type === "service" ? 7 : 4}
                    className="px-4 py-8 text-center text-sm text-slate-500"
                  >
                    No line items.
                  </td>
                </tr>
              ) : (
                lineItems.map((line, index) => {
                  const product = Array.isArray(line.product)
                    ? line.product[0]
                    : line.product;

                  return (
                  <tr key={line.id} className={getStripedRowClassName(index)}>
                    {quote.quote_type === "service" ? (
                      <>
                        <td className="px-4 py-3">{line.description}</td>
                        <td className="px-4 py-3">{line.site_id ?? "—"}</td>
                        <td className="px-4 py-3">{line.category_label ?? "—"}</td>
                        <td className="px-4 py-3">
                          {formatQuoteMoney(line.labour_amount)}
                        </td>
                        <td className="px-4 py-3">
                          {formatQuoteMoney(line.material_amount)}
                        </td>
                        <td className="px-4 py-3">
                          {formatQuoteMoney(line.discount_amount)}
                        </td>
                      </>
                    ) : (
                      <>
                        <td className="px-4 py-3">
                          {product
                            ? `${product.product_code} — ${product.product_name}`
                            : line.description}
                        </td>
                        <td className="px-4 py-3">{line.quantity ?? "—"}</td>
                        <td className="px-4 py-3">
                          {formatQuoteMoney(line.unit_price)}
                        </td>
                      </>
                    )}
                    <td className="px-4 py-3 font-medium">
                      {formatQuoteMoney(line.total_cost)}
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </ScrollableTable>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h4 className="mb-4 text-lg font-semibold text-[#0f2744]">
          Status Actions
        </h4>
        <div className="flex flex-wrap gap-2">
          {canSend ? (
            <button
              type="button"
              disabled={statusUpdating}
              onClick={() => void handleStatusChange("sent")}
              className={primaryButtonClassName}
            >
              Send
            </button>
          ) : null}

          {quote.status === "sent" ? (
            <>
              <button
                type="button"
                disabled={statusUpdating}
                onClick={() => void handleStatusChange("accepted")}
                className={primaryButtonClassName}
              >
                Mark Accepted
              </button>
              <button
                type="button"
                disabled={statusUpdating}
                onClick={() => void handleStatusChange("rejected")}
                className={secondaryButtonClassName}
              >
                Mark Rejected
              </button>
              <button
                type="button"
                disabled={statusUpdating}
                onClick={() => void handleStatusChange("expired")}
                className={secondaryButtonClassName}
              >
                Mark Expired
              </button>
            </>
          ) : null}

          {canConvert && quote.quote_type === "product" ? (
            <Link
              href={`/dashboard/pos?quoteId=${quote.id}`}
              className={primaryButtonClassName}
            >
              Convert to Sale
            </Link>
          ) : null}

          {canConvert && quote.quote_type === "service" ? (
            <p className="w-full text-sm text-slate-600">
              Legacy service quotes convert to invoices via{" "}
              <Link
                href="/dashboard/sales-crm/quotations"
                className="font-medium text-[#0f2744] underline-offset-2 hover:underline"
              >
                Quotations
              </Link>
              .
            </p>
          ) : null}
        </div>
      </section>
    </div>
  );
}
