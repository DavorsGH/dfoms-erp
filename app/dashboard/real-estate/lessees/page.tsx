import { createAdminClient } from "@/utils/supabase/admin";
import { fetchLandlordListRows } from "@/utils/landlord-management";
import { fetchLesseesForLandlord } from "@/utils/lessee-management";
import { filterDavorsManagedLandlords } from "../landlords-utils";
import RealEstateShell from "../real-estate-shell";
import Lessees from "../lessees";

type LesseesPageProps = {
  searchParams: Promise<{ landlord?: string }>;
};

export default async function LesseesPage({ searchParams }: LesseesPageProps) {
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

  let lesseeRows = [] as Awaited<
    ReturnType<typeof fetchLesseesForLandlord>
  >["rows"];
  let lesseesError: string | null = null;

  if (selectedLandlordId) {
    const result = await fetchLesseesForLandlord(admin, selectedLandlordId);
    lesseeRows = result.rows;
    lesseesError = result.fetchError;
  }

  return (
    <RealEstateShell sectionTitle="Tenants">
      <Lessees
        landlords={landlords}
        selectedLandlordId={selectedLandlordId}
        initialRows={lesseeRows}
        landlordsError={landlordsError}
        lesseesError={lesseesError}
      />
    </RealEstateShell>
  );
}
