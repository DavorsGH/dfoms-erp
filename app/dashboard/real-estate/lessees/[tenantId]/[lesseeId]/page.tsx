import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/utils/supabase/admin";
import { fetchLesseeDetail } from "@/utils/lessee-management";
import RealEstateShell from "../../../real-estate-shell";
import LesseeDetailView from "../../../lessee-detail";

type LesseeDetailPageProps = {
  params: Promise<{ tenantId: string; lesseeId: string }>;
};

export default async function LesseeDetailPage({
  params,
}: LesseeDetailPageProps) {
  const { tenantId, lesseeId } = await params;
  const admin = createAdminClient();
  const { detail, fetchError } = await fetchLesseeDetail(
    admin,
    tenantId,
    lesseeId,
  );

  if (!detail) {
    if (fetchError) {
      return (
        <RealEstateShell sectionTitle="Tenant Detail">
          <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {fetchError}
          </p>
          <Link
            href="/dashboard/real-estate/lessees"
            className="mt-4 inline-block text-sm font-medium text-[#0f2744] hover:underline"
          >
            ← Back to Tenants
          </Link>
        </RealEstateShell>
      );
    }
    notFound();
  }

  return (
    <RealEstateShell sectionTitle={detail.fullName}>
      <LesseeDetailView initialDetail={detail} fetchError={fetchError} />
    </RealEstateShell>
  );
}
