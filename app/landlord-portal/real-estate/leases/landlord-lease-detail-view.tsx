"use client";

import { useState } from "react";
import Link from "next/link";
import {
  formatDepositStatus,
  formatLeaseDate,
  formatLeaseMoney,
  formatLeaseStatus,
  type LeaseDetail,
} from "@/app/dashboard/real-estate/leases-utils";
import LeaseSignaturePanel from "@/app/dashboard/real-estate/lease-signature-panel";
import OneTimeChargeForm from "@/app/dashboard/real-estate/one-time-charge-form";
import LeaseChargeSettingsPanel from "@/app/dashboard/real-estate/lease-charge-settings-panel";
import MoveInConditionPhotosPanel from "@/app/dashboard/real-estate/move-in-condition-photos-panel";
import FileComplaintForm from "@/app/dashboard/real-estate/file-complaint-form";
import {
  LeaseDetailSection,
  LeaseDetailTabs,
  LeaseSummaryItem,
  leasePageClassName,
  leaseSectionClassName,
  leaseSectionTitleClassName,
  leaseSummaryGridClassName,
  type LeaseDetailTabId,
} from "@/app/dashboard/real-estate/lease-detail-layout";
import type { LeaseChargeSettingRow } from "@/utils/lease-charge-categories";
import {
  portalErrorBannerClassName,
  portalSectionClassName,
  portalSectionTitleClassName,
} from "../../portal-ui";
import LandlordPortalLeaseEditForm from "./lease-edit-form";

type LandlordLeaseDetailViewProps = {
  detail: LeaseDetail | null;
  chargeSettings: LeaseChargeSettingRow[];
  canManage: boolean;
  fetchError: string | null;
};

function DetailItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-xs font-medium uppercase tracking-wide text-slate-500">
        {label}
      </dt>
      <dd className="mt-0.5 text-sm text-slate-900">{value}</dd>
    </div>
  );
}

