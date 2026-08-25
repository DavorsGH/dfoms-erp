import { redirect } from "next/navigation";
import { createAdminClient } from "@/utils/supabase/admin";
import { getFacilityManagerSession } from "@/utils/facility-portal-auth";
import {
  fetchFacilityAssignedProperties,
  fetchFacilityAssignedUnits,
  fetchFacilityServiceRecords,
} from "@/utils/facility-portal-data";
import {
  portalCompactSectionClassName,
  portalErrorBannerClassName,
  portalPageClassName,
  portalSectionTitleClassName,
} from "../portal-ui";
import FacilityServicesClient from "./services-client";

export default async function FacilityPortalServicesPage() {
  const session = await getFacilityManagerSession();
  if (!session) {
    redirect("/facility-portal/login");
  }
  if (!session.canLogServices) {
    redirect("/facility-portal/dashboard");
  }

  const admin = createAdminClient();
  const [
    { properties, error: propertiesError },
    { units, error: unitsError },
    { rows, totalCostGhs, error: recordsError },
  ] = await Promise.all([
    fetchFacilityAssignedProperties(admin, session),
    fetchFacilityAssignedUnits(admin, session),
    fetchFacilityServiceRecords(admin, session),
  ]);

  const error = propertiesError ?? unitsError ?? recordsError;

  return (
    <div className={portalPageClassName}>
      <section className={portalCompactSectionClassName}>
        <h1 className={portalSectionTitleClassName}>Services</h1>
        <p className="text-sm text-slate-600">
          Log cleaning, gardening, and other property services with optional
          cost tracking.
        </p>
      </section>

      {error ? (
        <div className={portalErrorBannerClassName}>{error}</div>
      ) : (
        <FacilityServicesClient
          properties={properties}
          units={units}
          rows={rows}
          totalCostGhs={totalCostGhs}
        />
      )}
    </div>
  );
}
