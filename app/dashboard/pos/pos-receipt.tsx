"use client";

import { ReportCompanyHeader } from "../reports/report-ui";
import DashboardButton from "@/components/dashboard-button";
import type { PosCartLine } from "./pos-utils";
import { POS_PRINT_AREA_ID, lineSubtotal } from "./pos-utils";
import { useTenantDeviceSettings } from "@/hooks/use-tenant-device-settings";
import { useTenantBranding } from "../tenant-branding-context";
import {
  formatReceiptAmount,
  formatSaleDateTime,
  printFittedReceipt,
  receiptMoneyStacks,
  receiptPrintableWidthMm,
  receiptPrintCss,
} from "@/utils/device-print-layout";
import type { ReceiptPaper } from "@/utils/tenant-device-settings";
import { useToast } from "@/components/feedback/feedback-context";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import {
  formatReceiptListedPayment,
  receiptBalanceDue,
  receiptChangeDue,
  settleIncomeReceiptLines,
  type ReceiptListedPayment,
  type ReceiptPaymentStanding,
} from "./receipt-settlement";

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
  /** Due date for a balance still owing. */
  dueDate?: string | null;
  /** Return lines kept off the sale quantity. */
  returnLines?: {
    id: string;
    productCode: string;
    productName: string;
    quantity: number;
    amount: number;
    creditNoteNumber: string | null;
  }[];
  returnsTotal?: number | null;
  netTotal?: number | null;
  storeCreditIssued?: number | null;
  cashRefunded?: number | null;
  /** Queued offline cash sale — provisional token, not a tax invoice. */
  pendingSync?: boolean;
  /** Every recorded tender. When present, these replace the single method line. */
  paymentLines?: ReceiptListedPayment[];
};

export function ReceiptPaymentsList({
  lines,
}: {
  lines: ReceiptListedPayment[];
}) {
  if (lines.length === 0) {
    return null;
  }
  return (
    <div className="space-y-1">
      <p className="font-medium text-slate-900">Payments</p>
      {lines.map((line, index) => (
        <p key={`${line.date}-${line.method}-${line.reference ?? "none"}-${index}`}>
          {formatReceiptListedPayment(line)}
        </p>
      ))}
    </div>
  );
}

export function ReceiptMoney({
  value,
  paper,
}: {
  value: number;
  paper: ReceiptPaper;
}) {
  const amount = formatReceiptAmount(value);
  const stacks = receiptMoneyStacks(value, paper);
  return (
    <span
      className={`receipt-money inline-block max-w-full text-right align-top text-[13px] leading-tight whitespace-nowrap ${
        stacks ? "receipt-money-stack whitespace-normal" : ""
      }`}
    >
      {stacks ? (
        <>
          <span className="block">GHS</span>
          <span className="block [overflow-wrap:anywhere]">{amount}</span>
        </>
      ) : (
        <>GHS {amount}</>
      )}
    </span>
  );
}

function formatReceiptQty(value: number): string {
  return value.toLocaleString("en-GB", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 4,
  });
}

export function ReceiptItemBlock({
  paper,
  name,
  sku,
  creditNote,
  detail,
  unitPrice,
  lineTotal,
}: {
  paper: ReceiptPaper;
  name: string;
  sku: string;
  creditNote?: string | null;
  detail: string;
  unitPrice: number;
  lineTotal: number;
}) {
  return (
    <div className="mb-2 max-w-full">
      <p className="receipt-item-name break-words font-medium leading-tight text-slate-900">
        {name}
      </p>
      <p className="receipt-item-name break-words text-[11px] leading-tight text-slate-500">
        {sku}
        {creditNote ? ` · CN ${creditNote}` : ""}
      </p>
      <div className="mt-0.5 flex items-start justify-between gap-2 pl-3">
        <span className="min-w-0 break-words text-slate-700">
          {detail} <ReceiptMoney paper={paper} value={unitPrice} />
        </span>
        <span className="receipt-line-total shrink-0 whitespace-nowrap font-medium text-slate-900">
          <ReceiptMoney paper={paper} value={lineTotal} />
        </span>
      </div>
    </div>
  );
}

export function PosReceiptPrintStyles({ paper }: { paper: ReceiptPaper }) {
  return <style>{receiptPrintCss(paper, POS_PRINT_AREA_ID)}</style>;
}

