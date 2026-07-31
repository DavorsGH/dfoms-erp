import { createAdminClient } from "@/utils/supabase/admin";
import { fetchLandlordListRows } from "@/utils/landlord-management";
import { fetchLesseesForLandlord } from "@/utils/lessee-management";
import RealEstateShell from "../real-estate-shell";
import Lessees from "../lessees";

type LesseesPageProps = {
  searchParams: Promise<{ landlord?: string }>;
};

export default async function LesseesPage({ searchParams }: LesseesPageProps) {
  const { landlord: landlordParam } = await searchParams;
  const selectedLandlordId = landlordParam?.trim() || null;

  const admin = createAdminClient();
  const { rows: landlords, fetchError: landlordsError } =
    await fetchLandlordListRows(admin);

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
