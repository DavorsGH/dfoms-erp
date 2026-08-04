import { redirect } from "next/navigation";
import { createAdminClient } from "@/utils/supabase/admin";
import { getPortalLesseeSession } from "@/utils/lessee-portal-auth";
import { fetchComplaintsForLessee } from "@/utils/complaint-management";
import {
  formatLesseeComplaintDate,
  formatLesseeComplaintStatus,
} from "@/app/dashboard/real-estate/complaints-utils";
import {
  portalSectionClassName,
  portalSectionTitleClassName,
} from "../portal-ui";
import PortalShell from "../portal-shell";
import PortalComplaintForm from "./complaint-form";

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
            {rows.map((row) => (
              <li key={row.complaintId} className="py-3">
                <p className="text-sm font-medium text-slate-900">
                  {row.subject}
                </p>
                <p className="mt-1 text-xs text-slate-600">
                  {formatLesseeComplaintDate(row.dateReported)} ·{" "}
                  {formatLesseeComplaintStatus(row.status)}
                </p>
                {row.staffResponse ? (
                  <p className="mt-2 text-sm text-slate-700">
                    Staff: {row.staffResponse}
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </PortalShell>
  );
}
