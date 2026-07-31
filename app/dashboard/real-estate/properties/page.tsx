import { createAdminClient } from "@/utils/supabase/admin";
import { fetchLandlordListRows } from "@/utils/landlord-management";
import { fetchPropertiesForLandlord } from "@/utils/property-management";
import RealEstateShell from "../real-estate-shell";
import Properties from "../properties";

type PropertiesPageProps = {
  searchParams: Promise<{ landlord?: string }>;
};

export default async function PropertiesPage({
  searchParams,
}: PropertiesPageProps) {
  const { landlord: landlordParam } = await searchParams;
  const selectedLandlordId = landlordParam?.trim() || null;

  const admin = createAdminClient();
  const { rows: landlords, fetchError: landlordsError } =
    await fetchLandlordListRows(admin);

  let propertyRows = [] as Awaited<
    ReturnType<typeof fetchPropertiesForLandlord>
  >["rows"];
  let propertiesError: string | null = null;

  if (selectedLandlordId) {
    const result = await fetchPropertiesForLandlord(admin, selectedLandlordId);
    propertyRows = result.rows;
    propertiesError = result.fetchError;
  }

  return (
    <RealEstateShell sectionTitle="Properties">
      <Properties
        landlords={landlords}
        selectedLandlordId={selectedLandlordId}
        initialRows={propertyRows}
        landlordsError={landlordsError}
        propertiesError={propertiesError}
      />
    </RealEstateShell>
  );
}
