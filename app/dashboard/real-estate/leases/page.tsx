import { createAdminClient } from "@/utils/supabase/admin";
import { fetchLandlordListRows } from "@/utils/landlord-management";
import {
  fetchLeasesForLandlord,
  fetchLesseeOptionsForLandlord,
  fetchVacantUnitsForLandlord,
} from "@/utils/lease-management";
import { fetchRentalApplicationDetail } from "@/utils/rental-application-management";
import { filterDavorsManagedLandlords } from "../landlords-utils";
import RealEstateShell from "../real-estate-shell";
import Leases, { type LeaseApplicationPrefill } from "../leases";

type LeasesPageProps = {
  searchParams: Promise<{ landlord?: string; application?: string }>;
};

export default async function LeasesPage({ searchParams }: LeasesPageProps) {
  const { landlord: landlordParam, application: applicationParam } =
    await searchParams;
  const requestedLandlordId = landlordParam?.trim() || null;
  const applicationId = applicationParam?.trim() || null;

  const admin = createAdminClient();
  const { rows: allLandlords, fetchError: landlordsError } =
    await fetchLandlordListRows(admin);
  const landlords = filterDavorsManagedLandlords(allLandlords);
  const selectedLandlordId =
    requestedLandlordId &&
    landlords.some((row) => row.tenantId === requestedLandlordId)
      ? requestedLandlordId
      : null;

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
  let applicationPrefill: LeaseApplicationPrefill | null = null;

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

    if (applicationId) {
      const { detail } = await fetchRentalApplicationDetail(
        admin,
        selectedLandlordId,
        applicationId,
      );
      if (
        detail &&
        detail.status === "approved" &&
        !detail.leaseId
      ) {
        applicationPrefill = {
          applicationId: detail.applicationId,
          unitId: detail.unitId,
          fullName: detail.fullName,
          phone: detail.phone,
          email: detail.email,
          desiredMoveIn: detail.desiredMoveIn,
          baseRentGhs: detail.baseRentGhs,
          propertyName: detail.propertyName,
          unitNumber: detail.unitNumber,
        };

        // Ensure held unit appears in the unit picker.
        if (!vacantUnits.some((unit) => unit.unitId === detail.unitId)) {
          vacantUnits = [
            {
              unitId: detail.unitId,
              unitNumber: detail.unitNumber,
              propertyId: detail.propertyId,
              propertyName: detail.propertyName,
              baseRentGhs: detail.baseRentGhs ?? 0,
            },
            ...vacantUnits,
          ];
        }
      }
    }
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
        applicationPrefill={applicationPrefill}
      />
    </RealEstateShell>
  );
}
