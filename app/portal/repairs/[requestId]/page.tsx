import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { createAdminClient } from "@/utils/supabase/admin";
import { getPortalLesseeSession } from "@/utils/lessee-portal-auth";
import { fetchMaintenanceRequestsForLessee } from "@/utils/maintenance-management";
import MaintenanceBeforeAfterGallery from "@/app/dashboard/real-estate/maintenance-before-after-gallery";
import {
  formatMaintenanceDate,
  formatMaintenanceLandlordApproval,
  formatMaintenanceMoney,
  formatMaintenanceStatus,
} from "@/app/dashboard/real-estate/maintenance-utils";
import {
  portalSectionClassName,
  portalSectionTitleClassName,
} from "../../portal-ui";
import PortalShell from "../../portal-shell";

type PageProps = {
  params: Promise<{ requestId: string }>;
};

export default async function PortalRepairDetailPage({ params }: PageProps) {
  const session = await getPortalLesseeSession();
  if (!session) {
    redirect("/portal/login");
  }

  const { requestId } = await params;
  const admin = createAdminClient();
  const { rows, fetchError } = await fetchMaintenanceRequestsForLessee(
    admin,
    session.tenantId,
    session.lesseeId,
  );

  const row = rows.find(
    (item) => item.requestId === requestId && item.reportedBy === "tenant",
  );
  if (!fetchError && !row) {
    notFound();
  }

  return (
    <PortalShell fullName={session.fullName} photoUrl={session.photoUrl}>
      <div className="mb-4">
        <Link
          href="/portal/repairs"
          className="text-sm font-medium text-[#0f2744] hover:underline"
        >
          ← Back to repairs
        </Link>
      </div>

      {fetchError ? (
        <p className="text-sm text-red-700">{fetchError}</p>
      ) : row ? (
        <>
          <section className={portalSectionClassName}>
            <h1 className={portalSectionTitleClassName}>Repair request</h1>
            <p className="mt-3 text-sm text-slate-900">{row.description}</p>
            <p className="mt-2 text-xs text-slate-600">
              Reported {formatMaintenanceDate(row.dateReported)} ·{" "}
              {formatMaintenanceStatus(row.status)} · Landlord:{" "}
              {formatMaintenanceLandlordApproval(row.landlordApprovalStatus)}
              {row.tenantSelfFix
                ? ` · Self-fix ${formatMaintenanceMoney(row.proposedCostGhs)}`
                : ""}
            </p>
          </section>

          <section className={portalSectionClassName}>
            <h2 className={portalSectionTitleClassName}>Photos</h2>
            <div className="mt-4">
              <MaintenanceBeforeAfterGallery
                submissionPhotoUrls={row.photoUrls}
                completionPhotoUrls={row.completionPhotoUrls}
                tenantId={session.tenantId}
              />
            </div>
          </section>
        </>
      ) : null}
    </PortalShell>
  );
}
