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
  formatLesseeComplaintRaisedBy,
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
  raisedByLabel: string | null;
  dateIso: string;
  dateLabel: string;
  detail: string | null;
  isLandlordRaised: boolean;
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
        raisedByLabel: null,
        dateIso: row.dateReported,
        dateLabel: formatMaintenanceDate(row.dateReported),
        detail: null,
        isLandlordRaised: false,
      })),
    ...complaints.rows.map((row) => ({
      id: `complaint-${row.complaintId}`,
      kind: "complaint" as const,
      title: row.subject,
      statusLabel: [
        formatLesseeComplaintStatus(row.status),
        row.raisedBy === "tenant" &&
        row.status === "resolved" &&
        !row.tenantAcknowledgedAt
          ? "Awaiting your acknowledgment"
          : row.tenantAcknowledgedAt
            ? "Acknowledged"
            : null,
      ]
        .filter(Boolean)
        .join(" · "),
      raisedByLabel: formatLesseeComplaintRaisedBy(row.raisedBy),
      dateIso: row.dateReported,
      dateLabel: formatLesseeComplaintDate(row.dateReported),
      detail: row.staffResponse,
      isLandlordRaised: row.raisedBy === "landlord",
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
                  {item.raisedByLabel ? (
                    <span className="rounded-md bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">
                      {item.raisedByLabel}
                    </span>
                  ) : null}
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
                ) : (
                  <p className="mt-2">
                    <Link
                      href="/portal/complaints"
                      className="text-sm font-medium text-[#0f2744] hover:underline"
                    >
                      {item.isLandlordRaised
                        ? "View & respond"
                        : item.statusLabel.includes("Awaiting your acknowledgment")
                          ? "Acknowledge resolution"
                          : "View complaint details"}
                    </Link>
                  </p>
                )}
                {item.detail ? (
                  <p className="mt-2 text-sm text-slate-700">
                    {item.isLandlordRaised
                      ? `Your response: ${item.detail}`
                      : `Landlord: ${item.detail}`}
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
