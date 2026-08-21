"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { inputClassName } from "../hr-payroll/hr-register-utils";
import {
  LATE_FEE_TYPE_OPTIONS,
  formatDepositStatus,
  formatLeaseDate,
  formatLeaseMoney,
  formatLeaseStatus,
  type LateFeeType,
  type LeaseDetail,
} from "./leases-utils";
import LeaseSignaturePanel from "./lease-signature-panel";
import OneTimeChargeForm from "./one-time-charge-form";
import LeaseChargeSettingsPanel from "./lease-charge-settings-panel";
import MoveInConditionPhotosPanel from "./move-in-condition-photos-panel";
import FileComplaintForm from "./file-complaint-form";
import {
  LeaseDetailSection,
  LeaseDetailTabs,
  LeaseSummaryItem,
  leaseFieldGridClassName,
  leasePageClassName,
  leaseSectionClassName,
  leaseSummaryGridClassName,
  type LeaseDetailTabId,
} from "./lease-detail-layout";
import type { LeaseChargeSettingRow } from "@/utils/lease-charge-categories";

type LeaseDetailViewProps = {
  initialDetail: LeaseDetail;
  fetchError: string | null;
  focusDeposit?: boolean;
  initialChargeSettings: LeaseChargeSettingRow[];
};

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButtonClassName =
  "rounded-md border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

const dangerButtonClassName =
  "rounded-md border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50";

const textareaClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

