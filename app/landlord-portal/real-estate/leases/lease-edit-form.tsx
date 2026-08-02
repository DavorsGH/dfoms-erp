"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { LeaseDetail } from "@/app/dashboard/real-estate/leases-utils";
import {
  portalErrorBannerClassName,
  portalInputClassName,
  portalLabelClassName,
  portalPrimaryButtonClassName,
  portalSectionClassName,
  portalSectionTitleClassName,
  portalSuccessBannerClassName,
} from "../../portal-ui";

type LeaseEditFormProps = {
  detail: LeaseDetail;
};

export default function LandlordPortalLeaseEditForm({
  detail,
}: LeaseEditFormProps) {
  const router = useRouter();
  const [startDate, setStartDate] = useState(detail.startDate);
  const [endDate, setEndDate] = useState(detail.endDate);
  const [rentAmount, setRentAmount] = useState(String(detail.rentAmountGhs));
  const [escalationPercent, setEscalationPercent] = useState(
    detail.escalationPercent == null ? "" : String(detail.escalationPercent),
  );
  const [escalationFrequency, setEscalationFrequency] = useState(
    detail.escalationFrequencyMonths == null
      ? ""
      : String(detail.escalationFrequencyMonths),
  );
  const [lateFeeEnabled, setLateFeeEnabled] = useState(detail.lateFeeEnabled);
  const [lateFeeType, setLateFeeType] = useState<"fixed" | "percent">(
    detail.lateFeeType === "percent" ? "percent" : "fixed",
  );
  const [lateFeeAmount, setLateFeeAmount] = useState(
    detail.lateFeeAmount == null ? "" : String(detail.lateFeeAmount),
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    const response = await fetch("/api/landlord-portal/leases/update", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lease_id: detail.leaseId,
        start_date: startDate,
        end_date: endDate,
        rent_amount_ghs: rentAmount,
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
      setLoading(false);
      return;
    }

    setSuccess("Lease saved. Rent changes apply immediately.");
    setLoading(false);
    router.refresh();
  }

  return (
    <form
      onSubmit={handleSave}
      className={`${portalSectionClassName} space-y-4`}
    >
      <h2 className={portalSectionTitleClassName}>Edit lease terms</h2>
      <p className="text-sm text-slate-600">
        Update dates, rent, escalation, and late fees. Rent is applied
        immediately (no staff approval).
      </p>

      {error ? <div className={portalErrorBannerClassName}>{error}</div> : null}
      {success ? (
        <div className={portalSuccessBannerClassName}>{success}</div>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <label className={portalLabelClassName}>Start date</label>
          <input
            required
            type="date"
            value={startDate}
            onChange={(event) => setStartDate(event.target.value)}
            className={portalInputClassName}
          />
        </div>
        <div>
          <label className={portalLabelClassName}>End date</label>
          <input
            required
            type="date"
            value={endDate}
            onChange={(event) => setEndDate(event.target.value)}
            className={portalInputClassName}
          />
        </div>
        <div>
          <label className={portalLabelClassName}>Rent (GHS)</label>
          <input
            required
            type="number"
            min="0"
            step="0.01"
            value={rentAmount}
            onChange={(event) => setRentAmount(event.target.value)}
            className={portalInputClassName}
          />
        </div>
        <div>
          <label className={portalLabelClassName}>Escalation %</label>
          <input
            type="number"
            min="0"
            step="0.01"
            value={escalationPercent}
            onChange={(event) => setEscalationPercent(event.target.value)}
            className={portalInputClassName}
          />
        </div>
        <div>
          <label className={portalLabelClassName}>
            Escalation frequency (months)
          </label>
          <input
            type="number"
            min="1"
            step="1"
            value={escalationFrequency}
            onChange={(event) => setEscalationFrequency(event.target.value)}
            className={portalInputClassName}
          />
        </div>
        <div className="flex items-end gap-2 pb-2">
          <input
            id="late-fee-enabled"
            type="checkbox"
            checked={lateFeeEnabled}
            onChange={(event) => setLateFeeEnabled(event.target.checked)}
            className="h-4 w-4"
          />
          <label htmlFor="late-fee-enabled" className="text-sm text-slate-700">
            Enable late fees
          </label>
        </div>
        {lateFeeEnabled ? (
          <>
            <div>
              <label className={portalLabelClassName}>Late fee type</label>
              <select
                value={lateFeeType}
                onChange={(event) =>
                  setLateFeeType(
                    event.target.value === "percent" ? "percent" : "fixed",
                  )
                }
                className={portalInputClassName}
              >
                <option value="fixed">Fixed</option>
                <option value="percent">Percent</option>
              </select>
            </div>
            <div>
              <label className={portalLabelClassName}>Late fee amount</label>
              <input
                required
                type="number"
                min="0"
                step="0.01"
                value={lateFeeAmount}
                onChange={(event) => setLateFeeAmount(event.target.value)}
                className={portalInputClassName}
              />
            </div>
          </>
        ) : null}
      </div>

      <button
        type="submit"
        disabled={loading}
        className={portalPrimaryButtonClassName}
      >
        {loading ? "Saving…" : "Save lease"}
      </button>
    </form>
  );
}
