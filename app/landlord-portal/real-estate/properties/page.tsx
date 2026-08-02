import Link from "next/link";
import { redirect } from "next/navigation";
import {
  fetchLandlordPortalProperties,
  getLandlordPortalSession,
  landlordPortalHasDataAccess,
} from "@/utils/landlord-portal-auth";
import { formatPropertyType } from "@/app/dashboard/real-estate/properties-utils";
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
import LandlordPortalPropertyCreateForm from "./property-create-form";

export default async function LandlordPortalPropertiesPage() {
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
  const { rows, error } = await fetchLandlordPortalProperties(session);

  return (
    <div className="space-y-4">
      <div>
        <h1 className={portalSectionTitleClassName}>Properties</h1>
        <p className="mt-1 text-sm text-slate-600">
          {canManage
            ? "Add and edit properties in your portfolio."
            : "Browse properties in your portfolio (read-only — Davors staff manages changes)."}
        </p>
      </div>

      {canManage ? <LandlordPortalPropertyCreateForm /> : null}

      {error ? <div className={portalErrorBannerClassName}>{error}</div> : null}

      {rows.length === 0 ? (
        <section className={portalSectionClassName}>
          <p className="text-sm text-slate-600">No properties yet.</p>
        </section>
      ) : (
        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={scrollableTableThClassName}>Name</th>
                <th className={scrollableTableThClassName}>Type</th>
                <th className={scrollableTableThClassName}>City</th>
                <th className={scrollableTableThClassName}>Units</th>
                <th className={scrollableTableThClassName}>Occupied</th>
              </tr>
            </thead>
            <tbody className={scrollableTableBodyClassName}>
              {rows.map((row) => (
                <tr key={row.propertyId} className="bg-white hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <Link
                      href={`/landlord-portal/real-estate/properties/${row.propertyId}`}
                      className="font-medium text-[#0f2744] hover:underline"
                    >
                      {row.name}
                    </Link>
                    {row.addressLine1 ? (
                      <p className="text-xs text-slate-500">{row.addressLine1}</p>
                    ) : null}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {formatPropertyType(row.propertyType)}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {row.city ?? "—"}
                    {row.region ? `, ${row.region}` : ""}
                  </td>
                  <td className="px-4 py-3 text-slate-700">{row.unitCount}</td>
                  <td className="px-4 py-3 text-slate-700">
                    {row.occupiedCount}
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
