import { formatLeaseMoney, formatLeaseDate, formatDepositStatus } from "./leases-utils";
import type { SecurityDepositReceiptData } from "@/utils/security-deposit-receipt";

export const SECURITY_DEPOSIT_COLLECTION_PRINT_AREA_ID =
  "security-deposit-collection-print-area";
export const SECURITY_DEPOSIT_RESOLUTION_PRINT_AREA_ID =
  "security-deposit-resolution-print-area";

type CollectionProps = {
  receipt: SecurityDepositReceiptData;
};

export function SecurityDepositCollectionReceiptView({ receipt }: CollectionProps) {
  return (
    <section
      id={SECURITY_DEPOSIT_COLLECTION_PRINT_AREA_ID}
      className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm print:border-0 print:shadow-none"
    >
      <div className="border-b border-slate-200 pb-4">
        <h2 className="text-lg font-semibold text-[#0f2744]">
          Security deposit collection receipt
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Issued by {receipt.landlordName}
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
            Landlord
          </dt>
          <dd className="mt-1 text-sm text-slate-900">{receipt.landlordName}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Property / unit
          </dt>
          <dd className="mt-1 text-sm text-slate-900">{receipt.unitLabel}</dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Lease period
          </dt>
          <dd className="mt-1 text-sm text-slate-900">
            {formatLeaseDate(receipt.leaseStartDate)} –{" "}
            {formatLeaseDate(receipt.leaseEndDate)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Deposit amount
          </dt>
          <dd className="mt-1 text-lg font-semibold text-[#0f2744]">
            {formatLeaseMoney(receipt.amountGhs)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Date collected
          </dt>
          <dd className="mt-1 text-sm text-slate-900">
            {formatLeaseDate(receipt.dateCollected)}
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
            Current status
          </dt>
          <dd className="mt-1 text-sm text-slate-900">{receipt.statusLabel}</dd>
        </div>
      </dl>
    </section>
  );
}

export function SecurityDepositResolutionReceiptView({ receipt }: CollectionProps) {
  return (
    <section
      id={SECURITY_DEPOSIT_RESOLUTION_PRINT_AREA_ID}
      className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm print:border-0 print:shadow-none"
    >
      <div className="border-b border-slate-200 pb-4">
        <h2 className="text-lg font-semibold text-[#0f2744]">
          Security deposit resolution receipt
        </h2>
        <p className="mt-1 text-sm text-slate-600">
          Issued by {receipt.landlordName}
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
            Original deposit
          </dt>
          <dd className="mt-1 text-sm text-slate-900">
            {formatLeaseMoney(receipt.amountGhs)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Resolution status
          </dt>
          <dd className="mt-1 text-sm text-slate-900">
            {formatDepositStatus(receipt.status)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Amount returned
          </dt>
          <dd className="mt-1 text-lg font-semibold text-[#0f2744]">
            {formatLeaseMoney(receipt.amountReturnedGhs)}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Date resolved
          </dt>
          <dd className="mt-1 text-sm text-slate-900">
            {formatLeaseDate(receipt.dateResolved)}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Resolution notes
          </dt>
          <dd className="mt-1 text-sm text-slate-900">
            {receipt.resolutionNotes?.trim() || "—"}
          </dd>
        </div>
        <div>
          <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
            Receipt / reference no.
          </dt>
          <dd className="mt-1 font-mono text-xs text-slate-700">
            {receipt.receiptReference}-resolution
          </dd>
        </div>
      </dl>
    </section>
  );
}
