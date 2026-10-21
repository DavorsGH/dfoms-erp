"use client";

import { ReportCompanyHeader } from "../reports/report-ui";
import {
  ReceiptItemBlock,
  ReceiptMoney,
  ReceiptPaymentsList,
  ReceiptPreviewFrame,
  SaleReceiptFooter,
} from "../pos/pos-receipt";
import {
  formatReceiptPaymentMethods,
  incomeFallbackPaymentLine,
  receiptBalanceDue,
  receiptChangeDue,
  receiptDueDate,
  receiptPaymentStanding,
  receiptSaleTimestamp,
  type ReceiptListedPayment,
} from "../pos/receipt-settlement";
import { formatProductSaleStatusForDisplay } from "../finance/income-register-utils";
import {
  getIncomeCustomerDisplayName,
  getProductSaleProductLabel,
  type ProductSaleEntry,
} from "./product-sales-utils";
import type { ClientEntry } from "../operations/clients-utils";
import { useTenantDeviceSettings } from "@/hooks/use-tenant-device-settings";
import {
  formatSaleDateTime,
  receiptPrintCss,
} from "@/utils/device-print-layout";
import type { ReceiptPaper } from "@/utils/tenant-device-settings";

export const PRODUCT_SALE_RECEIPT_PRINT_AREA_ID = "product-sale-receipt-print-area";

export type ProductSaleReceiptData = {
  date: string;
  invoiceNo: string;
  customerLabel: string;
  productCode: string;
  productName: string;
  productLabel: string;
  quantityLabel: string;
  unitPrice: number;
  amount: number;
  amountReceived: number;
  paymentMethod: string;
  paymentStatus: string;
  dueDate: string | null;
  saleStatus: string;
  isCancelled: boolean;
  /** Stamped income_register.business_unit_id for letterhead (null = tenant). */
  businessUnitId: string | null;
  paymentLines?: ReceiptListedPayment[];
};

export function buildProductSaleReceiptData(
  entry: ProductSaleEntry,
  clients: ClientEntry[] = [],
): ProductSaleReceiptData {
  const quantity = entry.sale_quantity ?? 0;
  const unit = entry.product?.unit_of_measure ?? "";

  return {
    date: receiptSaleTimestamp([entry]) || entry.date,
    invoiceNo: entry.invoice_no,
    customerLabel: getIncomeCustomerDisplayName(entry, clients),
    productCode: entry.product?.product_code?.trim() || "—",
    productName: entry.product?.product_name?.trim() || "—",
    productLabel: getProductSaleProductLabel(entry),
    quantityLabel: `${quantity.toLocaleString("en-GB", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 4,
    })}${unit ? ` ${unit}` : ""}`,
    unitPrice: entry.unit_price ?? 0,
    amount: Number(entry.amount) || 0,
    amountReceived: Number(entry.amount_received) || 0,
    paymentMethod: formatReceiptPaymentMethods([entry]),
    paymentStatus: receiptPaymentStanding(
      Number(entry.amount) || 0,
      Number(entry.amount_received) || 0,
    ),
    dueDate: receiptDueDate([entry]),
    saleStatus: formatProductSaleStatusForDisplay(entry.sale_status),
    isCancelled: entry.sale_status === "voided",
    businessUnitId: entry.business_unit_id?.trim() || null,
    paymentLines: [],
  };
}

export function withReceiptPaymentLines(
  receipt: ProductSaleReceiptData,
  recorded: ReceiptListedPayment[],
  notes?: string | null,
): ProductSaleReceiptData {
  if (recorded.length > 0) {
    return { ...receipt, paymentLines: recorded };
  }
  const fallback = incomeFallbackPaymentLine({
    date: receipt.date,
    amount: receipt.amountReceived,
    notes,
    paymentMethod: receipt.paymentMethod,
  });
  return { ...receipt, paymentLines: fallback ? [fallback] : [] };
}

export function ProductSaleReceiptPrintStyles({
  paper,
}: {
  paper: ReceiptPaper;
}) {
  return (
    <style>{receiptPrintCss(paper, PRODUCT_SALE_RECEIPT_PRINT_AREA_ID)}</style>
  );
}

