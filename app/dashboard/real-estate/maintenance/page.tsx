import { NotificationTargetUnavailableBanner } from "@/components/notification-target-unavailable";
import { createAdminClient } from "@/utils/supabase/admin";
import { fetchLandlordListRows } from "@/utils/landlord-management";
import {
  fetchActiveLeaseOptionsForLandlord,
  fetchMaintenanceRequestsForLandlord,
} from "@/utils/maintenance-management";
import { filterDavorsManagedLandlords } from "../landlords-utils";
import RealEstateShell from "../real-estate-shell";
import Maintenance from "../maintenance";

type MaintenancePageProps = {
  searchParams: Promise<{ landlord?: string }>;
};

export default async function MaintenancePage({
  searchParams,
}: MaintenancePageProps) {
  const { landlord: landlordParam } = await searchParams;
  const requestedLandlordId = landlordParam?.trim() || null;

  const admin = createAdminClient();
  const { rows: allLandlords, fetchError: landlordsError } =
    await fetchLandlordListRows(admin);
  const landlords = filterDavorsManagedLandlords(allLandlords);
  const selectedLandlordId =
    requestedLandlordId &&
    landlords.some((row) => row.tenantId === requestedLandlordId)
      ? requestedLandlordId
      : null;
  const landlordMissing =
    requestedLandlordId != null && selectedLandlordId == null;

  let requestRows = [] as Awaited<
    ReturnType<typeof fetchMaintenanceRequestsForLandlord>
  >["rows"];
  let activeLeases = [] as Awaited<
    ReturnType<typeof fetchActiveLeaseOptionsForLandlord>
  >["leases"];
  let maintenanceError: string | null = null;

  if (selectedLandlordId) {
    const [requestsResult, leasesResult] = await Promise.all([
      fetchMaintenanceRequestsForLandlord(admin, selectedLandlordId),
      fetchActiveLeaseOptionsForLandlord(admin, selectedLandlordId),
    ]);
    requestRows = requestsResult.rows;
    activeLeases = leasesResult.leases;
    maintenanceError =
      requestsResult.fetchError ?? leasesResult.fetchError;
  }

  return (
    <RealEstateShell sectionTitle="Maintenance">
      {landlordMissing ? (
        <div className="mb-4">
          <NotificationTargetUnavailableBanner />
        </div>
      ) : null}
      <Maintenance
        landlords={landlords}
        selectedLandlordId={selectedLandlordId}
        initialRows={requestRows}
        activeLeases={activeLeases}
        landlordsError={landlordsError}
        maintenanceError={maintenanceError}
      />
    </RealEstateShell>
  );
}