export default function LeaseDetailView({
  initialDetail,
  fetchError,
  focusDeposit = false,
  initialChargeSettings,
}: LeaseDetailViewProps) {
  const router = useRouter();
  const [detail, setDetail] = useState(initialDetail);
  const [error, setError] = useState<string | null>(fetchError);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [rentReviewLoading, setRentReviewLoading] = useState(false);
  const [terminationReviewLoading, setTerminationReviewLoading] =
    useState(false);
  const [terminating, setTerminating] = useState(false);
  const [showTerminate, setShowTerminate] = useState(false);
  const [terminationReason, setTerminationReason] = useState("");
  const [resolvingDeposit, setResolvingDeposit] = useState(false);
  const [showResolveDeposit, setShowResolveDeposit] = useState(focusDeposit);
  const [resolveStatus, setResolveStatus] = useState<
    "returned" | "forfeited" | "partially_forfeited"
  >("returned");
  const [amountReturned, setAmountReturned] = useState("");
  const [resolutionNotes, setResolutionNotes] = useState("");
  const [activeTab, setActiveTab] = useState<LeaseDetailTabId>("overview");

  const [startDate, setStartDate] = useState(initialDetail.startDate);
  const [endDate, setEndDate] = useState(initialDetail.endDate);
  const [proposedRent, setProposedRent] = useState(
    String(initialDetail.rentAmountGhs),
  );
  const [escalationPercent, setEscalationPercent] = useState(
    initialDetail.escalationPercent == null
      ? ""
      : String(initialDetail.escalationPercent),
  );
  const [escalationFrequency, setEscalationFrequency] = useState(
    initialDetail.escalationFrequencyMonths == null
      ? ""
      : String(initialDetail.escalationFrequencyMonths),
  );
  const [lateFeeEnabled, setLateFeeEnabled] = useState(
    initialDetail.lateFeeEnabled,
  );
  const [lateFeeType, setLateFeeType] = useState<LateFeeType>(
    initialDetail.lateFeeType ?? "fixed",
  );
  const [lateFeeAmount, setLateFeeAmount] = useState(
    initialDetail.lateFeeAmount == null
      ? ""
      : String(initialDetail.lateFeeAmount),
  );
  const [advanceRent, setAdvanceRent] = useState(
    String(initialDetail.advanceRentAmountGhs),
  );
  const [terminationNoticeMonths, setTerminationNoticeMonths] = useState(
    String(initialDetail.terminationNoticeMonths),
  );

  useEffect(() => {
    setDetail(initialDetail);
    setStartDate(initialDetail.startDate);
    setEndDate(initialDetail.endDate);
    setProposedRent(String(initialDetail.rentAmountGhs));
    setEscalationPercent(
      initialDetail.escalationPercent == null
        ? ""
        : String(initialDetail.escalationPercent),
    );
    setEscalationFrequency(
      initialDetail.escalationFrequencyMonths == null
        ? ""
        : String(initialDetail.escalationFrequencyMonths),
    );
    setLateFeeEnabled(initialDetail.lateFeeEnabled);
    setLateFeeType(initialDetail.lateFeeType ?? "fixed");
    setLateFeeAmount(
      initialDetail.lateFeeAmount == null
        ? ""
        : String(initialDetail.lateFeeAmount),
    );
    setAdvanceRent(String(initialDetail.advanceRentAmountGhs));
    setTerminationNoticeMonths(String(initialDetail.terminationNoticeMonths));
    setError(fetchError);
    if (focusDeposit) {
      setShowResolveDeposit(true);
      setActiveTab("overview");
    }
  }, [initialDetail, fetchError, focusDeposit]);

  useEffect(() => {
    if (!focusDeposit) {
      return;
    }
    const el = document.getElementById("security-deposit-section");
    el?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [focusDeposit]);

  const isActive = detail.status === "active";
  const pendingRent =
    detail.rentChangeStatus === "pending_staff_approval" &&
    detail.pendingRentAmountGhs != null;
  const pendingTermination =
    detail.terminationRequestStatus === "pending_staff_approval";

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSuccess(null);

    const response = await fetch("/api/admin/leases/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenant_id: detail.tenantId,
        lease_id: detail.leaseId,
        start_date: startDate,
        end_date: endDate,
        proposed_rent_amount_ghs: isActive ? proposedRent : null,
        advance_rent_amount_ghs: advanceRent,
        termination_notice_months: terminationNoticeMonths,
        escalation_percent: escalationPercent || null,
        escalation_frequency_months: escalationFrequency || null,
        late_fee_enabled: lateFeeEnabled,
        late_fee_type: lateFeeEnabled ? lateFeeType : null,
        late_fee_amount: lateFeeEnabled ? lateFeeAmount : null,
      }),
    });

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to save lease.");
      setSaving(false);
      return;
    }

    setSuccess("Lease saved.");
    setSaving(false);
    router.refresh();
  }

  async function handleRentChange(action: "approve" | "reject") {
    setRentReviewLoading(true);
    setError(null);
    setSuccess(null);

    const response = await fetch("/api/admin/leases/rent-change", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenant_id: detail.tenantId,
        lease_id: detail.leaseId,
        action,
      }),
    });

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to review rent change.");
      setRentReviewLoading(false);
      return;
    }

    setSuccess(
      action === "approve" ? "Rent change approved." : "Rent change rejected.",
    );
    setRentReviewLoading(false);
    router.refresh();
  }

  async function handleTerminationRequest(action: "approve" | "reject") {
    setTerminationReviewLoading(true);
    setError(null);
    setSuccess(null);

    const response = await fetch("/api/admin/leases/termination-request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenant_id: detail.tenantId,
        lease_id: detail.leaseId,
        action,
      }),
    });

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
      deposit_id?: string | null;
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to review termination request.");
      setTerminationReviewLoading(false);
      return;
    }

    setTerminationReviewLoading(false);

    if (action === "approve" && payload?.deposit_id) {
      router.push(
        `/dashboard/real-estate/leases/${detail.tenantId}/${detail.leaseId}?resolveDeposit=1`,
      );
      router.refresh();
      return;
    }

    setSuccess(
      action === "approve"
        ? "Termination request approved — lease terminated early."
        : "Termination request rejected — lease continues.",
    );
    router.refresh();
  }

  async function handleTerminate() {
    if (!terminationReason.trim()) {
      setError("Termination reason is required.");
      return;
    }

    setTerminating(true);
    setError(null);
    setSuccess(null);

    const response = await fetch("/api/admin/leases/terminate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenant_id: detail.tenantId,
        lease_id: detail.leaseId,
        termination_reason: terminationReason,
      }),
    });

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
      deposit_id?: string | null;
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to terminate lease.");
      setTerminating(false);
      return;
    }

    setTerminating(false);
    setShowTerminate(false);

    if (payload?.deposit_id) {
      router.push(
        `/dashboard/real-estate/leases/${detail.tenantId}/${detail.leaseId}?resolveDeposit=1`,
      );
      router.refresh();
      return;
    }

    setSuccess("Lease terminated early.");
    router.refresh();
  }

  async function handleResolveDeposit() {
    if (!detail.deposit) {
      return;
    }

    setResolvingDeposit(true);
    setError(null);
    setSuccess(null);

    const response = await fetch("/api/admin/deposits/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        tenant_id: detail.tenantId,
        deposit_id: detail.deposit.depositId,
        status: resolveStatus,
        amount_returned_ghs:
          resolveStatus === "partially_forfeited" ? amountReturned : null,
        resolution_notes: resolutionNotes || null,
      }),
    });

    const payload = (await response.json().catch(() => null)) as {
      error?: string;
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to resolve deposit.");
      setResolvingDeposit(false);
      return;
    }

    setResolvingDeposit(false);
    setShowResolveDeposit(false);
    setSuccess("Security deposit resolved.");
    router.refresh();
  }

  const depositSummary = detail.deposit
    ? `${formatLeaseMoney(detail.deposit.amountGhs)} · ${formatDepositStatus(detail.deposit.status)}`
    : "None";

  return (
    <div className={leasePageClassName}>
      <Link
        href={`/dashboard/real-estate/leases?landlord=${encodeURIComponent(detail.tenantId)}`}
        className="inline-block text-sm font-medium text-[#0f2744] hover:underline"
      >
        ← Back to Leases
      </Link>

      <section className={leaseSectionClassName}>
        <dl className={leaseSummaryGridClassName}>
          <LeaseSummaryItem
            label="Status"
            value={formatLeaseStatus(detail.status)}
          />
          <LeaseSummaryItem label="Landlord" value={detail.landlordName} />
          <LeaseSummaryItem label="Tenant" value={detail.lesseeName} />
          <LeaseSummaryItem
            label="Rent"
            value={formatLeaseMoney(detail.rentAmountGhs)}
          />
          <LeaseSummaryItem label="Deposit" value={depositSummary} />
          <LeaseSummaryItem
            label="Unit"
            value={`${detail.propertyName} — ${detail.unitNumber}`}
            className="sm:col-span-2 lg:col-span-1"
          />
        </dl>
        <p className="text-xs text-slate-500">
          {detail.lesseePhone}
          {detail.lesseeEmail ? ` · ${detail.lesseeEmail}` : ""}
        </p>
      </section>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {success}
        </p>
      ) : null}

      {pendingRent ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2">
          <p className="text-sm font-medium text-amber-950">
            Pending rent change: {formatLeaseMoney(detail.pendingRentAmountGhs)}
            , awaiting staff approval
          </p>
          <p className="text-xs text-amber-900">
            Current rent remains {formatLeaseMoney(detail.rentAmountGhs)} until
            approved.
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={rentReviewLoading}
              onClick={() => handleRentChange("approve")}
              className={primaryButtonClassName}
            >
              Approve
            </button>
            <button
              type="button"
              disabled={rentReviewLoading}
              onClick={() => handleRentChange("reject")}
              className={dangerButtonClassName}
            >
              Reject
            </button>
          </div>
        </div>
      ) : null}

      {pendingTermination ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2">
          <p className="text-sm font-medium text-amber-950">
            Pending early termination request from tenant, awaiting staff
            approval
          </p>
          {detail.pendingTerminationReason ? (
            <p className="text-xs text-amber-900">
              Reason: {detail.pendingTerminationReason}
            </p>
          ) : (
            <p className="text-xs text-amber-900">No reason was provided.</p>
          )}
          <div className="mt-2 flex flex-wrap gap-2">
            <button
              type="button"
              disabled={terminationReviewLoading}
              onClick={() => void handleTerminationRequest("approve")}
              className={primaryButtonClassName}
            >
              {terminationReviewLoading ? "Working…" : "Approve"}
            </button>
            <button
              type="button"
              disabled={terminationReviewLoading}
              onClick={() => void handleTerminationRequest("reject")}
              className={dangerButtonClassName}
            >
              Reject
            </button>
          </div>
        </div>
      ) : null}

      <LeaseDetailTabs activeTab={activeTab} onTabChange={setActiveTab} />

      {activeTab === "overview" ? (
        <div className="space-y-3">
          <LeaseDetailSection title="Lease details">
            <div className={leaseFieldGridClassName}>
              <div>
                <label className="mb-0.5 block text-xs font-medium text-slate-700">
                  Start Date
                </label>
                <input
                  type="date"
                  value={startDate}
                  onChange={(event) => setStartDate(event.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-0.5 block text-xs font-medium text-slate-700">
                  End Date
                </label>
                <input
                  type="date"
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-0.5 block text-xs font-medium text-slate-700">
                  Current Rent (GHS)
                </label>
                <input
                  type="text"
                  value={formatLeaseMoney(detail.rentAmountGhs)}
                  disabled
                  className={`${inputClassName} bg-slate-50 text-slate-600`}
                />
              </div>
              {isActive ? (
                <div>
                  <label className="mb-0.5 block text-xs font-medium text-slate-700">
                    Propose New Rent (GHS)
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="0.01"
                    value={proposedRent}
                    onChange={(event) => setProposedRent(event.target.value)}
                    className={inputClassName}
                  />
                </div>
              ) : null}
              <div>
                <label className="mb-0.5 block text-xs font-medium text-slate-700">
                  Escalation %
                </label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={escalationPercent}
                  onChange={(event) => setEscalationPercent(event.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-0.5 block text-xs font-medium text-slate-700">
                  Escalation Frequency (months)
                </label>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={escalationFrequency}
                  onChange={(event) =>
                    setEscalationFrequency(event.target.value)
                  }
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-0.5 block text-xs font-medium text-slate-700">
                  Advance rent (GHS)
                </label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={advanceRent}
                  onChange={(event) => setAdvanceRent(event.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-0.5 block text-xs font-medium text-slate-700">
                  Termination notice (months)
                </label>
                <input
                  type="number"
                  min={1}
                  step={1}
                  value={terminationNoticeMonths}
                  onChange={(event) =>
                    setTerminationNoticeMonths(event.target.value)
                  }
                  className={inputClassName}
                />
              </div>
            </div>

            <div className="space-y-2 rounded-md border border-slate-100 bg-slate-50 p-2">
              <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
                <input
                  type="checkbox"
                  checked={lateFeeEnabled}
                  onChange={(event) => setLateFeeEnabled(event.target.checked)}
                />
                Late fee enabled
              </label>
              {lateFeeEnabled ? (
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <label className="mb-0.5 block text-xs font-medium text-slate-700">
                      Late Fee Type
                    </label>
                    <select
                      value={lateFeeType}
                      onChange={(event) =>
                        setLateFeeType(event.target.value as LateFeeType)
                      }
                      className={inputClassName}
                    >
                      {LATE_FEE_TYPE_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="mb-0.5 block text-xs font-medium text-slate-700">
                      Late Fee Amount
                    </label>
                    <input
                      type="number"
                      min={0}
                      step="0.01"
                      value={lateFeeAmount}
                      onChange={(event) => setLateFeeAmount(event.target.value)}
                      className={inputClassName}
                    />
                  </div>
                </div>
              ) : null}
            </div>

            {detail.terminatedAt ? (
              <div className="rounded-md border border-slate-200 bg-slate-50 px-2 py-1.5 text-sm text-slate-700">
                <p>Terminated: {formatLeaseDate(detail.terminatedAt)}</p>
                <p>Reason: {detail.terminationReason ?? "—"}</p>
              </div>
            ) : null}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                disabled={saving}
                onClick={handleSave}
                className={primaryButtonClassName}
              >
                {saving ? "Saving…" : "Save Lease"}
              </button>
              {isActive ? (
                <button
                  type="button"
                  onClick={() => setShowTerminate((current) => !current)}
                  className={dangerButtonClassName}
                >
                  Terminate Lease Early
                </button>
              ) : null}
            </div>

            {showTerminate ? (
              <div className="space-y-2 rounded-md border border-red-200 bg-red-50 p-2">
                <label className="mb-0.5 block text-sm font-medium text-red-900">
                  Termination Reason
                </label>
                <textarea
                  rows={2}
                  value={terminationReason}
                  onChange={(event) => setTerminationReason(event.target.value)}
                  className={textareaClassName}
                />
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={terminating}
                    onClick={handleTerminate}
                    className={dangerButtonClassName}
                  >
                    {terminating ? "Terminating…" : "Confirm Termination"}
                  </button>
                  <button
                    type="button"
                    onClick={() => setShowTerminate(false)}
                    className={secondaryButtonClassName}
                  >
                    Cancel
                  </button>
                </div>
              </div>
            ) : null}
          </LeaseDetailSection>

          <LeaseDetailSection
            id="security-deposit-section"
            title="Security deposit"
          >
            {!detail.deposit ? (
              <p className="text-sm text-slate-500">
                No security deposit on file for this lease.
              </p>
            ) : (
              <>
                <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3 text-sm">
                  <div>
                    <dt className="text-xs text-slate-500">Amount</dt>
                    <dd className="font-medium text-slate-900">
                      {formatLeaseMoney(detail.deposit.amountGhs)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Status</dt>
                    <dd className="font-medium text-slate-900">
                      {formatDepositStatus(detail.deposit.status)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Date Collected</dt>
                    <dd className="font-medium text-slate-900">
                      {formatLeaseDate(detail.deposit.dateCollected)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Amount Returned</dt>
                    <dd className="font-medium text-slate-900">
                      {formatLeaseMoney(detail.deposit.amountReturnedGhs)}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-slate-500">Date Resolved</dt>
                    <dd className="font-medium text-slate-900">
                      {formatLeaseDate(detail.deposit.dateResolved)}
                    </dd>
                  </div>
                  <div className="sm:col-span-2 lg:col-span-3">
                    <dt className="text-xs text-slate-500">Resolution Notes</dt>
                    <dd className="whitespace-pre-wrap font-medium text-slate-900">
                      {detail.deposit.resolutionNotes?.trim()
                        ? detail.deposit.resolutionNotes
                        : "—"}
                    </dd>
                  </div>
                </dl>

                <p className="text-sm">
                  <Link
                    href={`/dashboard/real-estate/deposits/${detail.tenantId}/${detail.deposit.depositId}`}
                    className="font-medium text-[#0f2744] hover:underline"
                  >
                    View deposit collection / resolution records
                  </Link>
                </p>

                {detail.deposit.status === "held" ? (
                  <>
                    <button
                      type="button"
                      onClick={() =>
                        setShowResolveDeposit((current) => !current)
                      }
                      className={secondaryButtonClassName}
                    >
                      {showResolveDeposit ? "Cancel Resolve" : "Resolve Deposit"}
                    </button>
                    {showResolveDeposit ? (
                      <div className="space-y-2 rounded-md border border-slate-100 bg-slate-50 p-2">
                        <div className="grid gap-3 sm:grid-cols-2">
                          <div>
                            <label className="mb-0.5 block text-xs font-medium text-slate-700">
                              Resolution
                            </label>
                            <select
                              value={resolveStatus}
                              onChange={(event) =>
                                setResolveStatus(
                                  event.target.value as
                                    | "returned"
                                    | "forfeited"
                                    | "partially_forfeited",
                                )
                              }
                              className={inputClassName}
                            >
                              <option value="returned">
                                Returned (full amount)
                              </option>
                              <option value="forfeited">Forfeited (GHS 0)</option>
                              <option value="partially_forfeited">
                                Partially forfeited
                              </option>
                            </select>
                          </div>
                          {resolveStatus === "partially_forfeited" ? (
                            <div>
                              <label className="mb-0.5 block text-xs font-medium text-slate-700">
                                Amount Returned (GHS)
                              </label>
                              <input
                                type="number"
                                min={0}
                                step="0.01"
                                max={detail.deposit.amountGhs}
                                value={amountReturned}
                                onChange={(event) =>
                                  setAmountReturned(event.target.value)
                                }
                                className={inputClassName}
                              />
                            </div>
                          ) : null}
                        </div>
                        <div>
                          <label className="mb-0.5 block text-xs font-medium text-slate-700">
                            Resolution Notes (optional)
                          </label>
                          <textarea
                            rows={2}
                            value={resolutionNotes}
                            onChange={(event) =>
                              setResolutionNotes(event.target.value)
                            }
                            className={textareaClassName}
                          />
                        </div>
                        <button
                          type="button"
                          disabled={resolvingDeposit}
                          onClick={handleResolveDeposit}
                          className={primaryButtonClassName}
                        >
                          {resolvingDeposit ? "Saving…" : "Confirm Resolution"}
                        </button>
                      </div>
                    ) : null}
                  </>
                ) : null}
              </>
            )}
          </LeaseDetailSection>
        </div>
      ) : null}

      {activeTab === "charges" ? (
        <div className="space-y-3">
          <LeaseDetailSection title="Tenant charge categories">
            <LeaseChargeSettingsPanel
              mode="staff"
              tenantId={detail.tenantId}
              leaseId={detail.leaseId}
              initialSettings={initialChargeSettings}
            />
          </LeaseDetailSection>

          <LeaseDetailSection title="One-time charge">
            <p className="text-xs text-slate-600">
              Ad-hoc charge (Other charges in tenant portal). Included in
              davors_managed management fee when paid.
            </p>
            <OneTimeChargeForm
              mode="staff"
              tenantId={detail.tenantId}
              leaseId={detail.leaseId}
              leaseActive={detail.status === "active"}
              compact
            />
          </LeaseDetailSection>
        </div>
      ) : null}

      {activeTab === "documents" ? (
        <div className="space-y-3">
          <LeaseSignaturePanel
            compact
            mode="staff"
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

          <LeaseDetailSection title="Move-in condition">
            <MoveInConditionPhotosPanel
              tenantId={detail.tenantId}
              leaseId={detail.leaseId}
              initialUrls={detail.moveInConditionPhotoUrls}
              uploadPath="/api/admin/leases/upload-move-in-photo"
              compact
            />
          </LeaseDetailSection>
        </div>
      ) : null}

      {activeTab === "more" ? (
        <LeaseDetailSection title="File a complaint">
          <p className="text-xs text-slate-600">
            File a complaint about this tenant on behalf of the landlord.
          </p>
          <FileComplaintForm
            mode="staff"
            tenantId={detail.tenantId}
            leaseId={detail.leaseId}
            leaseActive={detail.status === "active"}
            compact
          />
        </LeaseDetailSection>
      ) : null}
    </div>
  );
}
