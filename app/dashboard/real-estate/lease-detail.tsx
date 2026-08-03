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

type LeaseDetailViewProps = {
  initialDetail: LeaseDetail;
  fetchError: string | null;
  focusDeposit?: boolean;
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

  return (
    <div className="space-y-8">
      <Link
        href={`/dashboard/real-estate/leases?landlord=${encodeURIComponent(detail.tenantId)}`}
        className="inline-block text-sm font-medium text-[#0f2744] hover:underline"
      >
        ← Back to Leases
      </Link>

      <div className="text-sm text-slate-600">
        <p>
          Landlord:{" "}
          <span className="font-medium text-[#0f2744]">
            {detail.landlordName}
          </span>
        </p>
        <p className="mt-1">
          Unit:{" "}
          <span className="font-medium text-[#0f2744]">
            {detail.propertyName} — {detail.unitNumber}
          </span>
        </p>
        <p className="mt-1">
          Tenant:{" "}
          <span className="font-medium text-[#0f2744]">
            {detail.lesseeName}
          </span>{" "}
          ({detail.lesseePhone}
          {detail.lesseeEmail ? ` · ${detail.lesseeEmail}` : ""})
        </p>
        <p className="mt-1">
          Status:{" "}
          <span className="font-medium text-[#0f2744]">
            {formatLeaseStatus(detail.status)}
          </span>
        </p>
      </div>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {success}
        </p>
      ) : null}

      {pendingRent ? (
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3">
          <p className="text-sm font-medium text-amber-950">
            Pending rent change: {formatLeaseMoney(detail.pendingRentAmountGhs)}
            , awaiting staff approval
          </p>
          <p className="mt-1 text-sm text-amber-900">
            Current rent remains {formatLeaseMoney(detail.rentAmountGhs)} until
            approved.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
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
        <div className="rounded-md border border-amber-300 bg-amber-50 px-4 py-3">
          <p className="text-sm font-medium text-amber-950">
            Pending early termination request from tenant, awaiting staff
            approval
          </p>
          {detail.pendingTerminationReason ? (
            <p className="mt-1 text-sm text-amber-900">
              Reason: {detail.pendingTerminationReason}
            </p>
          ) : (
            <p className="mt-1 text-sm text-amber-900">
              No reason was provided.
            </p>
          )}
          <p className="mt-1 text-sm text-amber-900">
            Approving runs the same early-termination steps as Terminate Lease
            Early (unit vacated; deposit still needs resolution).
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
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

      <LeaseSignaturePanel
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

      <section className="space-y-4 rounded-md border border-slate-200 bg-white p-4">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-[#0f2744]">
          Lease Details
        </h3>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
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
            <label className="mb-1 block text-sm font-medium text-slate-700">
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
            <label className="mb-1 block text-sm font-medium text-slate-700">
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
              <label className="mb-1 block text-sm font-medium text-slate-700">
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
              <p className="mt-1 text-xs text-slate-500">
                Saving a different amount requests staff approval; it does not
                change current rent immediately.
              </p>
            </div>
          ) : null}
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
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
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Escalation Frequency (months)
            </label>
            <input
              type="number"
              min={1}
              step={1}
              value={escalationFrequency}
              onChange={(event) => setEscalationFrequency(event.target.value)}
              className={inputClassName}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
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
            <p className="mt-1 text-xs text-slate-500">
              Shown on the tenancy PDF. Independent of monthly rent.
            </p>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
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

        <div className="space-y-3 rounded-md border border-slate-100 bg-slate-50 p-3">
          <label className="inline-flex items-center gap-2 text-sm font-medium text-slate-700">
            <input
              type="checkbox"
              checked={lateFeeEnabled}
              onChange={(event) => setLateFeeEnabled(event.target.checked)}
            />
            Late fee enabled
          </label>
          {lateFeeEnabled ? (
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
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
                <label className="mb-1 block text-sm font-medium text-slate-700">
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
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            <p>
              Terminated: {formatLeaseDate(detail.terminatedAt)}
            </p>
            <p className="mt-1">
              Reason: {detail.terminationReason ?? "—"}
            </p>
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
          <div className="space-y-3 rounded-md border border-red-200 bg-red-50 p-3">
            <label className="mb-1 block text-sm font-medium text-red-900">
              Termination Reason
            </label>
            <textarea
              rows={3}
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
      </section>

      <section
        id="security-deposit-section"
        className="space-y-4 rounded-md border border-slate-200 bg-white p-4"
      >
        <h3 className="text-sm font-semibold uppercase tracking-wide text-[#0f2744]">
          Security Deposit
        </h3>
        {!detail.deposit ? (
          <p className="text-sm text-slate-500">
            No security deposit on file for this lease.
          </p>
        ) : (
          <>
            <dl className="grid gap-3 md:grid-cols-2 xl:grid-cols-3 text-sm">
              <div>
                <dt className="text-slate-500">Amount</dt>
                <dd className="mt-1 font-medium text-slate-900">
                  {formatLeaseMoney(detail.deposit.amountGhs)}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Status</dt>
                <dd className="mt-1 font-medium text-slate-900">
                  {formatDepositStatus(detail.deposit.status)}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Date Collected</dt>
                <dd className="mt-1 font-medium text-slate-900">
                  {formatLeaseDate(detail.deposit.dateCollected)}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Amount Returned</dt>
                <dd className="mt-1 font-medium text-slate-900">
                  {formatLeaseMoney(detail.deposit.amountReturnedGhs)}
                </dd>
              </div>
              <div>
                <dt className="text-slate-500">Date Resolved</dt>
                <dd className="mt-1 font-medium text-slate-900">
                  {formatLeaseDate(detail.deposit.dateResolved)}
                </dd>
              </div>
              <div className="md:col-span-2 xl:col-span-3">
                <dt className="text-slate-500">Resolution Notes</dt>
                <dd className="mt-1 font-medium text-slate-900 whitespace-pre-wrap">
                  {detail.deposit.resolutionNotes?.trim()
                    ? detail.deposit.resolutionNotes
                    : "—"}
                </dd>
              </div>
            </dl>

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
                  <div className="space-y-3 rounded-md border border-slate-100 bg-slate-50 p-3">
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700">
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
                        <option value="returned">Returned (full amount)</option>
                        <option value="forfeited">Forfeited (GHS 0)</option>
                        <option value="partially_forfeited">
                          Partially forfeited
                        </option>
                      </select>
                    </div>
                    {resolveStatus === "partially_forfeited" ? (
                      <div>
                        <label className="mb-1 block text-sm font-medium text-slate-700">
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
                    <div>
                      <label className="mb-1 block text-sm font-medium text-slate-700">
                        Resolution Notes (optional)
                      </label>
                      <textarea
                        rows={3}
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
      </section>
    </div>
  );
}
