"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { formatProductPrice } from "../crm/products/products-utils";
import { getStripedRowClassName } from "../finance/register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";

export type PlatformUnitPricingRow = {
  configKey: string;
  label: string;
  priceGhs: number;
  updatedAt: string | null;
};

type PlatformUnitPricingProps = {
  initialRow: PlatformUnitPricingRow;
  fetchError: string | null;
};

const inputClassName =
  "w-full min-w-[7rem] rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

const actionButtonClassName =
  "shrink-0 whitespace-nowrap rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

const primaryActionButtonClassName =
  "shrink-0 whitespace-nowrap rounded-md border border-[#0f2744] px-2 py-1 text-xs font-medium text-[#0f2744] transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

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

export default function PlatformUnitPricing({
  initialRow,
  fetchError,
}: PlatformUnitPricingProps) {
  const router = useRouter();
  const [row, setRow] = useState(initialRow);
  const [error, setError] = useState<string | null>(fetchError);
  const [isEditing, setIsEditing] = useState(false);
  const [priceGhsInput, setPriceGhsInput] = useState(String(initialRow.priceGhs));
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setRow(initialRow);
    setPriceGhsInput(String(initialRow.priceGhs));
  }, [initialRow]);

  function openEdit() {
    setIsEditing(true);
    setPriceGhsInput(String(row.priceGhs));
    setError(null);
  }

  function cancelEdit() {
    setIsEditing(false);
    setPriceGhsInput(String(row.priceGhs));
  }

  async function handleSave() {
    const priceGhs = Number(priceGhsInput);

    if (!Number.isFinite(priceGhs)) {
      setError("Price (GHS) must be a valid number.");
      return;
    }

    if (priceGhs < 0) {
      setError("Price cannot be negative.");
      return;
    }

    const confirmed = window.confirm(
      `Update platform-only unit activation price to GHS ${priceGhs.toFixed(2)}? This affects new unit activations only; historical charges keep their recorded amounts.`,
    );
    if (!confirmed) {
      return;
    }

    setSaving(true);
    setError(null);

    const response = await fetch("/api/admin/platform-billing/update-pricing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ price_ghs: priceGhs }),
    });

    const payload = (await response.json().catch(() => null)) as
      | { error?: string; success?: boolean; updated_at?: string }
      | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to update pricing.");
      setSaving(false);
      return;
    }

    const updatedAt =
      typeof payload?.updated_at === "string" ? payload.updated_at : new Date().toISOString();
    setRow((current) => ({
      ...current,
      priceGhs,
      updatedAt,
    }));
    cancelEdit();
    setSaving(false);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-600">
        Manage per-unit activation pricing for platform-only landlords. Changes
        apply to new activations and reactivations only; existing audit records
        in landlord_unit_activation_charges keep the amount actually charged.
      </p>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <ScrollableTable>
        <table className={scrollableTableClassName}>
          <thead className={scrollableTableHeadClassName}>
            <tr>
              <th className={scrollableTableThClassName}>Setting</th>
              <th className={scrollableTableThClassName}>Price (GHS)</th>
              <th className={scrollableTableThClassName}>Last updated</th>
              <th className={scrollableTableThClassName}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            <tr className={getStripedRowClassName(0)}>
              <td className="px-4 py-3 font-medium text-[#0f2744]">{row.label}</td>
              <td className="px-4 py-3">
                {isEditing ? (
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    required
                    value={priceGhsInput}
                    onChange={(event) => setPriceGhsInput(event.target.value)}
                    className={inputClassName}
                  />
                ) : (
                  formatProductPrice(row.priceGhs)
                )}
              </td>
              <td className="px-4 py-3 text-sm text-slate-700">
                {formatUpdatedAt(row.updatedAt)}
              </td>
              <td className="px-4 py-3">
                <div className="flex flex-wrap gap-2">
                  {isEditing ? (
                    <>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={() => void handleSave()}
                        className={primaryActionButtonClassName}
                      >
                        {saving ? "Saving…" : "Save"}
                      </button>
                      <button
                        type="button"
                        disabled={saving}
                        onClick={cancelEdit}
                        className={actionButtonClassName}
                      >
                        Cancel
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      disabled={saving}
                      onClick={openEdit}
                      className={primaryActionButtonClassName}
                    >
                      Edit
                    </button>
                  )}
                </div>
              </td>
            </tr>
          </tbody>
        </table>
      </ScrollableTable>
    </div>
  );
}
