import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  getLandlordPortalSession,
  landlordPortalHasDataAccess,
} from "@/utils/landlord-portal-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { fetchRentalApplicationDetail } from "@/utils/rental-application-management";
import {
  formatApplicationDate,
  formatApplicationMoney,
  formatRentalApplicationStatus,
} from "@/app/dashboard/real-estate/applications-utils";
import {
  portalSectionClassName,
  portalSectionTitleClassName,
} from "../../../portal-ui";
import LandlordPortalPendingApprovalView from "../../../pending-approval-view";
import ApplicationActions from "../application-actions";
import CreateLeaseFromApplicationForm from "../create-lease-form";

type PageProps = {
  params: Promise<{ applicationId: string }>;
};

export default async function LandlordPortalApplicationDetailPage({
  params,
}: PageProps) {
  const session = await getLandlordPortalSession();
  if (!session) {
    redirect("/landlord-portal/login");
  }

  if (!landlordPortalHasDataAccess(session)) {
    return (
      <LandlordPortalPendingApprovalView
        fullName={session.fullName}
        approvalStatus={session.approvalStatus}
      />
    );
  }

  const { applicationId } = await params;
  const admin = createAdminClient();
  const { detail, error } = await fetchRentalApplicationDetail(
    admin,
    session.tenantId,
    applicationId,
    {
      landlordName: session.fullName,
      landlordType: session.landlordType,
    },
  );

  if (error) {
    return (
      <div className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
        {error}
      </div>
    );
  }
  if (!detail) {
    notFound();
  }

  const canDecide = [
    "submitted",
    "under_review",
    "info_requested",
  ].includes(detail.status);

  const showPlatformLeaseCreate =
    session.landlordType === "platform_only" &&
    detail.status === "approved" &&
    !detail.leaseId;

  const showDavorsManagedHint =
    session.landlordType === "davors_managed" &&
    detail.status === "approved" &&
    !detail.leaseId;

  return (
    <div className="space-y-4">
      <div>
        <Link
          href="/landlord-portal/real-estate/applications"
          className="text-sm text-[#0f2744] underline"
        >
          ← Applications
        </Link>
        <h1 className={`${portalSectionTitleClassName} mt-2`}>
          {detail.fullName}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {detail.propertyName} / Unit {detail.unitNumber} ·{" "}
          {formatRentalApplicationStatus(detail.status)}
        </p>
      </div>

      <section className={`${portalSectionClassName} space-y-2 text-sm`}>
        <h2 className="font-semibold text-[#0f2744]">Applicant</h2>
        <p>
          <span className="text-slate-500">Phone:</span> {detail.phone}
        </p>
        <p>
          <span className="text-slate-500">Email:</span> {detail.email ?? "—"}
        </p>
        <p>
          <span className="text-slate-500">National ID:</span>{" "}
          {detail.nationalId ?? "—"}
        </p>
        <p>
          <span className="text-slate-500">Desired move-in:</span>{" "}
          {formatApplicationDate(detail.desiredMoveIn)}
        </p>
        <p>
          <span className="text-slate-500">Household:</span>{" "}
          {detail.householdSize ?? "—"}
          {detail.hasPets
            ? ` · Pets: ${detail.petDetails || "Yes"}`
            : " · No pets"}
        </p>
      </section>

      <section className={`${portalSectionClassName} space-y-2 text-sm`}>
        <h2 className="font-semibold text-[#0f2744]">Income & references</h2>
        <p>
          <span className="text-slate-500">Employer:</span>{" "}
          {detail.employerName ?? "—"} ({detail.jobTitle ?? "—"})
        </p>
        <p>
          <span className="text-slate-500">Monthly income:</span>{" "}
          {formatApplicationMoney(detail.monthlyIncomeGhs)}
        </p>
        <p>
          <span className="text-slate-500">Notes:</span>{" "}
          {detail.employmentNotes ?? "—"}
        </p>
        <p className="whitespace-pre-wrap">
          <span className="text-slate-500">References:</span>{" "}
          {detail.referencesText ?? "—"}
        </p>
      </section>

      {detail.idDocumentUrls.length > 0 ? (
        <section className={`${portalSectionClassName} space-y-2 text-sm`}>
          <h2 className="font-semibold text-[#0f2744]">ID documents</h2>
          <ul className="list-disc pl-5">
            {detail.idDocumentUrls.map((url) => (
              <li key={url}>
                <a
                  href={url}
                  target="_blank"
                  rel="noreferrer"
                  className="text-[#0f2744] underline"
                >
                  View document
                </a>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className={`${portalSectionClassName} space-y-2 text-sm`}>
        <h2 className="font-semibold text-[#0f2744]">Workflow</h2>
        <p>
          <span className="text-slate-500">Submitted:</span>{" "}
          {formatApplicationDate(detail.createdAt)}
        </p>
        <p>
          <span className="text-slate-500">Unit status:</span>{" "}
          {detail.unitStatus ?? "—"}
        </p>
        {detail.infoRequestMessage ? (
          <p>
            <span className="text-slate-500">Info requested:</span>{" "}
            {detail.infoRequestMessage}
          </p>
        ) : null}
        {detail.decisionReason ? (
          <p>
            <span className="text-slate-500">Decision reason:</span>{" "}
            {detail.decisionReason}
          </p>
        ) : null}
        {detail.landlordNotes ? (
          <p>
            <span className="text-slate-500">Notes:</span> {detail.landlordNotes}
          </p>
        ) : null}
        {detail.leaseId ? (
          <p>
            Lease created:{" "}
            <Link
              href={`/landlord-portal/real-estate/leases/${detail.leaseId}`}
              className="text-[#0f2744] underline"
            >
              Open lease
            </Link>
          </p>
        ) : null}
      </section>

      {canDecide ? (
        <ApplicationActions
          applicationId={detail.applicationId}
          canDecide
        />
      ) : null}

      {showPlatformLeaseCreate ? (
        <CreateLeaseFromApplicationForm
          applicationId={detail.applicationId}
          defaultRentGhs={detail.baseRentGhs}
          defaultStartDate={detail.desiredMoveIn}
          applicantName={detail.fullName}
        />
      ) : null}

      {showDavorsManagedHint ? (
        <section className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          Approved. Davors staff will create the lease from this application in
          the staff ERP (Create lease from application).
        </section>
      ) : null}
    </div>
  );
}