export function ProductSaleReceiptPanel({
  receipt,
  onClose,
}: {
  receipt: ProductSaleReceiptData;
  onClose: () => void;
}) {
  const { receipt_paper: receiptPaper } = useTenantDeviceSettings();
  const standing = receiptPaymentStanding(receipt.amount, receipt.amountReceived);
  const balanceDue = receiptBalanceDue(receipt.amount, receipt.amountReceived);
  const changeFromReceived = receiptChangeDue(receipt.amount, receipt.amountReceived);
  return (
    <ReceiptPreviewFrame
      paper={receiptPaper}
      printAreaId={PRODUCT_SALE_RECEIPT_PRINT_AREA_ID}
      onClose={onClose}
    >
      <ProductSaleReceiptPrintStyles paper={receiptPaper} />

      <div
        id={PRODUCT_SALE_RECEIPT_PRINT_AREA_ID}
        className="relative box-border overflow-hidden rounded-lg border border-slate-200 bg-white p-[3mm] text-[13px] leading-tight text-slate-900 shadow-sm"
      >
        {receipt.isCancelled ? (
          <div
            className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center"
            aria-hidden
          >
            <span className="-rotate-[24deg] border-4 border-red-600/60 px-10 py-3 text-5xl font-bold uppercase tracking-[0.2em] text-red-600/35">
              CANCELLED
            </span>
          </div>
        ) : null}
        <ReportCompanyHeader
          title="Product Sale Receipt"
          periodLabel={formatSaleDateTime(receipt.date)}
          metaLabel="Date"
          variant="receipt"
          brandingSource="stamp"
          stampedBusinessUnitId={receipt.businessUnitId}
        />

        <div className="receipt-body mb-2 grid gap-1 text-[13px] text-slate-700">
          <p>
            <span className="font-medium text-slate-900">Receipt No.:</span>{" "}
            {receipt.invoiceNo}
          </p>
          <p>
            <span className="font-medium text-slate-900">Customer:</span>{" "}
            {receipt.customerLabel}
          </p>
          {receipt.paymentLines && receipt.paymentLines.length > 0 ? (
            <ReceiptPaymentsList lines={receipt.paymentLines} />
          ) : (
            <p>
              <span className="font-medium text-slate-900">Payment method:</span>{" "}
              {receipt.paymentMethod}
            </p>
          )}
          <p>
            <span className="font-medium text-slate-900">Payment status:</span>{" "}
            {standing}
          </p>
          <p>
            <span className="font-medium text-slate-900">Sale status:</span>{" "}
            {receipt.saleStatus}
          </p>
        </div>

        <div className="receipt-body border-t border-dashed border-slate-400 pt-2 text-[13px]">
          <ReceiptItemBlock
            paper={receiptPaper}
            name={receipt.productName}
            sku={receipt.productCode}
            detail={`${receipt.quantityLabel} ×`}
            unitPrice={receipt.unitPrice}
            lineTotal={receipt.amount}
          />
        </div>

        <div className="receipt-totals mt-2 space-y-1 border-t border-dashed border-slate-400 pt-2 text-[15px]">
          <div className="flex items-start justify-between gap-2">
            <span className="min-w-0 break-words font-medium text-slate-700">Sale amount</span>
            <span className="receipt-total shrink-0 font-bold text-[#0f2744]">
              <ReceiptMoney paper={receiptPaper} value={receipt.amount} />
            </span>
          </div>
          <div className="flex items-start justify-between gap-2">
            <span className="min-w-0 break-words font-medium text-slate-700">
              {receipt.paymentLines && receipt.paymentLines.length > 0
                ? "Total paid"
                : "Amount received"}
            </span>
            <span className="receipt-total shrink-0 font-bold text-[#0f2744]">
              <ReceiptMoney paper={receiptPaper} value={receipt.amountReceived} />
            </span>
          </div>
          {balanceDue > 0 ? (
            <div className="flex items-start justify-between gap-2">
              <span className="min-w-0 break-words font-medium text-slate-700">Balance due</span>
              <span className="receipt-total shrink-0 font-bold text-[#0f2744]">
                <ReceiptMoney paper={receiptPaper} value={balanceDue} />
              </span>
            </div>
          ) : null}
          {balanceDue > 0 && receipt.dueDate?.trim() ? (
            <div className="flex items-start justify-between gap-2">
              <span className="min-w-0 break-words font-medium text-slate-700">Due date</span>
              <span className="shrink-0 font-semibold text-[#0f2744]">
                {formatSaleDateTime(receipt.dueDate)}
              </span>
            </div>
          ) : null}
          {changeFromReceived > 0 ? (
            <div className="flex items-start justify-between gap-2">
              <span className="min-w-0 break-words font-medium text-slate-700">Change</span>
              <span className="receipt-total receipt-emphasis receipt-line-total shrink-0 whitespace-nowrap font-bold text-emerald-800">
                <ReceiptMoney paper={receiptPaper} value={changeFromReceived} />
              </span>
            </div>
          ) : null}
        </div>
        <SaleReceiptFooter />
      </div>
    </ReceiptPreviewFrame>
  );
}
