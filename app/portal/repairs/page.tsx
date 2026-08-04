import { redirect } from "next/navigation";
import Link from "next/link";
import { createAdminClient } from "@/utils/supabase/admin";
import { getPortalLesseeSession } from "@/utils/lessee-portal-auth";
import { fetchMaintenanceRequestsForLessee } from "@/utils/maintenance-management";
import {
  formatMaintenanceDate,
  formatMaintenanceLandlordApproval,
  formatMaintenanceMoney,
  formatMaintenanceStatus,
} from "@/app/dashboard/real-estate/maintenance-utils";
import {
  portalSectionClassName,
  portalSectionTitleClassName,
} from "../portal-ui";
import PortalShell from "../portal-shell";
import PortalRepairForm from "./repair-form";

export default async function PortalRepairsPage() {
  const session = await getPortalLesseeSession();
  if (!session) {
    redirect("/portal/login");
  }

  const admin = createAdminClient();
  const { rows, fetchError } = await fetchMaintenanceRequestsForLessee(
    admin,
    session.tenantId,
    session.lesseeId,
  );

  const mine = rows.filter((row) => row.reportedBy === "tenant");

  return (
    <PortalShell fullName={session.fullName}>
      <PortalRepairForm />

      <section className={portalSectionClassName}>
        <h2 className={portalSectionTitleClassName}>Your repair requests</h2>
        {fetchError ? (
          <p className="mt-3 text-sm text-red-700">{fetchError}</p>
        ) : mine.length === 0 ? (
          <p className="mt-3 text-sm text-slate-600">No repair requests yet.</p>
        ) : (
          <ul className="mt-4 divide-y divide-slate-200">
            {mine.map((row) => (
              <li key={row.requestId} className="py-3">
                <Link
                  href={`/portal/repairs/${row.requestId}`}
                  className="block hover:bg-slate-50 -mx-2 px-2 rounded-md"
                >
                  <p className="text-sm font-medium text-slate-900">
                    {row.description}
                  </p>
                  <p className="mt-1 text-xs text-slate-600">
                    {formatMaintenanceDate(row.dateReported)} ·{" "}
                    {formatMaintenanceStatus(row.status)} · Landlord:{" "}
                    {formatMaintenanceLandlordApproval(
                      row.landlordApprovalStatus,
                    )}
                    {row.tenantSelfFix
                      ? ` · Self-fix ${formatMaintenanceMoney(row.proposedCostGhs)}`
                      : ""}
                    {(row.photoUrls.length > 0 ||
                      row.completionPhotoUrls.length > 0) &&
                      " · View photos"}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </PortalShell>
  );
}
