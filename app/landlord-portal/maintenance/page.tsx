import { redirect } from "next/navigation";
import {
  fetchLandlordPortalMaintenance,
  getLandlordPortalSession,
} from "@/utils/landlord-portal-auth";
import { formatMaintenanceDate } from "@/app/dashboard/real-estate/maintenance-utils";
import {
  portalErrorBannerClassName,
  portalSectionClassName,
  portalSectionTitleClassName,
} from "../portal-ui";
import LandlordPortalShell from "../portal-shell";

export default async function LandlordPortalMaintenancePage() {
  const session = await getLandlordPortalSession();
  if (!session) {
    redirect("/landlord-portal/login");
  }

  const { rows, error } = await fetchLandlordPortalMaintenance(session);

  return (
    <LandlordPortalShell fullName={session.fullName}>
      <section className={portalSectionClassName}>
        <h2 className={portalSectionTitleClassName}>Maintenance requests</h2>
        <p className="mt-1 text-sm text-slate-600">
          View-only list of repair requests and approval status for your
          properties.
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
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {row.lesseeName} · {row.unitLabel}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {formatMaintenanceDate(row.dateReported)} · {row.statusLabel}{" "}
                  · Landlord {row.landlordApprovalLabel}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </LandlordPortalShell>
  );
}
