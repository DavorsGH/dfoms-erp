import { redirect } from "next/navigation";
import { createAdminClient } from "@/utils/supabase/admin";
import { getPortalLesseeSession } from "@/utils/lessee-portal-auth";
import { fetchComplaintsForLessee } from "@/utils/complaint-management";
import {
  formatLesseeComplaintDate,
  formatLesseeComplaintRaisedBy,
  formatLesseeComplaintStatus,
} from "@/app/dashboard/real-estate/complaints-utils";
import {
  portalSectionClassName,
  portalSectionTitleClassName,
} from "../portal-ui";
import PortalShell from "../portal-shell";
import PortalComplaintForm from "./complaint-form";
import PortalComplaintActions from "./complaint-actions";

export default async function PortalComplaintsPage() {
  const session = await getPortalLesseeSession();
  if (!session) {
    redirect("/portal/login");
  }

  const admin = createAdminClient();
  const { rows, fetchError } = await fetchComplaintsForLessee(
    admin,
    session.tenantId,
    session.lesseeId,
  );

  return (
    <PortalShell fullName={session.fullName} photoUrl={session.photoUrl}>
      <PortalComplaintForm />

      <section className={portalSectionClassName}>
        <h2 className={portalSectionTitleClassName}>Your complaints</h2>
        {fetchError ? (
          <p className="mt-3 text-sm text-red-700">{fetchError}</p>
        ) : rows.length === 0 ? (
          <p className="mt-3 text-sm text-slate-600">No complaints yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-200">
            {rows.map((row) => {
              const open =
                row.status === "submitted" || row.status === "in_progress";
              const isLandlordRaised = row.raisedBy === "landlord";
              return (
                <li key={row.complaintId} className="py-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-medium text-slate-900">
                      {row.subject}
                    </p>
                    <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
                      {formatLesseeComplaintRaisedBy(row.raisedBy)}
                    </span>
                  </div>
                  <p className="mt-1 text-xs text-slate-600">
                    {formatLesseeComplaintDate(row.dateReported)} ·{" "}
                    {formatLesseeComplaintStatus(row.status)}
                  </p>
                  {isLandlordRaised ? (
                    <p className="mt-2 text-sm text-slate-700">
                      {row.description}
                    </p>
                  ) : null}
                  {row.staffResponse ? (
                    <p className="mt-2 text-sm text-slate-700">
                      {isLandlordRaised
                        ? `Your response: ${row.staffResponse}`
                        : `Landlord: ${row.staffResponse}`}
                    </p>
                  ) : null}
                  {isLandlordRaised && open ? (
                    <PortalComplaintActions
                      complaintId={row.complaintId}
                      initialResponse={row.staffResponse}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </PortalShell>
  );
}
