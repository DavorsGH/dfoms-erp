import { redirect } from "next/navigation";
import { createAdminClient } from "@/utils/supabase/admin";
import { getFacilityManagerSession } from "@/utils/facility-portal-auth";
import {
  fetchFacilityActiveLeaseOptions,
  fetchFacilityMaintenanceRequests,
} from "@/utils/facility-portal-data";
import {
  portalCompactSectionClassName,
  portalErrorBannerClassName,
  portalPageClassName,
  portalSectionTitleClassName,
} from "../portal-ui";
import FacilityMaintenanceClient from "./maintenance-client";

export default async function FacilityPortalMaintenancePage() {
  const session = await getFacilityManagerSession();
  if (!session) {
    redirect("/facility-portal/login");
  }
  if (!session.canManageMaintenance) {
    redirect("/facility-portal/dashboard");
  }

  const admin = createAdminClient();
  const [{ leases, error: leasesError }, { rows, error: rowsError }] =
    await Promise.all([
      fetchFacilityActiveLeaseOptions(admin, session),
      fetchFacilityMaintenanceRequests(admin, session),
    ]);

  const error = leasesError ?? rowsError;

  return (
    <div className={portalPageClassName}>
      <section className={portalCompactSectionClassName}>
        <h1 className={portalSectionTitleClassName}>Maintenance</h1>
        <p className="text-sm text-slate-600">
          Create and update repair requests for leases on your assigned
          properties.
        </p>
      </section>

      {error ? (
        <div className={portalErrorBannerClassName}>{error}</div>
      ) : (
        <FacilityMaintenanceClient
          leases={leases}
          rows={rows}
          tenantId={session.tenantId}
        />
      )}
    </div>
  );
}
