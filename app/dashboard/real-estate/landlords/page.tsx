import { createAdminClient } from "@/utils/supabase/admin";
import { fetchLandlordListRows } from "@/utils/landlord-management";
import RealEstateShell from "../real-estate-shell";
import Landlords from "../landlords";

type LandlordsPageProps = {
  searchParams: Promise<{ highlight?: string }>;
};

export default async function LandlordsPage({
  searchParams,
}: LandlordsPageProps) {
  const { highlight: highlightParam } = await searchParams;
  const highlightTenantId = highlightParam?.trim() || null;
  const admin = createAdminClient();
  const { rows, fetchError } = await fetchLandlordListRows(admin);

  return (
    <RealEstateShell sectionTitle="Landlords">
      <Landlords
        initialRows={rows}
        fetchError={fetchError}
        highlightTenantId={highlightTenantId}
      />
    </RealEstateShell>
  );
}
