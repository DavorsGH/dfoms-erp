import { formatRentMoney } from "./rent-ledger-utils";
import type { RentPaymentReceiptData } from "@/utils/rent-payment-receipt";

export const RENT_PAYMENT_RECEIPT_PRINT_AREA_ID = "rent-payment-receipt-print-area";

function formatReceiptDate(value: string | null): string {
  if (!value) {
    return "—";
  }
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) {
    return value;
  }
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatReceiptPeriod(start: string, end: string): string {
  return `${formatReceiptDate(start)} – ${formatReceiptDate(end)}`;
}

type Props = {
  receipt: RentPaymentReceiptData;
  issuedToLabel?: string;
};

export default function RentPaymentReceiptView({
  receipt,
  issuedToLabel,
}: Props) {
  return (
    <section
      id={RENT_PAYMENT_RECEIPT_PRINT_AREA_ID}
      className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm print:border-0 print:shadow-none"
    >
      <div className="border-b border-slate-200 pb-4">
        <h2 className="text-lg font-semibold text-[#0f2744]">
          {receipt.documentTitle}
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Issued by {receipt.landlordName}
          {issuedToLabel ? ` · ${issuedToLabel}` : null}
        </p>
      </div>

      <dl className="mt-6 grid gap-4 sm:grid-cols-2">
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Tenant
          </dt>
          <dd className="mt-1 text-sm text-slate-900">{receipt.lesseeName}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Property / unit
          </dt>
          <dd className="mt-1 text-sm text-slate-900">{receipt.unitLabel}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Charge type
          </dt>
          <dd className="mt-1 text-sm text-slate-900">{receipt.chargeTypeLabel}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
            {receipt.chargeType === "one_time" ? "Charge date" : "Billing period"}
          </dt>
          <dd className="mt-1 text-sm text-slate-900">
            {receipt.chargeType === "one_time"
              ? formatReceiptDate(receipt.periodStart)
              : formatReceiptPeriod(receipt.periodStart, receipt.periodEnd)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Amount paid
          </dt>
          <dd className="mt-1 text-lg font-semibold text-[#0f2744]">
            {formatRentMoney(receipt.amountPaidGhs)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Payment method
          </dt>
          <dd className="mt-1 text-sm text-slate-900">
            {receipt.paymentMethodLabel}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Payment date
          </dt>
          <dd className="mt-1 text-sm text-slate-900">
            {formatReceiptDate(receipt.paymentDate)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Receipt / reference no.
          </dt>
          <dd className="mt-1 font-mono text-xs text-slate-700">
            {receipt.receiptReference}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Status
          </dt>
          <dd className="mt-1 text-sm text-slate-900">{receipt.statusLabel}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Amount due
          </dt>
          <dd className="mt-1 text-sm text-slate-900">
            {formatRentMoney(receipt.amountDueGhs)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Outstanding
          </dt>
          <dd className="mt-1 text-sm text-slate-900">
            {formatRentMoney(receipt.outstandingGhs)}
          </dd>
        </div>
        {receipt.notes ? (
          <div className="sm:col-span-2">
            <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
              Notes
            </dt>
            <dd className="mt-1 text-sm text-slate-900">{receipt.notes}</dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}

export { formatReceiptDate, formatReceiptPeriod };
