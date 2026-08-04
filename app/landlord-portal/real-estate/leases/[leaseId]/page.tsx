import Link from "next/link";
import { redirect } from "next/navigation";
import { NotificationTargetUnavailablePanel } from "@/components/notification-target-unavailable";
import {
  getLandlordPortalSession,
  landlordPortalHasDataAccess,
} from "@/utils/landlord-portal-auth";
import { createAdminClient } from "@/utils/supabase/admin";
import { fetchLeaseDetail } from "@/utils/lease-management";
import {
  formatDepositStatus,
  formatLeaseDate,
  formatLeaseMoney,
  formatLeaseStatus,
} from "@/app/dashboard/real-estate/leases-utils";
import LeaseSignaturePanel from "@/app/dashboard/real-estate/lease-signature-panel";
import {
  portalErrorBannerClassName,
  portalSectionClassName,
  portalSectionTitleClassName,
} from "../../../portal-ui";
import LandlordPortalPendingApprovalView from "../../../pending-approval-view";
import LandlordPortalLeaseEditForm from "../lease-edit-form";
import OneTimeChargeForm from "@/app/dashboard/real-estate/one-time-charge-form";
import MoveInConditionPhotosPanel from "@/app/dashboard/real-estate/move-in-condition-photos-panel";
import FileComplaintForm from "@/app/dashboard/real-estate/file-complaint-form";

type PageProps = {
  params: Promise<{ leaseId: string }>;
};

function DetailItem({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="mt-1 text-sm text-slate-900">{value}</dd>
    </div>
  );
}

