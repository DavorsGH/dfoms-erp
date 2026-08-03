import { NotificationTargetUnavailableBanner } from "@/components/notification-target-unavailable";
import { createAdminClient } from "@/utils/supabase/admin";
import { fetchLandlordListRows } from "@/utils/landlord-management";
import { fetchComplaintsForLandlord } from "@/utils/complaint-management";
import { filterDavorsManagedLandlords } from "../landlords-utils";
import RealEstateShell from "../real-estate-shell";
import ComplaintsView from "../complaints";

type ComplaintsPageProps = {
  searchParams: Promise<{ landlord?: string }>;
};

export default async function ComplaintsPage({
  searchParams,
}: ComplaintsPageProps) {
  const { landlord: landlordParam } = await searchParams;
  const admin = createAdminClient();
  const { rows: landlordRows, fetchError: landlordsError } =
    await fetchLandlordListRows(admin);
  const landlords = filterDavorsManagedLandlords(landlordRows);

  const requestedId = landlordParam?.trim() || null;
  const selectedLandlordId =
    requestedId && landlords.some((row) => row.tenantId === requestedId)
      ? requestedId
      : null;
  const landlordMissing = requestedId != null && selectedLandlordId == null;

  const { rows, fetchError: complaintsError } = selectedLandlordId
    ? await fetchComplaintsForLandlord(admin, selectedLandlordId)
    : { rows: [], fetchError: null };

  return (
    <RealEstateShell sectionTitle="Complaints">
      {landlordMissing ? (
        <div className="mb-4">
          <NotificationTargetUnavailableBanner />
        </div>
      ) : null}
      <ComplaintsView
        landlords={landlords}
        selectedLandlordId={selectedLandlordId}
        initialRows={rows}
        landlordsError={landlordsError}
        complaintsError={complaintsError}
      />
    </RealEstateShell>
  );
}
