"use client";

import Link from "next/link";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import {
  formatInvoiceDate,
  formatReceiptMoney,
  normalizeClientReceiptListRow,
  receiptInvoiceSummary,
  type ClientReceiptListRow,
} from "@/utils/client-receipts-types";

type MyReceiptsProps = {
  initialReceipts: ClientReceiptListRow[];
  fetchError: string | null;
};

export default function MyReceipts({
  initialReceipts,
  fetchError,
}: MyReceiptsProps) {
  if (fetchError) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        Failed to load receipts: {fetchError}
      </div>
    );
  }

  const receipts = initialReceipts.map(normalizeClientReceiptListRow);

  if (receipts.length === 0) {
    return (
      <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-600">
        No payment receipts found for your account.
      </div>
    );
  }

  return (
    <ScrollableTable>
      <table className={scrollableTableClassName}>
        <thead className={scrollableTableHeadClassName}>
          <tr>
            <th className={scrollableTableThClassName}>Receipt No</th>
            <th className={scrollableTableThClassName}>Date</th>
            <th className={scrollableTableThClassName}>Amount</th>
            <th className={scrollableTableThClassName}>Invoice</th>
            <th className={scrollableTableThClassName}>Actions</th>
          </tr>
        </thead>
        <tbody>
          {receipts.map((receipt) => {
            const invoice = receiptInvoiceSummary(receipt.invoice);
            const invoiceNumber = invoice?.invoice_number ?? "—";

            return (
              <tr key={receipt.id} className="border-b border-slate-100">
                <td className="px-4 py-3 text-sm font-medium text-[#0f2744]">
                  {receipt.receipt_number}
                </td>
                <td className="px-4 py-3 text-sm text-slate-700">
                  {formatInvoiceDate(receipt.receipt_date)}
                </td>
                <td className="px-4 py-3 text-sm text-slate-700">
                  {formatReceiptMoney(receipt.amount)}
                </td>
                <td className="px-4 py-3 text-sm text-slate-700">{invoiceNumber}</td>
                <td className="px-4 py-3 text-sm">
                  <Link
                    href={`/dashboard/client-portal/receipts/${receipt.id}`}
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
