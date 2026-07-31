import { createAdminClient } from "@/utils/supabase/admin";
import { fetchLandlordListRows } from "@/utils/landlord-management";
import {
  fetchEscrowBalanceForLandlord,
  fetchLandlordPayoutContext,
  fetchPayoutsForLandlord,
} from "@/utils/payout-management";
import {
  filterDavorsManagedLandlords,
  type LandlordType,
} from "../landlords-utils";
import RealEstateShell from "../real-estate-shell";
import Payouts from "../payouts";

type PayoutsPageProps = {
  searchParams: Promise<{ landlord?: string }>;
};

export default async function PayoutsPage({ searchParams }: PayoutsPageProps) {
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

  let payoutRows = [] as Awaited<
    ReturnType<typeof fetchPayoutsForLandlord>
  >["rows"];
  let landlordType: LandlordType | null = null;
  let managementFeePercent: number | null = null;
  let escrowBalanceGhs = 0;
  let payoutsError: string | null = null;

  if (selectedLandlordId) {
    const [payoutsResult, contextResult, escrowResult] = await Promise.all([
      fetchPayoutsForLandlord(admin, selectedLandlordId),
      fetchLandlordPayoutContext(admin, selectedLandlordId),
      fetchEscrowBalanceForLandlord(admin, selectedLandlordId),
    ]);
    payoutRows = payoutsResult.rows;
    landlordType = contextResult.context?.landlordType ?? null;
    managementFeePercent =
      contextResult.context?.managementFeePercent ?? null;
    escrowBalanceGhs = escrowResult.balanceGhs;
    payoutsError =
      payoutsResult.fetchError ??
      contextResult.fetchError ??
      escrowResult.fetchError;
  }

  return (
    <RealEstateShell sectionTitle="Payouts">
      <Payouts
        landlords={landlords}
        selectedLandlordId={selectedLandlordId}
        landlordType={landlordType}
        managementFeePercent={managementFeePercent}
        initialRows={payoutRows}
        escrowBalanceGhs={escrowBalanceGhs}
        landlordsError={landlordsError}
        payoutsError={payoutsError}
      />
    </RealEstateShell>
  );
}
