"use client";

import {
  ReportCompanyHeader,
  formatReportCurrency,
  formatReportDate,
} from "../reports/report-ui";
import { formatGHS } from "../finance/income-register-utils";
import DashboardButton from "@/components/dashboard-button";
import type { PosCartLine } from "./pos-utils";
import { POS_PRINT_AREA_ID, lineSubtotal } from "./pos-utils";

export type PosReceiptData = {
  invoiceNo: string;
  saleDate: string;
  /** Stamped checkout business unit for letterhead (null = tenant). */
  businessUnitId?: string | null;
  customerLabel: string;
  paymentMethod: string;
  paymentStatus: string;
  amountReceived: number;
  cartTotal: number;
  lines: PosCartLine[];
  /** Cash-only: physical tender and change (display only, not ledger). */
  amountTendered?: number | null;
  changeDue?: number | null;
  /** Store credit checkout (display only). */
  storeCreditApplied?: number | null;
  storeCreditNoteNumber?: string | null;
  storeCreditRemainingBalance?: number | null;
  /** Subtotal before store credit (same as cart line total). */
  subtotal?: number | null;
  /** Queued offline cash sale — provisional token, not a tax invoice. */
  pendingSync?: boolean;
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
          color: #0f172a;
        }

        #${POS_PRINT_AREA_ID} td,
        #${POS_PRINT_AREA_ID} th {
          color: #0f172a;
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
  onClose,
  onRequestPayment,
  onReturn,
}: {
  receipt: PosReceiptData;
  onPrint: () => void;
  onNewSale?: () => void;
  onClose?: () => void;
  onRequestPayment?: () => void;
  onReturn?: () => void;
}) {
  return (
    <div className="space-y-4">
      <PosReceiptPrintStyles />

      <div className="no-print flex flex-wrap gap-3">
        <DashboardButton type="button" variant="secondary" onClick={onPrint}>
          Print Receipt
        </DashboardButton>
        {onRequestPayment ? (
          <DashboardButton
            type="button"
            variant="paymentLink"
            onClick={onRequestPayment}
          >
            Request Payment
          </DashboardButton>
        ) : null}
        {onReturn && !receipt.pendingSync ? (
          <DashboardButton
            type="button"
            variant="warning"
            onClick={onReturn}
            icon={
              <svg
                aria-hidden
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
              >
                <path d="M9 14 4 9l5-5" />
                <path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11" />
              </svg>
            }
          >
            Return
          </DashboardButton>
        ) : null}
        <DashboardButton
          type="button"
          variant="secondary"
          onClick={onClose ?? onNewSale}
        >
          {onClose ? "Close" : "New Sale"}
        </DashboardButton>
      </div>

      <div
        id={POS_PRINT_AREA_ID}
        className="rounded-lg border border-slate-200 bg-white p-6 text-slate-900 shadow-sm"
      >
        <ReportCompanyHeader
          title="Point of Sale Receipt"
          periodLabel={formatReportDate(receipt.saleDate)}
          brandingSource="stamp"
          stampedBusinessUnitId={receipt.businessUnitId ?? null}
        />

        {receipt.pendingSync ? (
          <p className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950">
            Pending sync — not a tax invoice
          </p>
        ) : null}

        <div className="mb-6 grid gap-2 text-sm text-slate-700 md:grid-cols-2">
          <p>
            <span className="font-medium text-slate-900">Receipt No.:</span>{" "}
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
              <tr key={line.id} className="text-slate-900">
                <td className="px-4 py-3 text-slate-900">
                  {line.productCode} — {line.productName}
                </td>
                <td className="px-4 py-3 text-right text-slate-900">
                  {line.quantity.toLocaleString("en-GB", {
                    minimumFractionDigits: 0,
                    maximumFractionDigits: 4,
                  })}{" "}
                  {line.unitOfMeasure}
                </td>
                <td className="px-4 py-3 text-right text-slate-900">
                  {formatReportCurrency(line.unitPrice)}
                </td>
                <td className="px-4 py-3 text-right text-slate-900">
                  {formatReportCurrency(lineSubtotal(line))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="mt-6 space-y-2 border-t border-slate-200 pt-4 text-sm">
          <div className="flex justify-between">
            <span className="font-medium text-slate-700">Subtotal</span>
            <span className="font-semibold text-[#0f2744]">
              {formatGHS(receipt.subtotal ?? receipt.cartTotal)}
            </span>
          </div>
          {(receipt.storeCreditApplied ?? 0) > 0 ? (
            <div className="flex justify-between">
              <span className="font-medium text-slate-700">
                Store credit applied
                {receipt.storeCreditNoteNumber
                  ? ` (${receipt.storeCreditNoteNumber})`
                  : ""}
              </span>
              <span className="font-semibold text-[#0f2744]">
                {formatGHS(receipt.storeCreditApplied ?? 0)}
              </span>
            </div>
          ) : null}
          <div className="flex justify-between">
            <span className="font-medium text-slate-700">Amount received</span>
            <span className="font-semibold text-[#0f2744]">
              {formatGHS(receipt.amountReceived)}
            </span>
          </div>
          {receipt.amountTendered != null &&
          (receipt.amountTendered > 0 ||
            (receipt.storeCreditApplied ?? 0) > 0) ? (
            <>
              <div className="flex justify-between">
                <span className="font-medium text-slate-700">Cash tendered</span>
                <span className="font-semibold text-[#0f2744]">
                  {formatGHS(receipt.amountTendered)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="font-medium text-slate-700">Change</span>
                <span className="font-semibold text-emerald-800">
                  {formatGHS(receipt.changeDue ?? 0)}
                </span>
              </div>
            </>
          ) : receipt.paymentMethod === "Cash" &&
            receipt.amountTendered != null &&
            receipt.amountTendered > 0 ? (
            <>
              <div className="flex justify-between">
                <span className="font-medium text-slate-700">Amount Tendered</span>
                <span className="font-semibold text-[#0f2744]">
                  {formatGHS(receipt.amountTendered)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="font-medium text-slate-700">Change Due</span>
                <span className="font-semibold text-emerald-800">
                  {formatGHS(receipt.changeDue ?? 0)}
                </span>
              </div>
            </>
          ) : null}
          {receipt.storeCreditNoteNumber &&
          receipt.storeCreditRemainingBalance != null ? (
            <div className="flex justify-between border-t border-slate-100 pt-2">
              <span className="font-medium text-slate-700">
                Credit remaining on {receipt.storeCreditNoteNumber}
              </span>
              <span className="font-semibold text-[#0f2744]">
                {formatGHS(receipt.storeCreditRemainingBalance)}
              </span>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
