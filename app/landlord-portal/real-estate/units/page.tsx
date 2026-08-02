import Link from "next/link";
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
import DeleteUnitButton from "./delete-unit-button";
import ShareApplyLinkButton from "./share-apply-link-button";

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

  const canManage = session.landlordType === "platform_only";
  const { rows, error } = await fetchLandlordPortalUnits(session);

  return (
    <div className="space-y-4">
      <div>
        <h1 className={portalSectionTitleClassName}>Units</h1>
        <p className="mt-1 text-sm text-slate-600">
          {canManage
            ? "Units across your properties. Open a property to add, edit, or set base rent. Vacant units can share a public application link."
            : "Units across your properties (read-only — Davors staff manages changes). Vacant units can share a public application link."}
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
                <th className={scrollableTableThClassName}>Apply link</th>
                {canManage ? (
                  <th className={scrollableTableThClassName}>Manage</th>
                ) : null}
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
                  <td className="px-4 py-3">
                    {row.status === "vacant" ? (
                      <ShareApplyLinkButton
                        unitId={row.unitId}
                        propertyId={row.propertyId}
                        unitLabel={row.unitNumber}
                      />
                    ) : (
                      <span className="text-xs text-slate-400">—</span>
                    )}
                  </td>
                  {canManage ? (
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                        <Link
                          href={`/landlord-portal/real-estate/properties/${row.propertyId}`}
                          className="text-sm font-medium text-[#0f2744] hover:underline"
                        >
                          Edit on property
                        </Link>
                        <DeleteUnitButton
                          unitId={row.unitId}
                          unitLabel={row.unitNumber}
                        />
                      </div>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollableTable>
      )}
    </div>
  );
}