export function SaleReceiptFooter() {
  const phone = useTenantBranding().phone?.trim() ?? "";
  return (
    <footer className="receipt-body mt-2 border-t border-dashed border-slate-400 pt-2 text-center text-[13px] leading-tight text-slate-700">
      <p>Thank you</p>
      {phone ? <p className="mt-0.5">{phone}</p> : null}
    </footer>
  );
}

export function ReceiptPreviewFrame({
  paper,
  printAreaId,
  onClose,
  children,
}: {
  paper: ReceiptPaper;
  printAreaId: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const { toast } = useToast();
  const printArmed = useRef(false);
  const openRef = useRef(true);
  const widthMm = receiptPrintableWidthMm(paper);
  const outerRef = useRef<HTMLDivElement>(null);
  const paperRef = useRef<HTMLDivElement>(null);
  const [screenBox, setScreenBox] = useState({ scale: 1, height: 0 });

  useEffect(() => {
    openRef.current = true;
    return () => {
      openRef.current = false;
    };
  }, []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key !== "Escape") {
        return;
      }
      event.preventDefault();
      event.stopImmediatePropagation();
      onClose();
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [onClose]);

  useEffect(() => {
    function onAfterPrint() {
      if (!printArmed.current || !openRef.current) {
        return;
      }
      printArmed.current = false;
      toast("Receipt sent to printer");
      onClose();
    }
    window.addEventListener("afterprint", onAfterPrint);
    return () => window.removeEventListener("afterprint", onAfterPrint);
  }, [onClose, toast]);

  useLayoutEffect(() => {
    const outer = outerRef.current;
    const paperNode = paperRef.current;
    if (!outer || !paperNode) {
      return;
    }
    function measure() {
      const paperWidth = paperNode?.offsetWidth ?? 0;
      const target = outer?.clientWidth ?? 0;
      const scale = paperWidth > 0 ? target / paperWidth : 1;
      setScreenBox({
        scale,
        height: (paperNode?.offsetHeight ?? 0) * scale,
      });
    }
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(outer);
    observer.observe(paperNode);
    return () => observer.disconnect();
  }, [widthMm, children]);

  return (
    <div
      className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Receipt preview"
        className="flex max-h-[90vh] w-[min(460px,92vw)] flex-col overflow-hidden rounded-lg bg-white shadow-lg"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="no-print sticky top-0 z-10 flex flex-wrap gap-2 border-b border-slate-200 bg-white px-4 py-3">
          <DashboardButton
            type="button"
            variant="primary"
            onClick={() => {
              printArmed.current = true;
              printFittedReceipt(printAreaId, paper);
            }}
          >
            Print receipt
          </DashboardButton>
          <DashboardButton type="button" variant="secondary" onClick={onClose}>
            Close
          </DashboardButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
          <div ref={outerRef} className="mx-auto w-full max-w-[460px]">
            <div style={{ height: screenBox.height || undefined }}>
              <div
                ref={paperRef}
                className="origin-top-left"
                style={{
                  width: `${widthMm}mm`,
                  transform: `scale(${screenBox.scale})`,
                }}
              >
                {children}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

export function PosReceiptPanel({
  receipt,
  onClose,
}: {
  receipt: PosReceiptData;
  onClose: () => void;
}) {
  const { receipt_paper: receiptPaper } = useTenantDeviceSettings();
  const builtSettlement =
    receipt.netTotal != null
      ? null
      : settleIncomeReceiptLines(
          receipt.lines.map((line, index) => ({
            id: line.id,
            amount: line.quantity * line.unitPrice,
            amount_received: index === 0 ? receipt.amountReceived : 0,
            sale_quantity: line.quantity,
            unit_price: line.unitPrice,
            product_code: line.productCode,
            product_name: line.productName,
            due_date: receipt.dueDate,
          })),
          receipt.storeCreditApplied ?? 0,
        );
  const standing = (receipt.netTotal != null
    ? receipt.paymentStatus
    : builtSettlement?.standing ?? receipt.paymentStatus) as ReceiptPaymentStanding;
  const subtotal = receipt.subtotal ?? builtSettlement?.subtotal ?? receipt.cartTotal;
  const netTotal = receipt.netTotal ?? builtSettlement?.netTotal ?? subtotal;
  const returnsTotal = receipt.returnsTotal ?? builtSettlement?.returnsTotal ?? 0;
  const balanceDue =
    standing === "Returned"
      ? 0
      : receipt.netTotal != null
        ? receiptBalanceDue(
            netTotal,
            receipt.amountReceived + (receipt.storeCreditApplied ?? 0),
          )
        : (builtSettlement?.balanceDue ?? 0);
  const changeFromReceived =
    standing === "Returned" || standing === "Partly returned"
      ? 0
      : receipt.netTotal != null
        ? receiptChangeDue(
            netTotal,
            receipt.amountReceived + (receipt.storeCreditApplied ?? 0),
          )
        : (builtSettlement?.changeDue ?? 0);
  const dueDate = balanceDue > 0 ? receipt.dueDate : null;
  const storeCreditIssued = receipt.storeCreditIssued ?? 0;
  const cashRefunded = receipt.cashRefunded ?? 0;
  const showsTenderedChange =
    receipt.amountTendered != null &&
    (receipt.amountTendered > 0 || (receipt.storeCreditApplied ?? 0) > 0);
  return (
    <ReceiptPreviewFrame
      paper={receiptPaper}
      printAreaId={POS_PRINT_AREA_ID}
      onClose={onClose}
    >
      <PosReceiptPrintStyles paper={receiptPaper} />

      <div
        id={POS_PRINT_AREA_ID}
        className="box-border rounded-lg border border-slate-200 bg-white p-[3mm] text-[13px] leading-snug text-slate-900 shadow-sm"
      >
        <ReportCompanyHeader
          title="Point of Sale Receipt"
          periodLabel={formatSaleDateTime(receipt.saleDate)}
          metaLabel="Date"
          variant="receipt"
          brandingSource="stamp"
          stampedBusinessUnitId={receipt.businessUnitId ?? null}
        />

        {receipt.pendingSync ? (
          <p className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm font-semibold text-amber-950">
            Pending sync — not a tax invoice
          </p>
        ) : null}

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
        </div>

        <div className="receipt-body border-t border-dashed border-slate-400 pt-2 text-[13px]">
          {receipt.lines.map((line) => (
            <ReceiptItemBlock
              key={line.id}
              paper={receiptPaper}
              name={line.productName}
              sku={line.productCode}
              detail={`${formatReceiptQty(line.quantity)} ${line.unitOfMeasure} ×`}
              unitPrice={line.unitPrice}
              lineTotal={lineSubtotal(line)}
            />
          ))}
          {(receipt.returnLines ?? []).map((line) => {
            const unitPrice =
              line.quantity > 0 ? Math.abs(line.amount) / line.quantity : Math.abs(line.amount);
            return (
              <ReceiptItemBlock
                key={line.id}
                paper={receiptPaper}
                name={`Returned: ${line.productName}`}
                sku={line.productCode}
                creditNote={line.creditNoteNumber}
                detail={`${formatReceiptQty(line.quantity)} ×`}
                unitPrice={unitPrice}
                lineTotal={line.amount}
              />
            );
          })}
        </div>

        <div className="receipt-totals mt-2 space-y-1 border-t border-dashed border-slate-400 pt-2 text-[15px]">
          <div className="receipt-total flex items-start justify-between gap-2 font-bold">
            <span className="min-w-0 break-words text-slate-700">Subtotal</span>
            <span className="shrink-0 text-[#0f2744]">
              <ReceiptMoney paper={receiptPaper} value={subtotal} />
            </span>
          </div>
          {returnsTotal > 0.001 ? (
            <div className="receipt-total flex items-start justify-between gap-2 font-bold">
              <span className="min-w-0 break-words text-slate-700">Returns</span>
              <span className="shrink-0 text-[#0f2744]">
                −<ReceiptMoney paper={receiptPaper} value={returnsTotal} />
              </span>
            </div>
          ) : null}
          <div className="receipt-total receipt-emphasis flex items-start justify-between gap-2 font-bold">
            <span className="min-w-0 break-words text-slate-700">Net total</span>
            <span className="receipt-line-total shrink-0 whitespace-nowrap text-[#0f2744]">
              <ReceiptMoney paper={receiptPaper} value={netTotal} />
            </span>
          </div>
          {(receipt.storeCreditApplied ?? 0) > 0 ? (
            <div className="flex items-start justify-between gap-2">
              <span className="min-w-0 break-words font-medium text-slate-700">
                Store credit applied
                {receipt.storeCreditNoteNumber
                  ? ` (${receipt.storeCreditNoteNumber})`
                  : ""}
              </span>
              <span className="shrink-0 font-semibold text-[#0f2744]">
                <ReceiptMoney paper={receiptPaper} value={receipt.storeCreditApplied ?? 0} />
              </span>
            </div>
          ) : null}
          <div className="receipt-total flex items-start justify-between gap-2 font-bold">
            <span className="min-w-0 break-words text-slate-700">
              {receipt.paymentLines && receipt.paymentLines.length > 0
                ? "Total paid"
                : "Amount received"}
            </span>
            <span className="shrink-0 text-[#0f2744]">
              <ReceiptMoney paper={receiptPaper} value={receipt.amountReceived} />
            </span>
          </div>
          {storeCreditIssued > 0.001 ? (
            <div className="flex items-start justify-between gap-2">
              <span className="min-w-0 break-words font-medium text-slate-700">Store credit issued</span>
              <span className="shrink-0 font-semibold text-[#0f2744]">
                <ReceiptMoney paper={receiptPaper} value={storeCreditIssued} />
              </span>
            </div>
          ) : null}
          {cashRefunded > 0.001 ? (
            <div className="flex items-start justify-between gap-2">
              <span className="min-w-0 break-words font-medium text-slate-700">Refunded</span>
              <span className="shrink-0 font-semibold text-[#0f2744]">
                <ReceiptMoney paper={receiptPaper} value={cashRefunded} />
              </span>
            </div>
          ) : null}
          {balanceDue > 0 ? (
            <div className="receipt-total flex items-start justify-between gap-2 font-bold">
              <span className="min-w-0 break-words text-slate-700">Balance due</span>
              <span className="shrink-0 text-[#0f2744]">
                <ReceiptMoney paper={receiptPaper} value={balanceDue} />
              </span>
            </div>
          ) : null}
          {balanceDue > 0 && dueDate?.trim() ? (
            <div className="flex items-start justify-between gap-2">
              <span className="min-w-0 break-words font-medium text-slate-700">Due date</span>
              <span className="shrink-0 font-semibold text-[#0f2744]">
                {formatSaleDateTime(dueDate)}
              </span>
            </div>
          ) : null}
          {changeFromReceived > 0 && !showsTenderedChange ? (
            <div className="receipt-total receipt-emphasis flex items-start justify-between gap-2 font-bold">
              <span className="min-w-0 break-words text-slate-700">Change</span>
              <span className="receipt-line-total shrink-0 whitespace-nowrap text-emerald-800">
                <ReceiptMoney paper={receiptPaper} value={changeFromReceived} />
              </span>
            </div>
          ) : null}
          {receipt.amountTendered != null &&
          (receipt.amountTendered > 0 ||
            (receipt.storeCreditApplied ?? 0) > 0) ? (
            <>
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 break-words font-medium text-slate-700">Cash tendered</span>
                <span className="shrink-0 font-semibold text-[#0f2744]">
                  <ReceiptMoney paper={receiptPaper} value={receipt.amountTendered} />
                </span>
              </div>
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 break-words font-medium text-slate-700">Change</span>
                <span className="shrink-0 font-semibold text-emerald-800">
                  <ReceiptMoney paper={receiptPaper} value={receipt.changeDue ?? 0} />
                </span>
              </div>
            </>
          ) : receipt.paymentMethod === "Cash" &&
            receipt.amountTendered != null &&
            receipt.amountTendered > 0 ? (
            <>
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 break-words font-medium text-slate-700">Amount Tendered</span>
                <span className="shrink-0 font-semibold text-[#0f2744]">
                  <ReceiptMoney paper={receiptPaper} value={receipt.amountTendered} />
                </span>
              </div>
              <div className="flex items-start justify-between gap-2">
                <span className="min-w-0 break-words font-medium text-slate-700">Change Due</span>
                <span className="shrink-0 font-semibold text-emerald-800">
                  <ReceiptMoney paper={receiptPaper} value={receipt.changeDue ?? 0} />
                </span>
              </div>
            </>
          ) : null}
          {receipt.storeCreditNoteNumber &&
          receipt.storeCreditRemainingBalance != null ? (
            <div className="flex items-start justify-between gap-2 border-t border-slate-100 pt-2">
              <span className="min-w-0 break-words font-medium text-slate-700">
                Credit remaining on {receipt.storeCreditNoteNumber}
              </span>
              <span className="shrink-0 font-semibold text-[#0f2744]">
                <ReceiptMoney paper={receiptPaper} value={receipt.storeCreditRemainingBalance} />
              </span>
            </div>
          ) : null}
        </div>
        <SaleReceiptFooter />
      </div>
    </ReceiptPreviewFrame>
  );
}
