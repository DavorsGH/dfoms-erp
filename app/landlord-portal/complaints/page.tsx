import { redirect } from "next/navigation";
import {
  fetchLandlordPortalComplaints,
  getLandlordPortalSession,
  landlordPortalHasDataAccess,
} from "@/utils/landlord-portal-auth";
import { formatLesseeComplaintDate } from "@/app/dashboard/real-estate/complaints-utils";
import {
  portalErrorBannerClassName,
  portalSectionClassName,
  portalSectionTitleClassName,
} from "../portal-ui";
import LandlordPortalPendingApprovalView from "../pending-approval-view";
import LandlordPortalComplaintActions from "./complaint-actions";

export default async function LandlordPortalComplaintsPage() {
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

  const { rows, error } = await fetchLandlordPortalComplaints(session);
  const canAct = session.landlordType === "platform_only";

  return (
    <section className={portalSectionClassName}>
      <h2 className={portalSectionTitleClassName}>Complaints</h2>
      <p className="mt-1 text-sm text-slate-600">
        {canAct
          ? "Respond to tenant complaints, file complaints about tenants from a lease, and mark items resolved."
          : "View-only list of complaints and current status. Davors manages responses for your account."}
      </p>

      {error ? (
        <div className={`mt-4 ${portalErrorBannerClassName}`}>{error}</div>
      ) : rows.length === 0 ? (
        <p className="mt-4 text-sm text-slate-600">No complaints yet.</p>
      ) : (
        <ul className="mt-4 divide-y divide-slate-200">
          {rows.map((row) => {
            const open =
              row.status === "submitted" || row.status === "in_progress";
            const isTenantRaised = row.raisedBy === "tenant";
            return (
              <li key={row.complaintId} className="py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-slate-900">
                    {row.subject}
                  </p>
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                    {row.raisedByLabel}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-slate-500">
                  {row.lesseeName} · {row.unitLabel}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {formatLesseeComplaintDate(row.dateReported)} ·{" "}
                  {row.statusLabel}
                </p>
                {row.description ? (
                  <p className="mt-1 text-sm text-slate-600">{row.description}</p>
                ) : null}
                {row.staffResponse ? (
                  <p className="mt-1 text-sm text-slate-600">
                    {isTenantRaised
                      ? `Your response: ${row.staffResponse}`
                      : `Tenant response: ${row.staffResponse}`}
                  </p>
                ) : null}
                {canAct && open ? (
                  <LandlordPortalComplaintActions
                    complaintId={row.complaintId}
                    raisedBy={row.raisedBy}
                    initialStatus={row.status}
                    initialResponse={row.staffResponse}
                  />
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
