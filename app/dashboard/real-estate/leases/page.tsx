import { createAdminClient } from "@/utils/supabase/admin";
import { fetchLandlordListRows } from "@/utils/landlord-management";
import {
  fetchLeasesForLandlord,
  fetchLesseeOptionsForLandlord,
  fetchVacantUnitsForLandlord,
} from "@/utils/lease-management";
import RealEstateShell from "../real-estate-shell";
import Leases from "../leases";

type LeasesPageProps = {
  searchParams: Promise<{ landlord?: string }>;
};

export default async function LeasesPage({ searchParams }: LeasesPageProps) {
  const { landlord: landlordParam } = await searchParams;
  const selectedLandlordId = landlordParam?.trim() || null;

  const admin = createAdminClient();
  const { rows: landlords, fetchError: landlordsError } =
    await fetchLandlordListRows(admin);

  let leaseRows = [] as Awaited<
    ReturnType<typeof fetchLeasesForLandlord>
  >["rows"];
  let vacantUnits = [] as Awaited<
    ReturnType<typeof fetchVacantUnitsForLandlord>
  >["units"];
  let lesseeOptions = [] as Awaited<
    ReturnType<typeof fetchLesseeOptionsForLandlord>
  >["lessees"];
  let leasesError: string | null = null;

  if (selectedLandlordId) {
    const [leasesResult, unitsResult, lesseesResult] = await Promise.all([
      fetchLeasesForLandlord(admin, selectedLandlordId),
      fetchVacantUnitsForLandlord(admin, selectedLandlordId),
      fetchLesseeOptionsForLandlord(admin, selectedLandlordId),
    ]);
    leaseRows = leasesResult.rows;
    vacantUnits = unitsResult.units;
    lesseeOptions = lesseesResult.lessees;
    leasesError =
      leasesResult.fetchError ??
      unitsResult.fetchError ??
      lesseesResult.fetchError;
  }

  return (
    <RealEstateShell sectionTitle="Leases">
      <Leases
        landlords={landlords}
        selectedLandlordId={selectedLandlordId}
        initialRows={leaseRows}
        vacantUnits={vacantUnits}
        lesseeOptions={lesseeOptions}
        landlordsError={landlordsError}
        leasesError={leasesError}
      />
    </RealEstateShell>
  );
}