export default function LandlordLeaseDetailView({
  detail,
  chargeSettings,
  canManage,
  fetchError,
}: LandlordLeaseDetailViewProps) {
  const [activeTab, setActiveTab] = useState<LeaseDetailTabId>("overview");

  if (!detail) {
    return (
      <div className={leasePageClassName}>
        {fetchError ? (
          <div className={portalErrorBannerClassName}>{fetchError}</div>
        ) : null}
      </div>
    );
  }

  const lateFeeLabel = !detail.lateFeeEnabled
    ? "Disabled"
    : detail.lateFeeType === "percent"
      ? `${detail.lateFeeAmount ?? 0}%`
      : formatLeaseMoney(detail.lateFeeAmount ?? 0);

  const depositSummary = detail.deposit
    ? `${formatLeaseMoney(detail.deposit.amountGhs)} · ${formatDepositStatus(detail.deposit.status)}`
    : "None";

  return (
    <div className={leasePageClassName}>
      <div>
        <Link
          href="/landlord-portal/real-estate/leases"
          className="text-sm text-[#0f2744] hover:underline"
        >
          ← Leases
        </Link>
        <h1 className="mt-1 text-lg font-semibold text-[#0f2744]">
          {detail.lesseeName} · Unit {detail.unitNumber}
        </h1>
        <p className="text-xs text-slate-600">
          {canManage
            ? "Full lease terms — edit on Overview when needed."
            : "Read-only — Davors staff manages changes."}
        </p>
      </div>

      {fetchError ? (
        <div className={portalErrorBannerClassName}>{fetchError}</div>
      ) : null}

      <section className={leaseSectionClassName}>
        <dl className={leaseSummaryGridClassName}>
          <LeaseSummaryItem
            label="Status"
            value={formatLeaseStatus(detail.status)}
          />
          <LeaseSummaryItem label="Tenant" value={detail.lesseeName} />
          <LeaseSummaryItem
            label="Rent"
            value={formatLeaseMoney(detail.rentAmountGhs)}
          />
          <LeaseSummaryItem label="Deposit" value={depositSummary} />
          <LeaseSummaryItem label="Property" value={detail.propertyName} />
          <LeaseSummaryItem label="Unit" value={detail.unitNumber} />
        </dl>
      </section>

      <LeaseDetailTabs activeTab={activeTab} onTabChange={setActiveTab} />

      {activeTab === "overview" ? (
        <div className="space-y-3">
          {canManage ? <LandlordPortalLeaseEditForm detail={detail} /> : null}

          {!canManage ? (
            <>
              <section className={portalSectionClassName}>
                <h2 className={portalSectionTitleClassName}>Parties &amp; unit</h2>
                <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  <DetailItem label="Tenant" value={detail.lesseeName} />
                  <DetailItem
                    label="Contact"
                    value={
                      [detail.lesseePhone, detail.lesseeEmail]
                        .filter(Boolean)
                        .join(" · ") || "—"
                    }
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
                <dl className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
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
            </>
          ) : null}

          <LeaseDetailSection title="Security deposit">
            {detail.deposit ? (
              <>
                <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 text-sm">
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
                <p className="text-sm">
                  <Link
                    href={`/landlord-portal/finance/deposits/${detail.deposit.depositId}`}
                    className="font-medium text-[#0f2744] hover:underline"
                  >
                    View deposit collection / resolution records
                  </Link>
                </p>
              </>
            ) : (
              <p className="text-sm text-slate-600">
                No security deposit on record for this lease.
              </p>
            )}
          </LeaseDetailSection>
        </div>
      ) : null}

      {activeTab === "charges" ? (
        <div className="space-y-3">
          <LeaseDetailSection title="Tenant charge categories">
            <LeaseChargeSettingsPanel
              mode="landlord"
              tenantId={detail.tenantId}
              leaseId={detail.leaseId}
              initialSettings={chargeSettings}
              readOnly={!canManage}
            />
          </LeaseDetailSection>

          {canManage ? (
            <LeaseDetailSection title="One-time charge">
              <p className="text-xs text-slate-600">
                Ad-hoc charge — tenants see these under Other charges.
              </p>
              <OneTimeChargeForm
                mode="landlord"
                tenantId={detail.tenantId}
                leaseId={detail.leaseId}
                leaseActive={detail.status === "active"}
              />
            </LeaseDetailSection>
          ) : (
            <LeaseDetailSection title="One-time charge">
              <p className="text-sm text-slate-600">
                Davors staff create one-time charges for managed leases.
              </p>
            </LeaseDetailSection>
          )}
        </div>
      ) : null}

      {activeTab === "documents" ? (
        <div className="space-y-3">
          <LeaseSignaturePanel
            compact
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
            propertyStreetAddress={detail.propertyStreetAddress}
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

          {canManage || detail.moveInConditionPhotoUrls.length > 0 ? (
            <LeaseDetailSection title="Move-in condition">
              <MoveInConditionPhotosPanel
                tenantId={detail.tenantId}
                leaseId={detail.leaseId}
                initialUrls={detail.moveInConditionPhotoUrls}
                uploadPath="/api/landlord-portal/leases/upload-move-in-photo"
                readOnly={!canManage}
                compact
              />
            </LeaseDetailSection>
          ) : null}
        </div>
      ) : null}

      {activeTab === "more" ? (
        <div className="space-y-3">
          {canManage ? (
            <LeaseDetailSection title="File a complaint">
              <p className="text-xs text-slate-600">
                File a complaint about this tenant — they can respond from their
                portal.
              </p>
              <FileComplaintForm
                mode="landlord"
                tenantId={detail.tenantId}
                leaseId={detail.leaseId}
                leaseActive={detail.status === "active"}
                variant="portal"
              />
            </LeaseDetailSection>
          ) : (
            <p className="text-sm text-slate-600">
              Complaints for managed leases are handled by Davors staff.
            </p>
          )}
        </div>
      ) : null}
    </div>
  );
}
