import { redirect } from "next/navigation";
import {
  fetchLandlordPortalTerminations,
  getLandlordPortalSession,
  landlordPortalHasDataAccess,
} from "@/utils/landlord-portal-auth";
import { formatLeaseDate } from "@/app/dashboard/real-estate/leases-utils";
import {
  portalErrorBannerClassName,
  portalSectionClassName,
  portalSectionTitleClassName,
} from "../portal-ui";
import LandlordPortalPendingApprovalView from "../pending-approval-view";
import LandlordPortalShell from "../portal-shell";
import LandlordPortalTerminationActions from "./termination-actions";

export default async function LandlordPortalTerminationsPage() {
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

  const { rows, error } = await fetchLandlordPortalTerminations(session);
  const canAct = session.landlordType === "platform_only";

  return (
    <LandlordPortalShell fullName={session.fullName}>
      <section className={portalSectionClassName}>
        <h2 className={portalSectionTitleClassName}>Termination requests</h2>
        <p className="mt-1 text-sm text-slate-600">
          {canAct
            ? "Approve or reject early termination requests for your leases."
            : "View-only list of early termination requests. Davors manages approvals for your account."}
        </p>

        {error ? (
          <div className={`mt-4 ${portalErrorBannerClassName}`}>{error}</div>
        ) : rows.length === 0 ? (
          <p className="mt-4 text-sm text-slate-600">
            No termination requests yet.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-200">
            {rows.map((row) => (
              <li key={row.leaseId} className="py-3">
                <p className="text-sm font-medium text-slate-900">
                  {row.lesseeName}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {row.unitLabel} · Lease end {formatLeaseDate(row.endDate)}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {row.statusLabel}
                </p>
                {row.reason ? (
                  <p className="mt-1 text-sm text-slate-600">{row.reason}</p>
                ) : null}
                {canAct && row.requestStatus === "pending_staff_approval" ? (
                  <LandlordPortalTerminationActions leaseId={row.leaseId} />
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </LandlordPortalShell>
  );
}
