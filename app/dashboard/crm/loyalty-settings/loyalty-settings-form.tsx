"use client";

import { useEffect, useRef, useState } from "react";
import { useAlert, useToast } from "@/components/feedback/feedback-context";
import { createClient } from "@/utils/supabase/client";
import { inputClassName } from "@/app/dashboard/hr-payroll/hr-register-utils";
import {
  SALES_CRM_ALERT_TITLE,
  clientFacingSalesCrmError,
} from "@/lib/crm/sales-crm-notifications";
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
  const { alertError } = useAlert();
  const { toast } = useToast();
  const formRef = useRef<HTMLFormElement>(null);
  const earnRateRef = useRef<HTMLInputElement>(null);
  const redemptionValueRef = useRef<HTMLInputElement>(null);
  const normalized = initialSettings
    ? normalizeLoyaltySettings(initialSettings)
    : null;

  const [earnRate, setEarnRate] = useState(
    String(normalized?.earn_rate_currency_per_point ?? ""),
  );
  const [redemptionValue, setRedemptionValue] = useState(
    String(normalized?.redemption_value_per_point ?? ""),
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (fetchError) {
      void alertError(clientFacingSalesCrmError(fetchError, "Could not load."), {
        title: SALES_CRM_ALERT_TITLE,
      });
    }
  }, [fetchError, alertError]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    earnRateRef.current?.setCustomValidity("");
    redemptionValueRef.current?.setCustomValidity("");

    const earn = Number.parseFloat(earnRate);
    const redeem = Number.parseFloat(redemptionValue);

    if (!Number.isFinite(earn) || earn < 0) {
      earnRateRef.current?.setCustomValidity("Earn rate must be zero or greater.");
      earnRateRef.current?.reportValidity();
      return;
    }

    if (!Number.isFinite(redeem) || redeem <= 0) {
      redemptionValueRef.current?.setCustomValidity(
        "Redemption value must be greater than zero.",
      );
      redemptionValueRef.current?.reportValidity();
      return;
    }

    if (!formRef.current?.reportValidity()) {
      return;
    }

    setSaving(true);

    const { error: rpcError } = await supabase.rpc("update_loyalty_settings", {
      p_earn_rate: earn,
      p_redemption_value: redeem,
    });

    if (rpcError) {
      void alertError(clientFacingSalesCrmError(rpcError.message), {
        title: SALES_CRM_ALERT_TITLE,
      });
      setSaving(false);
      return;
    }

    toast("Loyalty settings updated.");
    setSaving(false);
  }

  return (
    <form ref={formRef} onSubmit={handleSubmit} className="max-w-xl space-y-6">
      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-600">
          Configure how customers earn and redeem loyalty points for this tenant.
        </p>
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            GHS spent per 1 point earned
          </label>
          <input
            ref={earnRateRef}
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
            ref={redemptionValueRef}
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
