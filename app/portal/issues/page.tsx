import { redirect } from "next/navigation";
import Link from "next/link";
import { createAdminClient } from "@/utils/supabase/admin";
import { getPortalLesseeSession } from "@/utils/lessee-portal-auth";
import { fetchMaintenanceRequestsForLessee } from "@/utils/maintenance-management";
import { fetchComplaintsForLessee } from "@/utils/complaint-management";
import {
  formatMaintenanceDate,
  formatMaintenanceLandlordApproval,
  formatMaintenanceStatus,
} from "@/app/dashboard/real-estate/maintenance-utils";
import {
  formatLesseeComplaintDate,
  formatLesseeComplaintStatus,
} from "@/app/dashboard/real-estate/complaints-utils";
import {
  portalSectionClassName,
  portalSectionTitleClassName,
} from "../portal-ui";
import PortalShell from "../portal-shell";

type IssueItem = {
  id: string;
  kind: "repair" | "complaint";
  title: string;
  statusLabel: string;
  dateIso: string;
  dateLabel: string;
  detail: string | null;
};

export default async function PortalIssuesPage() {
  const session = await getPortalLesseeSession();
  if (!session) {
    redirect("/portal/login");
  }

  const admin = createAdminClient();
  const [maintenance, complaints] = await Promise.all([
    fetchMaintenanceRequestsForLessee(
      admin,
      session.tenantId,
      session.lesseeId,
    ),
    fetchComplaintsForLessee(admin, session.tenantId, session.lesseeId),
  ]);

  const items: IssueItem[] = [
    ...maintenance.rows
      .filter((row) => row.reportedBy === "tenant")
      .map((row) => ({
        id: `repair-${row.requestId}`,
        kind: "repair" as const,
        title: row.description,
        statusLabel: [
          formatMaintenanceStatus(row.status),
          `Landlord ${formatMaintenanceLandlordApproval(row.landlordApprovalStatus)}`,
          row.tenantSelfFix ? "Self-fix" : null,
        ]
          .filter(Boolean)
          .join(" · "),
        dateIso: row.dateReported,
        dateLabel: formatMaintenanceDate(row.dateReported),
        detail: null,
      })),
    ...complaints.rows.map((row) => ({
      id: `complaint-${row.complaintId}`,
      kind: "complaint" as const,
      title: row.subject,
      statusLabel: formatLesseeComplaintStatus(row.status),
      dateIso: row.dateReported,
      dateLabel: formatLesseeComplaintDate(row.dateReported),
      detail: row.staffResponse,
    })),
  ].sort(
    (a, b) => new Date(b.dateIso).getTime() - new Date(a.dateIso).getTime(),
  );

  const fetchError = maintenance.fetchError ?? complaints.fetchError;

  return (
    <PortalShell fullName={session.fullName} photoUrl={session.photoUrl}>
      <section className={portalSectionClassName}>
        <h2 className={portalSectionTitleClassName}>My Issues</h2>
        <p className="mt-1 text-sm text-slate-600">
          Your repair requests and complaints in one place.
        </p>

        {fetchError ? (
          <p className="mt-3 text-sm text-red-700">{fetchError}</p>
        ) : items.length === 0 ? (
          <p className="mt-4 text-sm text-slate-600">
            No issues yet. Submit a repair or complaint from the portal menu.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-200">
            {items.map((item) => (
              <li key={item.id} className="py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-md bg-slate-100 px-2 py-0.5 text-xs font-medium uppercase tracking-wide text-slate-600">
                    {item.kind === "repair" ? "Repair" : "Complaint"}
                  </span>
                  <span className="text-xs text-slate-500">{item.dateLabel}</span>
                </div>
                <p className="mt-1 text-sm font-medium text-slate-900">
                  {item.title}
                </p>
                <p className="mt-1 text-xs text-slate-600">{item.statusLabel}</p>
                {item.kind === "repair" ? (
                  <p className="mt-2">
                    <Link
                      href={`/portal/repairs/${item.id.replace(/^repair-/, "")}`}
                      className="text-sm font-medium text-[#0f2744] hover:underline"
                    >
                      View repair details & photos
                    </Link>
                  </p>
                ) : null}
                {item.detail ? (
                  <p className="mt-2 text-sm text-slate-700">
                    Staff: {item.detail}
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
