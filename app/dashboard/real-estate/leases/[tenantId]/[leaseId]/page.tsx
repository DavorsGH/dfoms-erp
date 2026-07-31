import Link from "next/link";
import { notFound } from "next/navigation";
import { createAdminClient } from "@/utils/supabase/admin";
import { fetchLeaseDetail } from "@/utils/lease-management";
import RealEstateShell from "../../../real-estate-shell";
import LeaseDetailView from "../../../lease-detail";

type LeaseDetailPageProps = {
  params: Promise<{ tenantId: string; leaseId: string }>;
  searchParams: Promise<{ resolveDeposit?: string }>;
};

export default async function LeaseDetailPage({
  params,
  searchParams,
}: LeaseDetailPageProps) {
  const { tenantId, leaseId } = await params;
  const { resolveDeposit } = await searchParams;
  const admin = createAdminClient();
  const { detail, fetchError } = await fetchLeaseDetail(
    admin,
    tenantId,
    leaseId,
  );

  if (!detail) {
    if (fetchError) {
      return (
        <RealEstateShell sectionTitle="Lease Detail">
          <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {fetchError}
          </p>
          <Link
            href="/dashboard/real-estate/leases"
            className="mt-4 inline-block text-sm font-medium text-[#0f2744] hover:underline"
          >
            ← Back to Leases
          </Link>
        </RealEstateShell>
      );
    }
    notFound();
  }

  return (
    <RealEstateShell
      sectionTitle={`${detail.propertyName} — ${detail.unitNumber}`}
    >
      <LeaseDetailView
        initialDetail={detail}
        fetchError={fetchError}
        focusDeposit={resolveDeposit === "1"}
      />
    </RealEstateShell>
  );
}
