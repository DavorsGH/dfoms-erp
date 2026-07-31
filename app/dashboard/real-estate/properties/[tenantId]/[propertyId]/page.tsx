import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/utils/supabase/admin";
import { fetchPropertyDetail } from "@/utils/property-management";
import RealEstateShell from "../../../real-estate-shell";
import PropertyDetailView from "../../../property-detail";

type PropertyDetailPageProps = {
  params: Promise<{ tenantId: string; propertyId: string }>;
};

export default async function PropertyDetailPage({
  params,
}: PropertyDetailPageProps) {
  const { tenantId, propertyId } = await params;
  const admin = createAdminClient();
  const { detail, fetchError } = await fetchPropertyDetail(
    admin,
    tenantId,
    propertyId,
  );

  if (!detail) {
    if (fetchError) {
      return (
        <RealEstateShell sectionTitle="Property Detail">
          <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {fetchError}
          </p>
          <Link
            href="/dashboard/real-estate/properties"
            className="mt-4 inline-block text-sm font-medium text-[#0f2744] hover:underline"
          >
            ← Back to Properties
          </Link>
        </RealEstateShell>
      );
    }
    notFound();
  }

  return (
    <RealEstateShell sectionTitle={detail.property.name}>
      <PropertyDetailView initialDetail={detail} fetchError={fetchError} />
    </RealEstateShell>
  );
}
