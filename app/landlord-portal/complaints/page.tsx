import { redirect } from "next/navigation";
import {
  fetchLandlordPortalComplaints,
  getLandlordPortalSession,
} from "@/utils/landlord-portal-auth";
import { formatLesseeComplaintDate } from "@/app/dashboard/real-estate/complaints-utils";
import {
  portalErrorBannerClassName,
  portalSectionClassName,
  portalSectionTitleClassName,
} from "../portal-ui";
import LandlordPortalShell from "../portal-shell";

export default async function LandlordPortalComplaintsPage() {
  const session = await getLandlordPortalSession();
  if (!session) {
    redirect("/landlord-portal/login");
  }

  const { rows, error } = await fetchLandlordPortalComplaints(session);

  return (
    <LandlordPortalShell fullName={session.fullName}>
      <section className={portalSectionClassName}>
        <h2 className={portalSectionTitleClassName}>Complaints</h2>
        <p className="mt-1 text-sm text-slate-600">
          View-only list of tenant complaints and current status.
        </p>

        {error ? (
          <div className={`mt-4 ${portalErrorBannerClassName}`}>{error}</div>
        ) : rows.length === 0 ? (
          <p className="mt-4 text-sm text-slate-600">No complaints yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-200">
            {rows.map((row) => (
              <li key={row.complaintId} className="py-3">
                <p className="text-sm font-medium text-slate-900">
                  {row.subject}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {row.lesseeName} · {row.unitLabel}
                </p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {formatLesseeComplaintDate(row.dateReported)} ·{" "}
                  {row.statusLabel}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </LandlordPortalShell>
  );
}
