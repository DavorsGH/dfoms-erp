import { redirect } from "next/navigation";
import { createAdminClient } from "@/utils/supabase/admin";
import { getFacilityManagerSession } from "@/utils/facility-portal-auth";
import {
  fetchFacilityManagerCollections,
  fetchFacilityOutstandingRentLedger,
} from "@/utils/facility-portal-data";
import {
  portalCompactSectionClassName,
  portalErrorBannerClassName,
  portalPageClassName,
  portalSectionTitleClassName,
} from "../portal-ui";
import FacilityCollectionsClient from "./collections-client";

export default async function FacilityPortalCollectionsPage() {
  const session = await getFacilityManagerSession();
  if (!session) {
    redirect("/facility-portal/login");
  }
  if (!session.canCollectRent && !session.canCollectCharges) {
    redirect("/facility-portal/dashboard");
  }

  const admin = createAdminClient();
  const [
    { rows: outstanding, error: outstandingError },
    { rows: history, error: historyError },
  ] = await Promise.all([
    fetchFacilityOutstandingRentLedger(admin, session),
    fetchFacilityManagerCollections(admin, session),
  ]);

  const loadError = outstandingError ?? historyError;

  return (
    <div className={portalPageClassName}>
      <section className={portalCompactSectionClassName}>
        <h1 className={portalSectionTitleClassName}>Collections</h1>
        <p className="text-sm text-slate-600">
          Record cash, mobile money, or bank transfer collections. Payments stay
          pending until your landlord confirms them.
        </p>
      </section>

      {loadError ? (
        <div className={portalErrorBannerClassName}>{loadError}</div>
      ) : (
        <FacilityCollectionsClient
          outstanding={outstanding}
          history={history}
          canCollectRent={session.canCollectRent}
          canCollectCharges={session.canCollectCharges}
        />
      )}
    </div>
  );
}
