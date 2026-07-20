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
import {
  formatInvoiceDate,
  formatInvoiceMoney,
  formatInvoiceStatus,
  normalizeClientInvoiceListRow,
  type ClientInvoiceListRow,
} from "@/utils/client-invoices-types";

type ClientInvoicesListProps = {
  initialInvoices: ClientInvoiceListRow[];
  fetchError: string | null;
};

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButtonClassName =
  "rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

const dangerButtonClassName =
  "rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50";

export default function ClientInvoicesList({
  initialInvoices,
  fetchError,
}: ClientInvoicesListProps) {
  const router = useRouter();
  const [invoices, setInvoices] = useState(
    initialInvoices.map(normalizeClientInvoiceListRow),
  );
  const [error, setError] = useState<string | null>(fetchError);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  async function handleDelete(invoice: ClientInvoiceListRow) {
    const confirmed = window.confirm(
      `Delete invoice ${invoice.invoice_number}? This cannot be undone.`,
    );

    if (!confirmed) {
      return;
    }

    setDeletingId(invoice.id);
    setError(null);

    const response = await fetch(`/api/client-invoices/${invoice.id}`, {
      method: "DELETE",
    });

    const payload = (await response.json().catch(() => null)) as
      | { error?: string }
      | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to delete invoice.");
      setDeletingId(null);
      return;
    }

    setInvoices((current) => current.filter((entry) => entry.id !== invoice.id));
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

      <div className="flex justify-end">
        <Link href="/dashboard/finance/client-invoices/new" className={primaryButtonClassName}>
          New Client Invoice
        </Link>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={scrollableTableThClassName}>Invoice #</th>
                <th className={scrollableTableThClassName}>Client</th>
                <th className={scrollableTableThClassName}>Bill To</th>
                <th className={scrollableTableThClassName}>Date</th>
                <th className={scrollableTableThClassName}>Due</th>
                <th className={scrollableTableThClassName}>Total Due</th>
                <th className={scrollableTableThClassName}>Status</th>
                <th className={scrollableTableThClassName}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {invoices.length === 0 ? (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-slate-500">
                    No client invoices yet.
                  </td>
                </tr>
              ) : (
                invoices.map((invoice, index) => {
                  const clientName = Array.isArray(invoice.client)
                    ? invoice.client[0]?.client_name
                    : invoice.client?.client_name;

                  return (
                    <tr key={invoice.id} className={getStripedRowClassName(index)}>
                      <td className="px-4 py-3 font-medium text-[#0f2744]">
                        {invoice.invoice_number}
                      </td>
                      <td className="px-4 py-3">{clientName ?? invoice.client_id}</td>
                      <td className="px-4 py-3">{invoice.bill_to_name}</td>
                      <td className="px-4 py-3">{formatInvoiceDate(invoice.invoice_date)}</td>
                      <td className="px-4 py-3">{formatInvoiceDate(invoice.due_date)}</td>
                      <td className="px-4 py-3">
                        {formatInvoiceMoney(invoice.total_amount_due)}
                      </td>
                      <td className="px-4 py-3">{formatInvoiceStatus(invoice.status)}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap gap-2">
                          <Link
                            href={`/dashboard/finance/client-invoices/${invoice.id}`}
                            className={secondaryButtonClassName}
                          >
                            View
                          </Link>
                          <Link
                            href={`/dashboard/finance/client-invoices/${invoice.id}/edit`}
                            className={secondaryButtonClassName}
                          >
                            Edit
                          </Link>
                          <button
                            type="button"
                            onClick={() => handleDelete(invoice)}
                            disabled={deletingId === invoice.id}
                            className={dangerButtonClassName}
                          >
                            {deletingId === invoice.id ? "Deleting…" : "Delete"}
                          </button>
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
