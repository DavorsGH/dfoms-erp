"use client";

import { useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { inputClassName } from "@/app/dashboard/hr-payroll/hr-register-utils";
import {
  formatLoyaltyMoney,
  normalizeLoyaltySettings,
  type LoyaltySettingsRow,
} from "@/utils/loyalty-types";

type LoyaltySettingsFormProps = {
  initialSettings: LoyaltySettingsRow | null;
  fetchError: string | null;
};

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50";

export default function LoyaltySettingsForm({
  initialSettings,
  fetchError,
}: LoyaltySettingsFormProps) {
  const supabase = createClient();
  const normalized = initialSettings
    ? normalizeLoyaltySettings(initialSettings)
    : null;

  const [earnRate, setEarnRate] = useState(
    String(normalized?.earn_rate_currency_per_point ?? ""),
  );
  const [redemptionValue, setRedemptionValue] = useState(
    String(normalized?.redemption_value_per_point ?? ""),
  );
  const [error, setError] = useState<string | null>(fetchError);
  const [success, setSuccess] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);

    const earn = Number.parseFloat(earnRate);
    const redeem = Number.parseFloat(redemptionValue);

    if (!Number.isFinite(earn) || earn < 0) {
      setError("Earn rate must be zero or greater.");
      setSaving(false);
      return;
    }

    if (!Number.isFinite(redeem) || redeem <= 0) {
      setError("Redemption value must be greater than zero.");
      setSaving(false);
      return;
    }

    const { error: rpcError } = await supabase.rpc("update_loyalty_settings", {
      p_earn_rate: earn,
      p_redemption_value: redeem,
    });

    if (rpcError) {
      setError(rpcError.message);
      setSaving(false);
      return;
    }

    setSuccess("Loyalty settings updated.");
    setSaving(false);
  }

  return (
    <form onSubmit={handleSubmit} className="max-w-xl space-y-6">
      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}
      {success ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {success}
        </p>
      ) : null}

      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-600">
          Configure how customers earn and redeem loyalty points for this tenant.
        </p>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            GHS spent per 1 point earned
          </label>
          <input
            type="number"
            min={0}
            step="0.01"
            required
            value={earnRate}
            onChange={(event) => setEarnRate(event.target.value)}
            className={inputClassName}
          />
          <p className="mt-1 text-xs text-slate-500">
            Example: 10 means the customer earns 1 point for every GHS 10 spent.
          </p>
        </div>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            GHS value per point redeemed
          </label>
          <input
            type="number"
            min={0.01}
            step="0.01"
            required
            value={redemptionValue}
            onChange={(event) => setRedemptionValue(event.target.value)}
            className={inputClassName}
          />
          <p className="mt-1 text-xs text-slate-500">
            Current redemption value: {formatLoyaltyMoney(redemptionValue || 0)} per point.
          </p>
        </div>
      </section>

      <button type="submit" disabled={saving} className={primaryButtonClassName}>
        {saving ? "Saving…" : "Save Settings"}
      </button>
    </form>
  );
}
