import Link from "next/link";
import { redirect } from "next/navigation";
import { NotificationTargetUnavailablePanel } from "@/components/notification-target-unavailable";
import {
  fetchLandlordPortalRentLedgerEntry,
  getLandlordPortalSession,
  landlordPortalHasDataAccess,
} from "@/utils/landlord-portal-auth";
import { formatRentMoney } from "@/app/dashboard/real-estate/rent-ledger-utils";
import {
  portalErrorBannerClassName,
  portalSectionClassName,
  portalSectionTitleClassName,
} from "../../../portal-ui";
import LandlordPortalPendingApprovalView from "../../../pending-approval-view";
import { PrintPageButton } from "../../print-actions";

function formatDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

type PageProps = {
  params: Promise<{ entryId: string }>;
};

export default async function LandlordPortalPaymentReceiptPage({
  params,
}: PageProps) {
  const session = await getLandlordPortalSession();
  if (!session) {
    redirect("/landlord-portal/login");
  }

  if (!landlordPortalHasDataAccess(session)) {
    return (
      <LandlordPortalPendingApprovalView
        fullName={session.fullName}
        approvalStatus={session.approvalStatus}
      />
    );
  }

  const { entryId } = await params;
  const { row, error } = await fetchLandlordPortalRentLedgerEntry(
    session,
    entryId,
  );

  if (!row && !error) {
    return (
      <NotificationTargetUnavailablePanel
        backHref="/landlord-portal/finance/rent-ledger"
        backLabel="Back to rent ledger"
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="print:hidden">
        <Link
          href="/landlord-portal/finance/rent-ledger"
          className="text-sm text-[#0f2744] hover:underline"
        >
          ← Rent ledger
        </Link>
        <div className="mt-2 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-xl font-semibold text-[#0f2744]">
              Payment receipt
            </h1>
            <p className="mt-1 text-sm text-slate-600">
              Individual rent ledger receipt (read-only).
            </p>
          </div>
          <PrintPageButton label="Print receipt" />
        </div>
      </div>

      {error ? (
        <div className={`print:hidden ${portalErrorBannerClassName}`}>{error}</div>
      ) : null}

      {row ? (
        <section className={`${portalSectionClassName} print:border-0 print:shadow-none`}>
          <h2 className={portalSectionTitleClassName}>Receipt</h2>
          <p className="mt-1 text-sm text-slate-600">
            Landlord: {session.fullName}
          </p>
          <dl className="mt-6 grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Tenant
              </dt>
              <dd className="mt-1 text-sm text-slate-900">{row.lesseeName}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Unit
              </dt>
              <dd className="mt-1 text-sm text-slate-900">{row.unitLabel}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Billing period
              </dt>
              <dd className="mt-1 text-sm text-slate-900">
                {formatDate(row.periodStart)} – {formatDate(row.periodEnd)}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Status
              </dt>
              <dd className="mt-1 text-sm text-slate-900">{row.statusLabel}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Amount due
              </dt>
              <dd className="mt-1 text-sm text-slate-900">
                {formatRentMoney(row.amountDueGhs)}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Amount paid
              </dt>
              <dd className="mt-1 text-sm font-semibold text-slate-900">
                {formatRentMoney(row.amountPaidGhs)}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Credit applied
              </dt>
              <dd className="mt-1 text-sm text-slate-900">
                {formatRentMoney(row.creditGhs)}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Outstanding
              </dt>
              <dd className="mt-1 text-sm text-slate-900">
                {formatRentMoney(row.outstandingGhs)}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Paid on
              </dt>
              <dd className="mt-1 text-sm text-slate-900">
                {formatDate(row.paymentDate)}
              </dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Payment method
              </dt>
              <dd className="mt-1 text-sm capitalize text-slate-900">
                {row.paymentMethod?.replace(/_/g, " ") ?? "—"}
              </dd>
            </div>
            <div className="sm:col-span-2">
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Notes
              </dt>
              <dd className="mt-1 text-sm text-slate-900">{row.notes ?? "—"}</dd>
            </div>
            <div>
              <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
                Receipt / entry ID
              </dt>
              <dd className="mt-1 font-mono text-xs text-slate-700">
                {row.entryId}
              </dd>
            </div>
          </dl>
        </section>
      ) : null}
    </div>
  );
}
