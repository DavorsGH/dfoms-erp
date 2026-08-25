import { redirect } from "next/navigation";
import { createAdminClient } from "@/utils/supabase/admin";
import { getFacilityManagerSession } from "@/utils/facility-portal-auth";
import {
  fetchFacilityInspectionLeaseOptions,
  fetchFacilityInspections,
} from "@/utils/facility-portal-data";
import {
  portalCompactSectionClassName,
  portalErrorBannerClassName,
  portalPageClassName,
  portalSectionTitleClassName,
} from "../portal-ui";
import FacilityInspectionsClient from "./inspections-client";

export default async function FacilityPortalInspectionsPage() {
  const session = await getFacilityManagerSession();
  if (!session) {
    redirect("/facility-portal/login");
  }
  if (!session.canManageInspections) {
    redirect("/facility-portal/dashboard");
  }

  const admin = createAdminClient();
  const [{ rows, error }, { leases, error: leasesError }] = await Promise.all([
    fetchFacilityInspections(admin, session),
    fetchFacilityInspectionLeaseOptions(admin, session),
  ]);

  const loadError = error ?? leasesError;

  return (
    <div className={portalPageClassName}>
      <section className={portalCompactSectionClassName}>
        <h1 className={portalSectionTitleClassName}>Inspections</h1>
        <p className="text-sm text-slate-600">
          Record move-in and move-out inspections with the standard checklist
          for your assigned properties.
        </p>
      </section>

      {loadError ? (
        <div className={portalErrorBannerClassName}>{loadError}</div>
      ) : (
        <FacilityInspectionsClient
          rows={rows}
          leases={leases}
          conductedByDefault={session.fullName?.trim() || "Facility Manager"}
        />
      )}
    </div>
  );
}
