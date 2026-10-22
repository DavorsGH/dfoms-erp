"use client";

import Link from "next/link";
import { useEffect } from "react";
import { useAlert } from "@/components/feedback";
import { getStripedRowClassName } from "@/app/dashboard/finance/register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableNoTruncateCellClassName,
  scrollableTableRegisterDateCellClassName,
  scrollableTableThClassName,
} from "@/app/dashboard/scrollable-table";
import {
  formatInvoiceDate,
  formatReceiptMoney,
  normalizeClientReceiptListRow,
  receiptInvoiceSummary,
  type ClientReceiptListRow,
} from "@/utils/client-receipts-types";

type ClientReceiptsListProps = {
  initialReceipts: ClientReceiptListRow[];
  fetchError: string | null;
};

const secondaryButtonClassName =
  "rounded-md border border-[#0f2744] px-3 py-1.5 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50";

export default function ClientReceiptsList({
  initialReceipts,
  fetchError,
}: ClientReceiptsListProps) {
  const { alertError } = useAlert();
  const receipts = initialReceipts.map(normalizeClientReceiptListRow);

  useEffect(() => {
    if (fetchError) {
      void alertError(fetchError, { title: "Could not load receipts" });
    }
  }, [alertError, fetchError]);

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <ScrollableTable>
        <table className={scrollableTableClassName}>
          <thead className={scrollableTableHeadClassName}>
            <tr>
              <th
                className={`${scrollableTableThClassName} ${scrollableTableNoTruncateCellClassName} scrollable-table-register-col-date`}
              >
                Date
              </th>
              <th className={scrollableTableThClassName}>Customer</th>
              <th className={scrollableTableThClassName}>Receipt #</th>
              <th className={scrollableTableThClassName}>Invoice #</th>
              <th className={scrollableTableThClassName}>Amount</th>
              <th className={scrollableTableThClassName}>Method</th>
              <th className={scrollableTableThClassName}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {receipts.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-500">
                  No receipts issued yet.
                </td>
              </tr>
            ) : (
              receipts.map((receipt, index) => {
                const invoice = receiptInvoiceSummary(receipt.invoice);
                const invoiceNumber = invoice?.invoice_number ?? "—";
                const customerName = invoice?.bill_to_name ?? "—";

                return (
                  <tr key={receipt.id} className={getStripedRowClassName(index)}>
                    <td className={scrollableTableRegisterDateCellClassName}>
                      {formatInvoiceDate(receipt.receipt_date)}
                    </td>
                    <td className="px-4 py-3">{customerName}</td>
                    <td className="px-4 py-3 font-medium text-[#0f2744]">
                      {receipt.receipt_number}
                    </td>
                    <td className="px-4 py-3">{invoiceNumber}</td>
                    <td className="px-4 py-3">{formatReceiptMoney(receipt.amount)}</td>
                    <td className="px-4 py-3">{receipt.payment_method ?? "—"}</td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/dashboard/finance/client-receipts/${receipt.id}`}
                        className={secondaryButtonClassName}
                      >
                        View
                      </Link>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </ScrollableTable>
    </section>
  );
}
