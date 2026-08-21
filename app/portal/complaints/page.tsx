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
import PortalComplaintsList, {
  type PortalComplaintListItem,
} from "./portal-complaints-list";

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

  const listItems: PortalComplaintListItem[] = rows.map((row) => {
    const isOpen = row.status === "submitted" || row.status === "in_progress";
    const isTenantRaised = row.raisedBy === "tenant";
    const needsAcknowledgment =
      isTenantRaised && row.status === "resolved" && !row.tenantAcknowledgedAt;

    return {
      complaintId: row.complaintId,
      subject: row.subject,
      description: row.description,
      raisedBy: row.raisedBy,
      raisedByLabel: formatLesseeComplaintRaisedBy(row.raisedBy),
      dateLabel: formatLesseeComplaintDate(row.dateReported),
      statusLabel: formatLesseeComplaintStatus(row.status),
      staffResponse: row.staffResponse,
      tenantAcknowledgedAt: row.tenantAcknowledgedAt,
      isOpen,
      needsAcknowledgment,
    };
  });

  return (
    <PortalShell fullName={session.fullName} photoUrl={session.photoUrl}>
      <PortalComplaintForm />

      <section className={portalSectionClassName}>
        <h2 className={portalSectionTitleClassName}>Your complaints</h2>
        {fetchError ? (
          <p className="mt-3 text-sm text-red-700">{fetchError}</p>
        ) : listItems.length === 0 ? (
          <p className="mt-3 text-sm text-slate-600">No complaints yet.</p>
        ) : (
          <PortalComplaintsList rows={listItems} />
        )}
      </section>
    </PortalShell>
  );
}
