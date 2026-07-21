"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { InventoryBalanceConfigRow } from "@/utils/inventory-balance-config-types";

type InventoryGoLiveSettingsProps = {
  initialConfig: InventoryBalanceConfigRow | null;
  fetchError: string | null;
};

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50";

function todayDate(): string {
  return new Date().toISOString().slice(0, 10);
}

export default function InventoryGoLiveSettings({
  initialConfig,
  fetchError,
}: InventoryGoLiveSettingsProps) {
  const router = useRouter();
  const [goLiveDate, setGoLiveDate] = useState(
    initialConfig?.go_live_date ?? todayDate(),
  );
  const [openingInventoryValue, setOpeningInventoryValue] = useState(
    String(initialConfig?.opening_inventory_value ?? 0),
  );
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(fetchError);
  const [success, setSuccess] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);

    const response = await fetch("/api/inventory-balance-config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        go_live_date: goLiveDate,
        opening_inventory_value: openingInventoryValue,
      }),
    });
    const payload = (await response.json().catch(() => null)) as
      | {
          error?: string;
          inventory_balance_config?: InventoryBalanceConfigRow;
        }
      | null;

    if (!response.ok || !payload?.inventory_balance_config) {
      setError(payload?.error ?? "Unable to save inventory go-live settings.");
      setSaving(false);
      return;
    }

    setGoLiveDate(payload.inventory_balance_config.go_live_date);
    setOpeningInventoryValue(
      String(payload.inventory_balance_config.opening_inventory_value),
    );
    setSuccess("Inventory go-live settings saved.");
    setSaving(false);
    router.refresh();
  }

  return (
    <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <div className="max-w-2xl">
        <h3 className="text-lg font-semibold text-[#0f2744]">
          Inventory Go-Live
        </h3>
        <p className="mt-1 text-sm text-slate-600">
          Controls when live inventory accounting starts for this workspace and
          the opening inventory equity recognized on that date.
        </p>

        {error ? (
          <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        {success ? (
          <p className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
            {success}
          </p>
        ) : null}

        {!initialConfig ? (
          <p className="mt-4 rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
            No inventory go-live configuration exists yet. Saving this form will
            create one for your workspace.
          </p>
        ) : null}

        <form onSubmit={handleSubmit} className="mt-6 space-y-5">
          <div>
            <label
              htmlFor="inventory-go-live-date"
              className="mb-1 block text-sm font-medium text-slate-700"
            >
              Go-Live Date
            </label>
            <input
              id="inventory-go-live-date"
              type="date"
              required
              value={goLiveDate}
              onChange={(event) => setGoLiveDate(event.target.value)}
              className={inputClassName}
            />
            <p className="mt-1 text-xs text-slate-500">
              Inventory purchases before this date are excluded from live
              inventory cash and opening-equity calculations.
            </p>
          </div>

          <div>
            <label
              htmlFor="opening-inventory-value"
              className="mb-1 block text-sm font-medium text-slate-700"
            >
              Opening Inventory Value (GHS)
            </label>
            <input
              id="opening-inventory-value"
              type="number"
              min={0}
              step="0.01"
              required
              value={openingInventoryValue}
              onChange={(event) => setOpeningInventoryValue(event.target.value)}
              className={inputClassName}
            />
            <p className="mt-1 text-xs text-slate-500">
              Enter the total inventory value already on hand at go-live. Use
              zero for a new workspace with no opening stock.
            </p>
          </div>

          <button
            type="submit"
            disabled={saving}
            className={primaryButtonClassName}
          >
            {saving ? "Saving…" : initialConfig ? "Save Changes" : "Create Settings"}
          </button>
        </form>
      </div>
    </section>
  );
}
