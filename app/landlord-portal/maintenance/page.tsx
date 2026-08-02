import { redirect } from "next/navigation";
import {
  fetchLandlordPortalMaintenance,
  getLandlordPortalSession,
  landlordPortalHasDataAccess,
} from "@/utils/landlord-portal-auth";
import { formatMaintenanceDate } from "@/app/dashboard/real-estate/maintenance-utils";
import {
  portalErrorBannerClassName,
  portalSectionClassName,
  portalSectionTitleClassName,
} from "../portal-ui";
import LandlordPortalPendingApprovalView from "../pending-approval-view";
import LandlordPortalMaintenanceActions from "./maintenance-actions";

export default async function LandlordPortalMaintenancePage() {
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

  const { rows, error } = await fetchLandlordPortalMaintenance(session);
  const canAct = session.landlordType === "platform_only";

  return (
    <section className={portalSectionClassName}>
      <h2 className={portalSectionTitleClassName}>Maintenance requests</h2>
      <p className="mt-1 text-sm text-slate-600">
        {canAct
          ? "Review and approve or reject repair requests for your properties."
          : "View-only list of repair requests and approval status. Davors manages approvals for your account."}
      </p>

      {error ? (
        <div className={`mt-4 ${portalErrorBannerClassName}`}>{error}</div>
      ) : rows.length === 0 ? (
        <p className="mt-4 text-sm text-slate-600">
          No maintenance requests yet.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-slate-200">
          {rows.map((row) => (
            <li key={row.requestId} className="py-3">
              <p className="text-sm font-medium text-slate-900">
                {row.description}
                {row.tenantSelfFix ? (
                  <span className="ml-1 text-xs font-normal text-slate-500">
                    (self-fix)
                  </span>
                ) : null}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                {row.lesseeName} · {row.unitLabel}
              </p>
              <p className="mt-0.5 text-xs text-slate-500">
                {formatMaintenanceDate(row.dateReported)} · {row.statusLabel} ·
                Landlord {row.landlordApprovalLabel}
              </p>
              {canAct && row.landlordApprovalStatus === "pending" ? (
                <LandlordPortalMaintenanceActions
                  requestId={row.requestId}
                  tenantSelfFix={row.tenantSelfFix}
                  proposedCostGhs={row.proposedCostGhs}
                />
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
