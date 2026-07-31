import { createAdminClient } from "@/utils/supabase/admin";
import { fetchLandlordListRows } from "@/utils/landlord-management";
import {
  fetchInspectionLeaseOptionsForLandlord,
  fetchInspectionsForLandlord,
} from "@/utils/inspection-management";
import { filterDavorsManagedLandlords } from "../landlords-utils";
import RealEstateShell from "../real-estate-shell";
import Inspections from "../inspections";

type InspectionsPageProps = {
  searchParams: Promise<{ landlord?: string }>;
};

export default async function InspectionsPage({
  searchParams,
}: InspectionsPageProps) {
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

  let inspectionRows = [] as Awaited<
    ReturnType<typeof fetchInspectionsForLandlord>
  >["rows"];
  let leaseOptions = [] as Awaited<
    ReturnType<typeof fetchInspectionLeaseOptionsForLandlord>
  >["leases"];
  let inspectionsError: string | null = null;

  if (selectedLandlordId) {
    const [inspectionsResult, leasesResult] = await Promise.all([
      fetchInspectionsForLandlord(admin, selectedLandlordId),
      fetchInspectionLeaseOptionsForLandlord(admin, selectedLandlordId),
    ]);
    inspectionRows = inspectionsResult.rows;
    leaseOptions = leasesResult.leases;
    inspectionsError =
      inspectionsResult.fetchError ?? leasesResult.fetchError;
  }

  return (
    <RealEstateShell sectionTitle="Inspections">
      <Inspections
        landlords={landlords}
        selectedLandlordId={selectedLandlordId}
        initialRows={inspectionRows}
        leaseOptions={leaseOptions}
        landlordsError={landlordsError}
        inspectionsError={inspectionsError}
      />
    </RealEstateShell>
  );
}
