import { createAdminClient } from "@/utils/supabase/admin";
import { fetchLandlordListRows } from "@/utils/landlord-management";
import RealEstateShell from "../real-estate-shell";
import Landlords from "../landlords";

export default async function LandlordsPage() {
  const admin = createAdminClient();
  const { rows, fetchError } = await fetchLandlordListRows(admin);

  return (
    <RealEstateShell sectionTitle="Landlords">
      <Landlords initialRows={rows} fetchError={fetchError} />
    </RealEstateShell>
  );
}
