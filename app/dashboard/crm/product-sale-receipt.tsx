"use client";

import {
  ReportCompanyHeader,
  formatReportCurrency,
  formatReportDate,
} from "../reports/report-ui";
import {
  formatGHS,
  getIncomeCustomerDisplayName,
  getProductSaleProductLabel,
  type ProductSaleEntry,
} from "./product-sales-utils";
import type { ClientEntry } from "../operations/clients-utils";

export const PRODUCT_SALE_RECEIPT_PRINT_AREA_ID = "product-sale-receipt-print-area";

export type ProductSaleReceiptData = {
  date: string;
  invoiceNo: string;
  customerLabel: string;
  productLabel: string;
  quantityLabel: string;
  unitPrice: number;
  amount: number;
  amountReceived: number;
  paymentStatus: string;
  saleStatus: string;
};

export function buildProductSaleReceiptData(
  entry: ProductSaleEntry,
  clients: ClientEntry[] = [],
): ProductSaleReceiptData {
  const quantity = entry.sale_quantity ?? 0;
  const unit = entry.product?.unit_of_measure ?? "";

  return {
    date: entry.date,
    invoiceNo: entry.invoice_no,
    customerLabel: getIncomeCustomerDisplayName(entry, clients),
    productLabel: getProductSaleProductLabel(entry),
    quantityLabel: `${quantity.toLocaleString("en-GB", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 4,
    })}${unit ? ` ${unit}` : ""}`,
    unitPrice: entry.unit_price ?? 0,
    amount: Number(entry.amount) || 0,
    amountReceived: Number(entry.amount_received) || 0,
    paymentStatus: entry.payment_status,
    saleStatus: entry.sale_status === "voided" ? "Voided" : "Active",
  };
}

export function ProductSaleReceiptPrintStyles() {
  return (
    <style>{`
      @media print {
        body * {
          visibility: hidden;
        }

        #${PRODUCT_SALE_RECEIPT_PRINT_AREA_ID},
        #${PRODUCT_SALE_RECEIPT_PRINT_AREA_ID} * {
          visibility: visible;
        }

        #${PRODUCT_SALE_RECEIPT_PRINT_AREA_ID} {
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

export function ProductSaleReceiptPanel({
  receipt,
  onPrint,
  onClose,
}: {
  receipt: ProductSaleReceiptData;
  onPrint: () => void;
  onClose: () => void;
}) {
  return (
    <div className="space-y-4">
      <ProductSaleReceiptPrintStyles />

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
          onClick={onClose}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
        >
          Close
        </button>
      </div>

      <div
        id={PRODUCT_SALE_RECEIPT_PRINT_AREA_ID}
        className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm"
      >
        <ReportCompanyHeader
          title="Product Sale Receipt"
          periodLabel={formatReportDate(receipt.date)}
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
            <span className="font-medium text-slate-900">Payment status:</span>{" "}
            {receipt.paymentStatus}
          </p>
          <p>
            <span className="font-medium text-slate-900">Sale status:</span>{" "}
            {receipt.saleStatus}
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
                Amount
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            <tr>
              <td className="px-4 py-3">{receipt.productLabel}</td>
              <td className="px-4 py-3 text-right">{receipt.quantityLabel}</td>
              <td className="px-4 py-3 text-right">
                {formatReportCurrency(receipt.unitPrice)}
              </td>
              <td className="px-4 py-3 text-right">
                {formatReportCurrency(receipt.amount)}
              </td>
            </tr>
          </tbody>
        </table>

        <div className="mt-6 space-y-2 border-t border-slate-200 pt-4 text-sm">
          <div className="flex justify-between">
            <span className="font-medium text-slate-700">Sale amount</span>
            <span className="font-semibold text-[#0f2744]">
              {formatGHS(receipt.amount)}
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
