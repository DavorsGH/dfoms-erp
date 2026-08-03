import Link from "next/link";
import { redirect } from "next/navigation";
import {
  fetchLandlordPortalRentLedgerBrowse,
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
import {
  ExportCsvButton,
  PrintPageButton,
} from "../../print-actions";

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

function monthBounds(period: string): { start: string; end: string; label: string } | null {
  if (!/^\d{4}-\d{2}$/.test(period)) return null;
  const [yearText, monthText] = period.split("-");
  const year = Number(yearText);
  const monthIndex = Number(monthText) - 1;
  const startDate = new Date(year, monthIndex, 1);
  const endDate = new Date(year, monthIndex + 1, 0);
  const toIso = (d: Date) => d.toISOString().slice(0, 10);
  return {
    start: toIso(startDate),
    end: toIso(endDate),
    label: startDate.toLocaleDateString("en-GB", {
      month: "long",
      year: "numeric",
    }),
  };
}

type PageProps = {
  searchParams: Promise<{ period?: string }>;
};

export default async function LandlordPortalRentStatementsPage({
  searchParams,
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

  const params = await searchParams;
  const now = new Date();
  const defaultPeriod = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const period = params.period?.trim() || defaultPeriod;
  const bounds = monthBounds(period) ?? monthBounds(defaultPeriod)!;

  const { rows, error } = await fetchLandlordPortalRentLedgerBrowse(session, {
    activeLeasesOnly: false,
  });
  const statementRows = rows.filter(
    (row) =>
      row.periodStart >= bounds.start && row.periodStart <= bounds.end,
  );

  const totalDue = statementRows.reduce((sum, row) => sum + row.amountDueGhs, 0);
  const totalPaid = statementRows.reduce(
    (sum, row) => sum + row.amountPaidGhs,
    0,
  );
  const totalOutstanding = statementRows.reduce(
    (sum, row) => sum + row.outstandingGhs,
    0,
  );

  const csvRows = statementRows.map((row) => [
    row.lesseeName,
    row.unitLabel,
    row.periodStart,
    row.periodEnd,
    row.amountDueGhs,
    row.amountPaidGhs,
    row.outstandingGhs,
    row.statusLabel,
    row.paymentDate,
  ]);

  return (
    <div className="space-y-4">
      <div className="print:hidden">
        <Link
          href="/landlord-portal/finance/rent-ledger"
          className="text-sm text-[#0f2744] hover:underline"
        >
          ← Rent ledger
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-[#0f2744]">
          Rent statement
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          Downloadable / printable statement for a billing period.
        </p>
      </div>

      {error ? (
        <div className={`print:hidden ${portalErrorBannerClassName}`}>{error}</div>
      ) : null}

      <section className={`${portalSectionClassName} print:border-0 print:p-0`}>
        <div className="flex flex-wrap items-end justify-between gap-3 print:hidden">
          <form method="get" className="flex flex-wrap items-end gap-3">
            <div>
              <label
                htmlFor="statement-period"
                className="mb-1 block text-sm font-medium text-slate-700"
              >
                Period
              </label>
              <input
                id="statement-period"
                name="period"
                type="month"
                defaultValue={period}
                className="rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900"
              />
            </div>
            <button
              type="submit"
              className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white"
            >
              Update
            </button>
          </form>
          <div className="flex flex-wrap gap-2">
            <ExportCsvButton
              fileName={`rent-statement-${period}.csv`}
              headers={[
                "Tenant",
                "Unit",
                "Period start",
                "Period end",
                "Due",
                "Paid",
                "Outstanding",
                "Status",
                "Paid on",
              ]}
              rows={csvRows}
            />
            <PrintPageButton />
          </div>
        </div>

        <div className="mt-6">
          <h2 className={portalSectionTitleClassName}>
            Statement · {bounds.label}
          </h2>
          <p className="mt-1 text-sm text-slate-600">
            Landlord: {session.fullName}
          </p>
          <dl className="mt-4 grid gap-3 sm:grid-cols-3">
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">
                Total due
              </dt>
              <dd className="mt-1 text-sm font-medium text-slate-900">
                {formatRentMoney(totalDue)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">
                Total paid
              </dt>
              <dd className="mt-1 text-sm font-medium text-slate-900">
                {formatRentMoney(totalPaid)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-slate-500">
                Outstanding
              </dt>
              <dd className="mt-1 text-sm font-medium text-slate-900">
                {formatRentMoney(totalOutstanding)}
              </dd>
            </div>
          </dl>
        </div>

        {statementRows.length === 0 ? (
          <p className="mt-6 text-sm text-slate-600">
            No ledger entries for this period.
          </p>
        ) : (
          <div className="mt-6 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th className="px-2 py-2">Tenant</th>
                  <th className="px-2 py-2">Unit</th>
                  <th className="px-2 py-2">Period</th>
                  <th className="px-2 py-2">Due</th>
                  <th className="px-2 py-2">Paid</th>
                  <th className="px-2 py-2">Outstanding</th>
                  <th className="px-2 py-2">Status</th>
                </tr>
              </thead>
              <tbody>
                {statementRows.map((row) => (
                  <tr key={row.entryId} className="border-b border-slate-100">
                    <td className="px-2 py-2 font-medium text-slate-900">
                      {row.lesseeName}
                    </td>
                    <td className="px-2 py-2 text-slate-700">{row.unitLabel}</td>
                    <td className="px-2 py-2 text-slate-700">
                      {formatDate(row.periodStart)} – {formatDate(row.periodEnd)}
                    </td>
                    <td className="px-2 py-2 text-slate-700">
                      {formatRentMoney(row.amountDueGhs)}
                    </td>
                    <td className="px-2 py-2 text-slate-700">
                      {formatRentMoney(row.amountPaidGhs)}
                    </td>
                    <td className="px-2 py-2 text-slate-700">
                      {formatRentMoney(row.outstandingGhs)}
                    </td>
                    <td className="px-2 py-2 text-slate-700">{row.statusLabel}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
