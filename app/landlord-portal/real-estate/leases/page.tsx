import Link from "next/link";
import { redirect } from "next/navigation";
import {
  fetchLandlordPortalLeasesBrowse,
  fetchLandlordPortalTenants,
  fetchLandlordPortalUnits,
  getLandlordPortalSession,
  landlordPortalHasDataAccess,
} from "@/utils/landlord-portal-auth";
import {
  formatLeaseDate,
  formatLeaseMoney,
} from "@/app/dashboard/real-estate/leases-utils";
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
import LandlordPortalLeaseCreateForm from "./lease-create-form";

export default async function LandlordPortalLeasesPage() {
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

  const canManage = session.landlordType === "platform_only";
  const [{ rows, error }, unitsResult, tenantsResult] = await Promise.all([
    fetchLandlordPortalLeasesBrowse(session),
    canManage
      ? fetchLandlordPortalUnits(session)
      : Promise.resolve({ rows: [], error: null }),
    canManage
      ? fetchLandlordPortalTenants(session)
      : Promise.resolve({ rows: [], error: null }),
  ]);

  const vacantUnits = unitsResult.rows
    .filter((unit) => unit.status === "vacant")
    .map((unit) => ({
      unitId: unit.unitId,
      label: `${unit.propertyName} · Unit ${unit.unitNumber}`,
      baseRentGhs: unit.baseRentGhs,
    }));

  const lessees = tenantsResult.rows.map((tenant) => ({
    lesseeId: tenant.lesseeId,
    fullName: tenant.fullName,
  }));

  return (
    <div className="space-y-4">
      <div>
        <h1 className={portalSectionTitleClassName}>Leases</h1>
        <p className="mt-1 text-sm text-slate-600">
          {canManage
            ? "Create and edit leases, set rent, or convert approved applications. Open a row for full lease terms."
            : "Active and historical leases for your portfolio (read-only). Open a row for full lease terms."}
        </p>
      </div>

      {canManage ? (
        <LandlordPortalLeaseCreateForm
          vacantUnits={vacantUnits}
          lessees={lessees}
        />
      ) : null}

      {error ? <div className={portalErrorBannerClassName}>{error}</div> : null}

      {rows.length === 0 ? (
        <section className={portalSectionClassName}>
          <p className="text-sm text-slate-600">No leases yet.</p>
        </section>
      ) : (
        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={scrollableTableThClassName}>Tenant</th>
                <th className={scrollableTableThClassName}>Property / unit</th>
                <th className={scrollableTableThClassName}>Rent</th>
                <th className={scrollableTableThClassName}>Term</th>
                <th className={scrollableTableThClassName}>Status</th>
              </tr>
            </thead>
            <tbody className={scrollableTableBodyClassName}>
              {rows.map((row) => (
                <tr key={row.leaseId} className="bg-white">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    <Link
                      href={`/landlord-portal/real-estate/leases/${row.leaseId}`}
                      className="text-[#0f2744] hover:underline"
                    >
                      {row.lesseeName}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {row.propertyName} · {row.unitNumber}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {formatLeaseMoney(row.rentAmountGhs)}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {formatLeaseDate(row.startDate)} –{" "}
                    {formatLeaseDate(row.endDate)}
                  </td>
                  <td className="px-4 py-3 capitalize text-slate-700">
                    {row.status}
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
