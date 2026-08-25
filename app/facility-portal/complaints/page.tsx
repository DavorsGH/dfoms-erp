import { redirect } from "next/navigation";
import { createAdminClient } from "@/utils/supabase/admin";
import { getFacilityManagerSession } from "@/utils/facility-portal-auth";
import {
  fetchFacilityActiveLeaseOptions,
  fetchFacilityComplaints,
} from "@/utils/facility-portal-data";
import {
  portalCompactSectionClassName,
  portalErrorBannerClassName,
  portalPageClassName,
  portalSectionTitleClassName,
} from "../portal-ui";
import FacilityComplaintsClient from "./complaints-client";

export default async function FacilityPortalComplaintsPage() {
  const session = await getFacilityManagerSession();
  if (!session) {
    redirect("/facility-portal/login");
  }
  if (!session.canManageComplaints) {
    redirect("/facility-portal/dashboard");
  }

  const admin = createAdminClient();
  const [{ rows, error }, { leases, error: leasesError }] = await Promise.all([
    fetchFacilityComplaints(admin, session),
    fetchFacilityActiveLeaseOptions(admin, session),
  ]);

  const loadError = error ?? leasesError;

  return (
    <div className={portalPageClassName}>
      <section className={portalCompactSectionClassName}>
        <h1 className={portalSectionTitleClassName}>Complaints</h1>
        <p className="text-sm text-slate-600">
          View and respond to tenant complaints, or file complaints on assigned
          leases on your landlord&apos;s behalf.
        </p>
      </section>

      {loadError ? (
        <div className={portalErrorBannerClassName}>{loadError}</div>
      ) : (
        <FacilityComplaintsClient rows={rows} leases={leases} />
      )}
    </div>
  );
}
