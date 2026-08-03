import Link from "next/link";
import { NotificationTargetUnavailablePanel } from "@/components/notification-target-unavailable";
import { createAdminClient } from "@/utils/supabase/admin";
import { fetchLandlordDetail } from "@/utils/landlord-management";
import RealEstateShell from "../../real-estate-shell";
import LandlordDetailView from "../../landlord-detail";

type LandlordDetailPageProps = {
  params: Promise<{ tenantId: string }>;
};

export default async function LandlordDetailPage({
  params,
}: LandlordDetailPageProps) {
  const { tenantId } = await params;
  const admin = createAdminClient();
  const { detail, fetchError } = await fetchLandlordDetail(admin, tenantId);

  if (!detail) {
    if (fetchError) {
      return (
        <RealEstateShell sectionTitle="Landlord Detail">
          <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {fetchError}
          </p>
          <Link
            href="/dashboard/real-estate/landlords"
            className="mt-4 inline-block text-sm font-medium text-[#0f2744] hover:underline"
          >
            ← Back to Landlords
          </Link>
        </RealEstateShell>
      );
    }
    return (
      <RealEstateShell sectionTitle="Landlord Detail">
        <NotificationTargetUnavailablePanel
          backHref="/dashboard/real-estate/landlords"
          backLabel="Back to Landlords"
        />
      </RealEstateShell>
    );
  }

  return (
    <RealEstateShell sectionTitle={detail.name}>
      <LandlordDetailView initialDetail={detail} fetchError={fetchError} />
    </RealEstateShell>
  );
}
