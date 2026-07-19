"use client";

import {
  ReportCompanyHeader,
  formatReportCurrency,
  formatReportDate,
} from "../reports/report-ui";
import { formatGHS } from "../finance/income-register-utils";
import type { PosCartLine } from "./pos-utils";
import { POS_PRINT_AREA_ID, lineSubtotal } from "./pos-utils";

export type PosReceiptData = {
  invoiceNo: string;
  saleDate: string;
  customerLabel: string;
  paymentMethod: string;
  paymentStatus: string;
  amountReceived: number;
  cartTotal: number;
  lines: PosCartLine[];
};

export function PosReceiptPrintStyles() {
  return (
    <style>{`
      @media print {
        body * {
          visibility: hidden;
        }

        #${POS_PRINT_AREA_ID},
        #${POS_PRINT_AREA_ID} * {
          visibility: visible;
        }

        #${POS_PRINT_AREA_ID} {
          position: absolute;
          inset: 0;
          width: 100%;
          padding: 24px;
          background: white;
        }

        .no-print {
          display: none !important;
        }
      }
    `}</style>
  );
}

export function PosReceiptPanel({
  receipt,
  onPrint,
  onNewSale,
}: {
  receipt: PosReceiptData;
  onPrint: () => void;
  onNewSale: () => void;
}) {
  return (
    <div className="space-y-4">
      <PosReceiptPrintStyles />

      <div className="no-print flex flex-wrap gap-3">
        <button
          type="button"
          onClick={onPrint}
          className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c]"
        >
          Print Receipt
        </button>
        <button
          type="button"
          onClick={onNewSale}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
        >
          New Sale
        </button>
      </div>

      <div
        id={POS_PRINT_AREA_ID}
        className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
      >
        <ReportCompanyHeader
          title="Point of Sale Receipt"
          periodLabel={formatReportDate(receipt.saleDate)}
        />

        <div className="mb-6 grid gap-2 text-sm text-slate-700 md:grid-cols-2">
          <p>
            <span className="font-medium text-slate-900">Invoice No.:</span>{" "}
            {receipt.invoiceNo}
          </p>
          <p>
            <span className="font-medium text-slate-900">Customer:</span>{" "}
            {receipt.customerLabel}
          </p>
          <p>
            <span className="font-medium text-slate-900">Payment method:</span>{" "}
            {receipt.paymentMethod}
          </p>
          <p>
            <span className="font-medium text-slate-900">Payment status:</span>{" "}
            {receipt.paymentStatus}
          </p>
        </div>

        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-3 text-left font-semibold text-slate-700">
                Product
              </th>
              <th className="px-4 py-3 text-right font-semibold text-slate-700">
                Qty
              </th>
              <th className="px-4 py-3 text-right font-semibold text-slate-700">
                Unit Price
              </th>
              <th className="px-4 py-3 text-right font-semibold text-slate-700">
                Subtotal
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {receipt.lines.map((line) => (
              <tr key={line.id}>
                <td className="px-4 py-3">
                  {line.productCode} — {line.productName}
                </td>
                <td className="px-4 py-3 text-right">
                  {line.quantity.toLocaleString("en-GB", {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 4,
                  })}{" "}
                  {line.unitOfMeasure}
                </td>
                <td className="px-4 py-3 text-right">
                  {formatReportCurrency(line.unitPrice)}
                </td>
                <td className="px-4 py-3 text-right">
                  {formatReportCurrency(lineSubtotal(line))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-6 space-y-2 border-t border-slate-200 pt-4 text-sm">
          <div className="flex justify-between">
            <span className="font-medium text-slate-700">Cart total</span>
            <span className="font-semibold text-[#0f2744]">
              {formatGHS(receipt.cartTotal)}
            </span>
          </div>
          <div className="flex justify-between">
            <span className="font-medium text-slate-700">Amount received</span>
            <span className="font-semibold text-[#0f2744]">
              {formatGHS(receipt.amountReceived)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
