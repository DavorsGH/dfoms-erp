"use client";

import { confirmDialog } from "@/components/feedback/app-dialogs";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { BusinessUnitRow } from "@/utils/business-units-types";

type PlatformBillingBusinessUnitProps = {
  businessUnits: BusinessUnitRow[];
  initialBusinessUnitId: string | null;
  initialUpdatedAt: string | null;
  fetchError: string | null;
};

const selectClassName =
  "w-full max-w-md rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

const primaryActionButtonClassName =
  "rounded-md border border-[#0f2744] px-3 py-1.5 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

function formatUpdatedAt(value: string | null): string {
  if (!value) {
    return "—";
  }
  return new Date(value).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function PlatformBillingBusinessUnit({
  businessUnits,
  initialBusinessUnitId,
  initialUpdatedAt,
  fetchError,
}: PlatformBillingBusinessUnitProps) {
  const router = useRouter();
  const activeUnits = businessUnits.filter((unit) => unit.is_active !== false);
  const defaultSelection =
    initialBusinessUnitId ??
    activeUnits.find((unit) => unit.is_primary)?.id ??
    activeUnits[0]?.id ??
    "";

  const [selectedId, setSelectedId] = useState(defaultSelection);
  const [updatedAt, setUpdatedAt] = useState(initialUpdatedAt);
  const [error, setError] = useState<string | null>(fetchError);
  const [saving, setSaving] = useState(false);

  const selectedLabel =
    activeUnits.find((unit) => unit.id === selectedId)?.name ?? selectedId;

  async function handleSave() {
    if (!selectedId) {
      setError("Choose a business unit.");
      return;
    }

    const confirmed = await confirmDialog({
      message: `Route new platform billing income and Paystack fee postings to "${selectedLabel}"? Existing register rows are not changed.`,
    });
    if (!confirmed) {
      return;
    }

    setSaving(true);
    setError(null);

    const response = await fetch("/api/admin/platform-billing/update-business-unit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ business_unit_id: selectedId }),
    });

    const payload = (await response.json().catch(() => null)) as
      | { error?: string; updated_at?: string }
      | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to update business unit.");
      setSaving(false);
      return;
    }

    setUpdatedAt(
      typeof payload?.updated_at === "string"
        ? payload.updated_at
        : new Date().toISOString(),
    );
    setSaving(false);
    router.refresh();
  }

  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div>
        <h3 className="text-base font-semibold text-[#0f2744]">
          Business unit for platform billing
        </h3>
        <p className="mt-1 text-sm text-slate-600">
          ERP Suite subscriptions, SMS credit purchases, platform-only unit
          charges, and their Paystack transaction fees post to this business unit
          in the Davors workspace. POS sales, client invoices, and rent payments
          are unchanged.
        </p>
      </div>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {activeUnits.length === 0 ? (
        <p className="text-sm text-amber-800">
          No active business units found in the Davors workspace. Create one under
          Administration → Business Units.
        </p>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
          <label className="flex flex-1 flex-col gap-1 text-sm text-slate-700">
            <span className="font-medium">Business unit</span>
            <select
              className={selectClassName}
              value={selectedId}
              onChange={(event) => setSelectedId(event.target.value)}
              disabled={saving}
            >
              {activeUnits.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.name}
                  {unit.is_primary ? " (primary)" : ""}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={primaryActionButtonClassName}
            onClick={() => void handleSave()}
            disabled={saving || !selectedId}
          >
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      )}

      <p className="text-xs text-slate-500">Last updated: {formatUpdatedAt(updatedAt)}</p>
    </section>
  );
}
