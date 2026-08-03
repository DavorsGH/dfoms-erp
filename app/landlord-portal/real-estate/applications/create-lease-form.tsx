"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  DEFAULT_TERMINATION_NOTICE_MONTHS,
  LATE_FEE_TYPE_OPTIONS,
  suggestAdvanceRentAmountGhs,
  type LateFeeType,
} from "@/app/dashboard/real-estate/leases-utils";
import {
  portalErrorBannerClassName,
  portalInputClassName,
  portalLabelClassName,
  portalPrimaryButtonClassName,
  portalSuccessBannerClassName,
} from "../../portal-ui";

type Props = {
  applicationId: string;
  defaultRentGhs: number | null;
  defaultStartDate: string | null;
  applicantName: string;
};

export default function CreateLeaseFromApplicationForm({
  applicationId,
  defaultRentGhs,
  defaultStartDate,
  applicantName,
}: Props) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [advanceTouched, setAdvanceTouched] = useState(false);
  const [form, setForm] = useState({
    start_date: defaultStartDate ?? "",
    end_date: "",
    rent_amount_ghs: defaultRentGhs != null ? String(defaultRentGhs) : "",
    advance_rent_amount_ghs: "",
    termination_notice_months: String(DEFAULT_TERMINATION_NOTICE_MONTHS),
    deposit_amount_ghs: defaultRentGhs != null ? String(defaultRentGhs) : "",
    deposit_date_collected: new Date().toISOString().slice(0, 10),
    escalation_percent: "",
    escalation_frequency_months: "",
    late_fee_enabled: false,
    late_fee_type: "fixed" as LateFeeType,
    late_fee_amount: "",
  });

  useEffect(() => {
    if (advanceTouched) {
      return;
    }
    const rent = Number(form.rent_amount_ghs);
    if (
      !Number.isFinite(rent) ||
      !form.start_date ||
      !form.end_date ||
      form.end_date < form.start_date
    ) {
      return;
    }
    const suggested = suggestAdvanceRentAmountGhs(
      rent,
      form.start_date,
      form.end_date,
    );
    setForm((current) => {
      const next = suggested > 0 ? String(suggested) : "";
      if (current.advance_rent_amount_ghs === next) {
        return current;
      }
      return { ...current, advance_rent_amount_ghs: next };
    });
  }, [
    advanceTouched,
    form.rent_amount_ghs,
    form.start_date,
    form.end_date,
  ]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    const response = await fetch(
      "/api/landlord-portal/applications/create-lease",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          application_id: applicationId,
          ...form,
          advance_rent_amount_ghs: form.advance_rent_amount_ghs || null,
          termination_notice_months: form.termination_notice_months || null,
          escalation_percent: form.escalation_percent || null,
          escalation_frequency_months: form.escalation_frequency_months || null,
          late_fee_type: form.late_fee_enabled ? form.late_fee_type : null,
          late_fee_amount: form.late_fee_enabled ? form.late_fee_amount : null,
        }),
      },
    );
    const payload = (await response.json().catch(() => null)) as {
      error?: string;
      lease_id?: string;
    } | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to create lease.");
      setLoading(false);
      return;
    }

    setSuccess(`Lease created for ${applicantName}.`);
    setLoading(false);
    if (payload?.lease_id) {
      router.push(
        `/landlord-portal/real-estate/leases/${payload.lease_id}`,
      );
      return;
    }
    router.refresh();
  }

  return (
    <form
      onSubmit={handleSubmit}
      className="space-y-3 rounded-md border border-emerald-200 bg-emerald-50/40 p-4"
    >
      <h2 className="text-sm font-semibold uppercase tracking-wide text-[#0f2744]">
        Create lease from application
      </h2>
      <p className="text-sm text-slate-600">
        Creates a lease and tenant record for {applicantName}. The unit hold
        will convert to occupied.
      </p>
      {error ? <div className={portalErrorBannerClassName}>{error}</div> : null}
      {success ? (
        <div className={portalSuccessBannerClassName}>{success}</div>
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <label className={portalLabelClassName}>Start date *</label>
          <input
            required
            type="date"
            className={portalInputClassName}
            value={form.start_date}
            onChange={(e) =>
              setForm((c) => ({ ...c, start_date: e.target.value }))
            }
          />
        </div>
        <div>
          <label className={portalLabelClassName}>End date *</label>
          <input
            required
            type="date"
            className={portalInputClassName}
            value={form.end_date}
            onChange={(e) =>
              setForm((c) => ({ ...c, end_date: e.target.value }))
            }
          />
        </div>
        <div>
          <label className={portalLabelClassName}>Rent (GHS) *</label>
          <input
            required
            type="number"
            min={0}
            step="0.01"
            className={portalInputClassName}
            value={form.rent_amount_ghs}
            onChange={(e) =>
              setForm((c) => ({ ...c, rent_amount_ghs: e.target.value }))
            }
          />
        </div>
        <div>
          <label className={portalLabelClassName}>Advance rent (GHS)</label>
          <input
            type="number"
            min={0}
            step="0.01"
            className={portalInputClassName}
            value={form.advance_rent_amount_ghs}
            onChange={(e) => {
              setAdvanceTouched(true);
              setForm((c) => ({
                ...c,
                advance_rent_amount_ghs: e.target.value,
              }));
            }}
          />
          <p className="mt-1 text-xs text-slate-500">
            Suggested as rent × term months; override freely.
          </p>
        </div>
        <div>
          <label className={portalLabelClassName}>
            Termination notice (months)
          </label>
          <input
            type="number"
            min={1}
            step={1}
            className={portalInputClassName}
            value={form.termination_notice_months}
            onChange={(e) =>
              setForm((c) => ({
                ...c,
                termination_notice_months: e.target.value,
              }))
            }
          />
        </div>
        <div>
          <label className={portalLabelClassName}>Deposit (GHS) *</label>
          <input
            required
            type="number"
            min={0}
            step="0.01"
            className={portalInputClassName}
            value={form.deposit_amount_ghs}
            onChange={(e) =>
              setForm((c) => ({ ...c, deposit_amount_ghs: e.target.value }))
            }
          />
        </div>
        <div>
          <label className={portalLabelClassName}>Deposit collected *</label>
          <input
            required
            type="date"
            className={portalInputClassName}
            value={form.deposit_date_collected}
            onChange={(e) =>
              setForm((c) => ({
                ...c,
                deposit_date_collected: e.target.value,
              }))
            }
          />
        </div>
        <div className="flex items-end pb-2">
          <label className="flex items-center gap-2 text-sm text-slate-700">
            <input
              type="checkbox"
              checked={form.late_fee_enabled}
              onChange={(e) =>
                setForm((c) => ({ ...c, late_fee_enabled: e.target.checked }))
              }
            />
            Enable late fees
          </label>
        </div>
        {form.late_fee_enabled ? (
          <>
            <div>
              <label className={portalLabelClassName}>Late fee type</label>
              <select
                className={portalInputClassName}
                value={form.late_fee_type}
                onChange={(e) =>
                  setForm((c) => ({
                    ...c,
                    late_fee_type: e.target.value as LateFeeType,
                  }))
                }
              >
                {LATE_FEE_TYPE_OPTIONS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={portalLabelClassName}>Late fee amount</label>
              <input
                type="number"
                min={0}
                step="0.01"
                className={portalInputClassName}
                value={form.late_fee_amount}
                onChange={(e) =>
                  setForm((c) => ({ ...c, late_fee_amount: e.target.value }))
                }
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
        {loading ? "Creating…" : "Create lease"}
      </button>
    </form>
  );
}
