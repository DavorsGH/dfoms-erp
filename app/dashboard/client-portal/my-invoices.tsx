"use client";

import Link from "next/link";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import {
  formatDate,
  formatGHS,
} from "../finance/income-register-utils";
import type { IncomeRegisterEntry } from "../finance/income-register-utils";

type InvoiceReceiptSummary = {
  id: string;
  receipt_number: string;
};

type MyInvoicesProps = {
  initialEntries: IncomeRegisterEntry[];
  receiptsByInvoiceId: Record<string, InvoiceReceiptSummary[]>;
  fetchError: string | null;
};

export default function MyInvoices({
  initialEntries,
  receiptsByInvoiceId,
  fetchError,
}: MyInvoicesProps) {
  if (fetchError) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        Failed to load invoices: {fetchError}
      </div>
    );
  }

  if (initialEntries.length === 0) {
    return (
      <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-600">
        No service invoices found for your account.
      </div>
    );
  }

  return (
    <ScrollableTable>
      <table className={scrollableTableClassName}>
        <thead className={scrollableTableHeadClassName}>
          <tr>
            <th className={scrollableTableThClassName}>Invoice No</th>
            <th className={scrollableTableThClassName}>Date</th>
            <th className={scrollableTableThClassName}>Amount</th>
            <th className={scrollableTableThClassName}>Received</th>
            <th className={scrollableTableThClassName}>Outstanding</th>
            <th className={scrollableTableThClassName}>Status</th>
            <th className={scrollableTableThClassName}>Due Date</th>
            <th className={scrollableTableThClassName}>Receipts</th>
            <th className={scrollableTableThClassName}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {initialEntries.map((entry) => {
            const linkedReceipts = entry.client_invoice_id
              ? receiptsByInvoiceId[entry.client_invoice_id] ?? []
              : [];
            const detailHref = entry.client_invoice_id
              ? `/dashboard/client-portal/invoices/${entry.client_invoice_id}`
              : null;

            return (
            <tr key={entry.id} className="border-b border-slate-100">
              <td className="px-4 py-3 text-sm font-medium text-[#0f2744]">
                {detailHref ? (
                  <Link href={detailHref} className="hover:underline">
                    {entry.invoice_no}
                  </Link>
                ) : (
                  entry.invoice_no
                )}
              </td>
              <td className="px-4 py-3 text-sm text-slate-700">
                {formatDate(entry.date)}
              </td>
              <td className="px-4 py-3 text-sm text-slate-700">
                {formatGHS(entry.amount)}
              </td>
              <td className="px-4 py-3 text-sm text-slate-700">
                {formatGHS(entry.amount_received)}
              </td>
              <td className="px-4 py-3 text-sm text-slate-700">
                {formatGHS(entry.outstanding_balance ?? 0)}
              </td>
              <td className="px-4 py-3 text-sm text-slate-700">
                {entry.payment_status}
              </td>
              <td className="px-4 py-3 text-sm text-slate-700">
                {formatDate(entry.due_date)}
              </td>
              <td className="px-4 py-3 text-sm text-slate-700">
                {linkedReceipts.length === 0 ? (
                  <span className="text-slate-400">—</span>
                ) : (
                  <span className="flex flex-col gap-1">
                    {linkedReceipts.map((receipt) => (
                      <Link
                        key={receipt.id}
                        href={`/dashboard/client-portal/receipts/${receipt.id}`}
                        className="font-medium text-[#0f2744] hover:underline"
                      >
                        {receipt.receipt_number}
                      </Link>
                    ))}
                  </span>
                )}
              </td>
              <td className="px-4 py-3 text-sm">
                {detailHref ? (
                  <Link
                    href={detailHref}
                    className="font-medium text-[#0f2744] hover:underline"
                  >
                    View
                  </Link>
                ) : (
                  <span className="text-slate-400">—</span>
                )}
              </td>
            </tr>
            );
          })}
        </tbody>
      </table>
    </ScrollableTable>
  );
}
