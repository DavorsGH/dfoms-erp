"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { TAX_SETTINGS_ON_CONFLICT } from "@/utils/phase5e-key-structure";
import {
  DEFAULT_PRODUCT_SALE_NOTIFICATION_THRESHOLD,
  PRODUCT_SALE_NOTIFICATION_THRESHOLD_OPTIONS,
  normalizeProductSaleNotificationThreshold,
} from "./tax-utils";

type ProductSaleNotificationThresholdSettingsProps = {
  tenantId: string;
  /** Active BU for upsert (null = default/All Businesses row). */
  activeBusinessUnitId?: string | null;
  initialThreshold: number;
  fetchError?: string | null;
};

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#18365c] disabled:cursor-not-allowed disabled:opacity-50";

export default function ProductSaleNotificationThresholdSettings({
  tenantId,
  activeBusinessUnitId = null,
  initialThreshold,
  fetchError = null,
}: ProductSaleNotificationThresholdSettingsProps) {
  const router = useRouter();
  const supabase = createClient();
  const [threshold, setThreshold] = useState(initialThreshold);
  const [error, setError] = useState<string | null>(fetchError);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setThreshold(initialThreshold);
  }, [initialThreshold]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setInfoMessage(null);

    const normalized = normalizeProductSaleNotificationThreshold(threshold);

    const { error: saveError } = await supabase.from("tax_settings").upsert(
      {
        tenant_id: tenantId,
        business_unit_id: activeBusinessUnitId,
        product_sale_notification_threshold: normalized,
        updated_at: new Date().toISOString(),
      },
      { onConflict: TAX_SETTINGS_ON_CONFLICT },
    );

    if (saveError) {
      setError(saveError.message);
      setSaving(false);
      return;
    }

    setThreshold(normalized);
    setInfoMessage("Product sale notification threshold saved.");
    setSaving(false);
    router.refresh();
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h3 className="mb-4 text-lg font-semibold text-[#0f2744]">
        Product Sale Notification Threshold
      </h3>
      <form onSubmit={handleSubmit} className="max-w-2xl space-y-4">
        {error ? (
          <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        {infoMessage ? (
          <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
            {infoMessage}
          </p>
        ) : null}

        <div>
          <label
            htmlFor="product_sale_notification_threshold"
            className="mb-1 block text-sm font-medium text-slate-700"
          >
            Large sale alert threshold (GHS)
          </label>
          <select
            id="product_sale_notification_threshold"
            value={String(threshold)}
            onChange={(event) =>
              setThreshold(
                normalizeProductSaleNotificationThreshold(
                  Number(event.target.value),
                ),
              )
            }
            className={inputClassName}
          >
            {PRODUCT_SALE_NOTIFICATION_THRESHOLD_OPTIONS.map((option) => (
              <option key={option.value} value={String(option.value)}>
                {option.label}
              </option>
            ))}
          </select>
          <p className="mt-2 text-sm text-slate-600">
            Admins and Directors receive an in-app notification when a product
            sale is recorded at or above this amount. Default is GHS{" "}
            {DEFAULT_PRODUCT_SALE_NOTIFICATION_THRESHOLD.toLocaleString("en-GH")}.
          </p>
        </div>

        <button
          type="submit"
          disabled={saving}
          className={primaryButtonClassName}
        >
          {saving ? "Saving…" : "Save Setting"}
        </button>
      </form>
    </section>
  );
}
