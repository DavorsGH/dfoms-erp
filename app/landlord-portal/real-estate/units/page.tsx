import { redirect } from "next/navigation";
import {
  fetchLandlordPortalUnits,
  getLandlordPortalSession,
  landlordPortalHasDataAccess,
} from "@/utils/landlord-portal-auth";
import { formatUnitStatus } from "@/app/dashboard/real-estate/properties-utils";
import { formatLeaseMoney } from "@/app/dashboard/real-estate/leases-utils";
import ScrollableTable, {
  scrollableTableBodyClassName,
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "@/app/dashboard/scrollable-table";
import {
  portalErrorBannerClassName,
  portalSectionClassName,
  portalSectionTitleClassName,
} from "../../portal-ui";
import LandlordPortalPendingApprovalView from "../../pending-approval-view";

export default async function LandlordPortalUnitsPage() {
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

  const { rows, error } = await fetchLandlordPortalUnits(session);

  return (
    <div className="space-y-4">
      <div>
        <h1 className={portalSectionTitleClassName}>Units</h1>
        <p className="mt-1 text-sm text-slate-600">
          All units across your properties (read-only).
        </p>
      </div>

      {error ? <div className={portalErrorBannerClassName}>{error}</div> : null}

      {rows.length === 0 ? (
        <section className={portalSectionClassName}>
          <p className="text-sm text-slate-600">No units yet.</p>
        </section>
      ) : (
        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={scrollableTableThClassName}>Property</th>
                <th className={scrollableTableThClassName}>Unit</th>
                <th className={scrollableTableThClassName}>Status</th>
                <th className={scrollableTableThClassName}>Base rent</th>
                <th className={scrollableTableThClassName}>Beds / baths</th>
              </tr>
            </thead>
            <tbody className={scrollableTableBodyClassName}>
              {rows.map((row) => (
                <tr key={row.unitId} className="bg-white">
                  <td className="px-4 py-3 text-slate-900">{row.propertyName}</td>
                  <td className="px-4 py-3 text-slate-700">{row.unitNumber}</td>
                  <td className="px-4 py-3 text-slate-700">
                    {formatUnitStatus(row.status)}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {formatLeaseMoney(row.baseRentGhs)}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {row.bedrooms ?? "—"} / {row.bathrooms ?? "—"}
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
