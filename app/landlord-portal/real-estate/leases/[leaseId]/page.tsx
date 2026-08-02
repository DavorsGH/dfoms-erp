import Link from "next/link";
import { redirect } from "next/navigation";
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
import {
  portalErrorBannerClassName,
  portalSectionClassName,
  portalSectionTitleClassName,
} from "../../../portal-ui";
import LandlordPortalPendingApprovalView from "../../../pending-approval-view";

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
      <section className={portalSectionClassName}>
        <p className="text-sm text-slate-600">Lease not found.</p>
        <Link
          href="/landlord-portal/real-estate/leases"
          className="mt-3 inline-block text-sm text-[#0f2744] hover:underline"
        >
          Back to leases
        </Link>
      </section>
    );
  }

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
          Full lease terms (read-only).
        </p>
      </div>

      {fetchError ? (
        <div className={portalErrorBannerClassName}>{fetchError}</div>
      ) : null}

      {detail ? (
        <>
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
            ) : (
              <p className="mt-4 text-sm text-slate-600">
                No security deposit on record for this lease.
              </p>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}
