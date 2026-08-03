import Link from "next/link";
import { redirect } from "next/navigation";
import {
  fetchLandlordPortalRentLedgerBrowse,
  getLandlordPortalSession,
  landlordPortalHasDataAccess,
} from "@/utils/landlord-portal-auth";
import { formatRentMoney } from "@/app/dashboard/real-estate/rent-ledger-utils";
import ScrollableTable, {
  scrollableTableBodyClassName,
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "@/app/dashboard/scrollable-table";
import {
  portalErrorBannerClassName,
  portalSecondaryButtonClassName,
  portalSectionClassName,
  portalSectionTitleClassName,
} from "../../portal-ui";
import LandlordPortalPendingApprovalView from "../../pending-approval-view";

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

export default async function LandlordPortalRentLedgerPage() {
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

  const { rows, error } = await fetchLandlordPortalRentLedgerBrowse(session);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className={portalSectionTitleClassName}>Rent ledger</h1>
          <p className="mt-1 text-sm text-slate-600">
            Payment history and outstanding balances for your portfolio
            (read-only). Open a receipt for payment detail.
          </p>
        </div>
        <Link
          href="/landlord-portal/finance/rent-ledger/statements"
          className={portalSecondaryButtonClassName}
        >
          Rent statements
        </Link>
      </div>

      {error ? <div className={portalErrorBannerClassName}>{error}</div> : null}

      {rows.length === 0 ? (
        <section className={portalSectionClassName}>
          <p className="text-sm text-slate-600">No rent ledger entries yet.</p>
        </section>
      ) : (
        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={scrollableTableThClassName}>Tenant</th>
                <th className={scrollableTableThClassName}>Unit</th>
                <th className={scrollableTableThClassName}>Type</th>
                <th className={scrollableTableThClassName}>Period</th>
                <th className={scrollableTableThClassName}>Due</th>
                <th className={scrollableTableThClassName}>Paid</th>
                <th className={scrollableTableThClassName}>Outstanding</th>
                <th className={scrollableTableThClassName}>Status</th>
                <th className={scrollableTableThClassName}>Paid on</th>
                <th className={scrollableTableThClassName}>Receipt</th>
              </tr>
            </thead>
            <tbody className={scrollableTableBodyClassName}>
              {rows.map((row) => (
                <tr key={row.entryId} className="bg-white">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {row.lesseeName}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{row.unitLabel}</td>
                  <td className="px-4 py-3 text-slate-700">
                    {row.chargeType === "one_time" ? (
                      <span>
                        One-time
                        {row.description ? (
                          <span className="mt-0.5 block text-xs text-slate-500">
                            {row.description}
                          </span>
                        ) : null}
                      </span>
                    ) : (
                      "Rent"
                    )}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {formatDate(row.periodStart)} – {formatDate(row.periodEnd)}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {formatRentMoney(row.amountDueGhs)}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {formatRentMoney(row.amountPaidGhs)}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {formatRentMoney(row.outstandingGhs)}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{row.statusLabel}</td>
                  <td className="px-4 py-3 text-slate-700">
                    {formatDate(row.paymentDate)}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/landlord-portal/finance/rent-ledger/${row.entryId}`}
                      className="text-sm font-medium text-[#0f2744] hover:underline"
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollableTable>
      )}
    </div>
  );
}
