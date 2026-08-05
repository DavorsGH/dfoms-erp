import Link from "next/link";
import { TenantLogosMediaLink } from "@/components/tenant-logos-media";
import { NotificationTargetUnavailablePanel } from "@/components/notification-target-unavailable";
import { createAdminClient } from "@/utils/supabase/admin";
import { fetchRentalApplicationDetail } from "@/utils/rental-application-management";
import { filterDavorsManagedLandlords } from "../../../landlords-utils";
import { fetchLandlordListRows } from "@/utils/landlord-management";
import {
  formatApplicationDate,
  formatApplicationMoney,
  formatRentalApplicationStatus,
} from "../../../applications-utils";
import RealEstateShell from "../../../real-estate-shell";

type PageProps = {
  params: Promise<{ tenantId: string; applicationId: string }>;
};

export default async function StaffApplicationDetailPage({
  params,
}: PageProps) {
  const { tenantId, applicationId } = await params;
  const admin = createAdminClient();

  const { rows: allLandlords } = await fetchLandlordListRows(admin);
  const managed = filterDavorsManagedLandlords(allLandlords);
  const landlord = managed.find((row) => row.tenantId === tenantId);
  if (!landlord) {
    return (
      <RealEstateShell sectionTitle="Application">
        <NotificationTargetUnavailablePanel
          backHref="/dashboard/real-estate/applications"
          backLabel="Back to Applications"
        />
      </RealEstateShell>
    );
  }

  const { detail, error } = await fetchRentalApplicationDetail(
    admin,
    tenantId,
    applicationId,
    {
      landlordName: landlord.name,
      landlordType: landlord.landlordType,
    },
  );

  if (error) {
    return (
      <RealEstateShell sectionTitle="Application">
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      </RealEstateShell>
    );
  }
  if (!detail) {
    return (
      <RealEstateShell sectionTitle="Application">
        <NotificationTargetUnavailablePanel
          backHref="/dashboard/real-estate/applications"
          backLabel="Back to Applications"
        />
      </RealEstateShell>
    );
  }

  const createLeaseHref = `/dashboard/real-estate/leases?landlord=${encodeURIComponent(tenantId)}&application=${encodeURIComponent(applicationId)}`;

  return (
    <RealEstateShell sectionTitle="Application">
      <div className="space-y-4">
        <div>
          <Link
            href="/dashboard/real-estate/applications"
            className="text-sm text-[#0f2744] underline"
          >
            ← Applications
          </Link>
          <h2 className="mt-2 text-lg font-semibold text-[#0f2744]">
            {detail.fullName}
          </h2>
          <p className="text-sm text-slate-600">
            {detail.landlordName} · {detail.propertyName} / Unit{" "}
            {detail.unitNumber} ·{" "}
            {formatRentalApplicationStatus(detail.status)}
          </p>
        </div>

        <div className="rounded-md border border-slate-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Staff view is read-only. Decisions are made in the Landlord Portal.
          {detail.status === "approved" && !detail.leaseId ? (
            <>
              {" "}
              <Link
                href={createLeaseHref}
                className="font-medium text-[#0f2744] underline"
              >
                Create lease from application
              </Link>
            </>
          ) : null}
        </div>

        <section className="space-y-2 rounded-md border border-slate-200 bg-white p-4 text-sm">
          <h3 className="font-semibold text-[#0f2744]">Applicant packet</h3>
          <p>Phone: {detail.phone}</p>
          <p>Email: {detail.email ?? "—"}</p>
          <p>National ID: {detail.nationalId ?? "—"}</p>
          <p>
            Desired move-in: {formatApplicationDate(detail.desiredMoveIn)}
          </p>
          <p>
            Household: {detail.householdSize ?? "—"}
            {detail.hasPets
              ? ` · Pets: ${detail.petDetails || "Yes"}`
              : " · No pets"}
          </p>
          <p>
            Employer: {detail.employerName ?? "—"} ({detail.jobTitle ?? "—"})
          </p>
          <p>
            Monthly income: {formatApplicationMoney(detail.monthlyIncomeGhs)}
          </p>
          <p className="whitespace-pre-wrap">
            References: {detail.referencesText ?? "—"}
          </p>
          {detail.idDocumentUrls.length > 0 ? (
            <ul className="list-disc pl-5">
              {detail.idDocumentUrls.map((reference) => (
                <li key={reference}>
                  <TenantLogosMediaLink
                    reference={reference}
                    tenantId={tenantId}
                    className="text-[#0f2744] underline"
                  >
                    ID document
                  </TenantLogosMediaLink>
                </li>
              ))}
            </ul>
          ) : null}
          {detail.landlordNotes ? (
            <p>Landlord notes: {detail.landlordNotes}</p>
          ) : null}
          {detail.leaseId ? (
            <p>
              Lease:{" "}
              <Link
                href={`/dashboard/real-estate/leases/${tenantId}/${detail.leaseId}`}
                className="text-[#0f2744] underline"
              >
                Open
              </Link>
            </p>
          ) : null}
        </section>
      </div>
    </RealEstateShell>
  );
}