export default async function LandlordPortalLeaseDetailPage({
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

  const { leaseId } = await params;
  const admin = createAdminClient();
  const { detail, fetchError } = await fetchLeaseDetail(
    admin,
    session.tenantId,
    leaseId,
  );

  if (!detail && !fetchError) {
    return (
      <NotificationTargetUnavailablePanel
        backHref="/landlord-portal/real-estate/leases"
        backLabel="Back to leases"
      />
    );
  }

  const canManage = session.landlordType === "platform_only";
  const lateFeeLabel = !detail?.lateFeeEnabled
    ? "Disabled"
    : detail.lateFeeType === "percent"
      ? `${detail.lateFeeAmount ?? 0}%`
      : formatLeaseMoney(detail.lateFeeAmount ?? 0);

  return (
    <div className="space-y-4">
      <div>
        <Link
          href="/landlord-portal/real-estate/leases"
          className="text-sm text-[#0f2744] hover:underline"
        >
          ← Leases
        </Link>
        <h1 className="mt-2 text-xl font-semibold text-[#0f2744]">
          {detail ? `${detail.lesseeName} · Unit ${detail.unitNumber}` : "Lease"}
        </h1>
        <p className="mt-1 text-sm text-slate-600">
          {canManage
            ? "Full lease terms. Edit rent and terms below."
            : "Full lease terms (read-only — Davors staff manages changes)."}
        </p>
      </div>

      {fetchError ? (
        <div className={portalErrorBannerClassName}>{fetchError}</div>
      ) : null}

      {detail && canManage ? (
        <LandlordPortalLeaseEditForm detail={detail} />
      ) : null}

      {detail ? (
        <>
          <LeaseSignaturePanel
            mode={canManage ? "landlord_manage" : "landlord_view"}
            tenantId={detail.tenantId}
            leaseId={detail.leaseId}
            signatureStatus={detail.signatureStatus}
            landlordAcknowledgedAt={detail.landlordAcknowledgedAt}
            tenantAcknowledgedAt={detail.tenantAcknowledgedAt}
            landlordName={detail.landlordName}
            landlordAddress={detail.landlordAddress}
            landlordPhone={detail.landlordPhone}
            lesseeName={detail.lesseeName}
            lesseePhone={detail.lesseePhone}
            lesseeEmail={detail.lesseeEmail}
            propertyName={detail.propertyName}
            propertyAddress={detail.propertyAddress}
            propertyLocation={detail.propertyLocation}
            unitNumber={detail.unitNumber}
            startDate={detail.startDate}
            endDate={detail.endDate}
            rentAmountGhs={detail.rentAmountGhs}
            advanceRentAmountGhs={detail.advanceRentAmountGhs}
            terminationNoticeMonths={detail.terminationNoticeMonths}
            depositAmountGhs={detail.deposit?.amountGhs ?? null}
            agreementDate={detail.createdAt}
            leaseDocumentUrl={detail.leaseDocumentUrl}
          />

          <section className={portalSectionClassName}>
            <h2 className={portalSectionTitleClassName}>Parties &amp; unit</h2>
            <dl className="mt-4 grid gap-4 sm:grid-cols-2">
              <DetailItem label="Tenant" value={detail.lesseeName} />
              <DetailItem
                label="Contact"
                value={[detail.lesseePhone, detail.lesseeEmail]
                  .filter(Boolean)
                  .join(" · ") || "—"}
              />
              <DetailItem label="Property" value={detail.propertyName} />
              <DetailItem label="Unit" value={detail.unitNumber} />
              <DetailItem
                label="Status"
                value={formatLeaseStatus(detail.status)}
              />
            </dl>
          </section>

          <section className={portalSectionClassName}>
            <h2 className={portalSectionTitleClassName}>Lease terms</h2>
            <dl className="mt-4 grid gap-4 sm:grid-cols-2">
              <DetailItem
                label="Start date"
                value={formatLeaseDate(detail.startDate)}
              />
              <DetailItem
                label="End date"
                value={formatLeaseDate(detail.endDate)}
              />
              <DetailItem
                label="Rent"
                value={formatLeaseMoney(detail.rentAmountGhs)}
              />
              <DetailItem
                label="Advance rent"
                value={formatLeaseMoney(detail.advanceRentAmountGhs)}
              />
              <DetailItem
                label="Termination notice"
                value={`${detail.terminationNoticeMonths} month${detail.terminationNoticeMonths === 1 ? "" : "s"}`}
              />
              <DetailItem
                label="Escalation"
                value={
                  detail.escalationPercent == null
                    ? "None"
                    : `${detail.escalationPercent}% every ${detail.escalationFrequencyMonths ?? "—"} months`
                }
              />
              <DetailItem label="Late fee" value={lateFeeLabel} />
              {detail.pendingRentAmountGhs != null ? (
                <DetailItem
                  label="Pending rent change"
                  value={`${formatLeaseMoney(detail.pendingRentAmountGhs)} (${detail.rentChangeStatus ?? "pending"})`}
                />
              ) : null}
              {detail.terminatedAt ? (
                <DetailItem
                  label="Terminated"
                  value={`${formatLeaseDate(detail.terminatedAt)}${detail.terminationReason ? ` · ${detail.terminationReason}` : ""}`}
                />
              ) : null}
            </dl>
          </section>

          <section className={portalSectionClassName}>
            <h2 className={portalSectionTitleClassName}>Security deposit</h2>
            {detail.deposit ? (
              <>
              <dl className="mt-4 grid gap-4 sm:grid-cols-2">
                <DetailItem
                  label="Amount held"
                  value={formatLeaseMoney(detail.deposit.amountGhs)}
                />
                <DetailItem
                  label="Status"
                  value={formatDepositStatus(detail.deposit.status)}
                />
                <DetailItem
                  label="Amount returned"
                  value={
                    detail.deposit.amountReturnedGhs == null
                      ? "—"
                      : formatLeaseMoney(detail.deposit.amountReturnedGhs)
                  }
                />
                <DetailItem
                  label="Notes"
                  value={detail.deposit.resolutionNotes ?? "—"}
                />
              </dl>
              <p className="mt-4 text-sm">
                <Link
                  href={`/landlord-portal/finance/deposits/${detail.deposit.depositId}`}
                  className="font-medium text-[#0f2744] hover:underline"
                >
                  View deposit collection / resolution records
                </Link>
              </p>
              </>
            ) : (
              <p className="mt-4 text-sm text-slate-600">
                No security deposit on record for this lease.
              </p>
            )}
          </section>

          {canManage ? (
            <section className={portalSectionClassName}>
              <h2 className={portalSectionTitleClassName}>Move-in condition</h2>
              <div className="mt-4">
                <MoveInConditionPhotosPanel
                  tenantId={detail.tenantId}
                  leaseId={detail.leaseId}
                  initialUrls={detail.moveInConditionPhotoUrls}
                  uploadPath="/api/landlord-portal/leases/upload-move-in-photo"
                />
              </div>
            </section>
          ) : detail.moveInConditionPhotoUrls.length > 0 ? (
            <section className={portalSectionClassName}>
              <h2 className={portalSectionTitleClassName}>Move-in condition</h2>
              <div className="mt-4">
                <MoveInConditionPhotosPanel
                  tenantId={detail.tenantId}
                  leaseId={detail.leaseId}
                  initialUrls={detail.moveInConditionPhotoUrls}
                  uploadPath="/api/landlord-portal/leases/upload-move-in-photo"
                  readOnly
                />
              </div>
            </section>
          ) : null}

          {canManage ? (
            <section className={portalSectionClassName}>
              <h2 className={portalSectionTitleClassName}>One-time charge</h2>
              <p className="mt-2 text-sm text-slate-600">
                Add an ad-hoc charge for this lease. Tenants see these under
                Other charges and can pay them with rent in one transaction.
              </p>
              <div className="mt-4">
                <OneTimeChargeForm
                  mode="landlord"
                  tenantId={detail.tenantId}
                  leaseId={detail.leaseId}
                  leaseActive={detail.status === "active"}
                />
              </div>
            </section>
          ) : (
            <section className={portalSectionClassName}>
              <h2 className={portalSectionTitleClassName}>One-time charge</h2>
              <p className="mt-4 text-sm text-slate-600">
                Davors staff create one-time charges for managed leases.
              </p>
            </section>
          )}

          {canManage ? (
            <section className={portalSectionClassName}>
              <h2 className={portalSectionTitleClassName}>File a complaint</h2>
              <p className="mt-2 text-sm text-slate-600">
                File a complaint about this tenant. They can respond from their
                tenant portal.
              </p>
              <div className="mt-4">
                <FileComplaintForm
                  mode="landlord"
                  tenantId={detail.tenantId}
                  leaseId={detail.leaseId}
                  leaseActive={detail.status === "active"}
                  variant="portal"
                />
              </div>
            </section>
          ) : null}
        </>
      ) : null}
    </div>
  );
}
