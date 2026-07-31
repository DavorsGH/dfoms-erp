import { createAdminClient } from "@/utils/supabase/admin";
import { fetchLandlordListRows } from "@/utils/landlord-management";
import {
  fetchLandlordTypeForTenant,
  fetchRentLedgerForLandlord,
} from "@/utils/rent-ledger-management";
import RealEstateShell from "../real-estate-shell";
import RentLedger from "../rent-ledger";

type RentLedgerPageProps = {
  searchParams: Promise<{ landlord?: string }>;
};

export default async function RentLedgerPage({
  searchParams,
}: RentLedgerPageProps) {
  const { landlord: landlordParam } = await searchParams;
  const selectedLandlordId = landlordParam?.trim() || null;

  const admin = createAdminClient();
  const { rows: landlords, fetchError: landlordsError } =
    await fetchLandlordListRows(admin);

  let ledgerRows = [] as Awaited<
    ReturnType<typeof fetchRentLedgerForLandlord>
  >["rows"];
  let landlordType = null as Awaited<
    ReturnType<typeof fetchLandlordTypeForTenant>
  >["landlordType"];
  let ledgerError: string | null = null;

  if (selectedLandlordId) {
    const [ledgerResult, typeResult] = await Promise.all([
      fetchRentLedgerForLandlord(admin, selectedLandlordId),
      fetchLandlordTypeForTenant(admin, selectedLandlordId),
    ]);
    ledgerRows = ledgerResult.rows;
    landlordType = typeResult.landlordType;
    ledgerError = ledgerResult.fetchError ?? typeResult.fetchError;
  }

  return (
    <RealEstateShell sectionTitle="Rent Ledger">
      <RentLedger
        landlords={landlords}
        selectedLandlordId={selectedLandlordId}
        landlordType={landlordType}
        initialRows={ledgerRows}
        landlordsError={landlordsError}
        ledgerError={ledgerError}
      />
    </RealEstateShell>
  );
}
