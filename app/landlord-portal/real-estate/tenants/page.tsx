import Link from "next/link";
import { redirect } from "next/navigation";
import {
  fetchLandlordPortalTenants,
  getLandlordPortalSession,
  landlordPortalHasDataAccess,
} from "@/utils/landlord-portal-auth";
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

export default async function LandlordPortalTenantsPage() {
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

  const { rows, error } = await fetchLandlordPortalTenants(session);
  const canEdit = session.landlordType === "platform_only";

  return (
    <div className="space-y-4">
      <div>
        <h1 className={portalSectionTitleClassName}>Tenants</h1>
        <p className="mt-1 text-sm text-slate-600">
          Lessees linked to your portfolio
          {canEdit
            ? ". Edit contact details or create new tenants when you create a lease or convert an approved application."
            : " (browse). New tenants are created when you create a lease or convert an approved application."}
        </p>
      </div>

      {error ? <div className={portalErrorBannerClassName}>{error}</div> : null}

      {rows.length === 0 ? (
        <section className={portalSectionClassName}>
          <p className="text-sm text-slate-600">No tenants yet.</p>
        </section>
      ) : (
        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={scrollableTableThClassName}>Name</th>
                <th className={scrollableTableThClassName}>Phone</th>
                <th className={scrollableTableThClassName}>Email</th>
                <th className={scrollableTableThClassName}>Status</th>
                <th className={scrollableTableThClassName}>
                  {canEdit ? "Actions" : "View"}
                </th>
              </tr>
            </thead>
            <tbody className={scrollableTableBodyClassName}>
              {rows.map((row) => (
                <tr key={row.lesseeId} className="bg-white">
                  <td className="px-4 py-3 font-medium text-slate-900">
                    {row.fullName}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {row.phone ?? "—"}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {row.email ?? "—"}
                  </td>
                  <td className="px-4 py-3 capitalize text-slate-700">
                    {row.status ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    <Link
                      href={`/landlord-portal/real-estate/tenants/${row.lesseeId}`}
                      className="text-sm font-medium text-[#0f2744] hover:underline"
                    >
                      {canEdit ? "Edit" : "View"}
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
