import Link from "next/link";
import { redirect } from "next/navigation";
import {
  getLandlordPortalSession,
  landlordPortalHasDataAccess,
} from "@/utils/landlord-portal-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { fetchRentalApplicationsForTenant } from "@/utils/rental-application-management";
import {
  formatApplicationDate,
  formatApplicationMoney,
  formatRentalApplicationStatus,
} from "@/app/dashboard/real-estate/applications-utils";
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

export default async function LandlordPortalApplicationsPage() {
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

  const admin = createAdminClient();
  const { rows, error } = await fetchRentalApplicationsForTenant(
    admin,
    session.tenantId,
    { landlordName: session.fullName },
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className={portalSectionTitleClassName}>Applications</h1>
        <p className="mt-1 text-sm text-slate-600">
          Review rental applications. Approve holds the unit; reject or request
          more info as needed.
        </p>
      </div>

      {error ? <div className={portalErrorBannerClassName}>{error}</div> : null}

      {rows.length === 0 ? (
        <section className={portalSectionClassName}>
          <p className="text-sm text-slate-600">
            No applications yet. Share an apply link from Units for a vacant
            unit.
          </p>
        </section>
      ) : (
        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={scrollableTableThClassName}>Applicant</th>
                <th className={scrollableTableThClassName}>Unit</th>
                <th className={scrollableTableThClassName}>Status</th>
                <th className={scrollableTableThClassName}>Income</th>
                <th className={scrollableTableThClassName}>Submitted</th>
                <th className={scrollableTableThClassName} />
              </tr>
            </thead>
            <tbody className={scrollableTableBodyClassName}>
              {rows.map((row) => (
                <tr key={row.applicationId} className="bg-white">
                  <td className="px-4 py-3 text-slate-900">
                    <div>{row.fullName}</div>
                    <div className="text-xs text-slate-500">{row.phone}</div>
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {row.propertyName} / {row.unitNumber}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {formatRentalApplicationStatus(row.status)}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {formatApplicationMoney(row.monthlyIncomeGhs)}
                  </td>
                  <td className="px-4 py-3 text-slate-700">
                    {formatApplicationDate(row.createdAt)}
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/landlord-portal/real-estate/applications/${row.applicationId}`}
                      className="text-sm font-medium text-[#0f2744] underline"
                    >
                      Open
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
