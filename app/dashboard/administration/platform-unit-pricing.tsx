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
  valueKind?: "price" | "integer";
};

type PlatformUnitPricingProps = {
  initialRows: PlatformUnitPricingRow[];
  fetchError: string | null;
};

const inputClassName =
  "w-full min-w-[7rem] rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

const actionButtonClassName =
  "shrink-0 whitespace-nowrap rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

const primaryActionButtonClassName =
  "shrink-0 whitespace-nowrap rounded-md border border-[#0f2744] px-2 py-1 text-xs font-medium text-[#0f2744] transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

function formatRowValue(row: PlatformUnitPricingRow): string {
  if (row.valueKind === "integer") {
    return String(Math.trunc(row.priceGhs));
  }
  return formatProductPrice(row.priceGhs);
}

function formatValueColumnLabel(row: PlatformUnitPricingRow): string {
  return row.valueKind === "integer" ? "Cap (units)" : "Price (GHS)";
}

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
  initialRows,
  fetchError,
}: PlatformUnitPricingProps) {
  const router = useRouter();
  const [rows, setRows] = useState(initialRows);
  const [error, setError] = useState<string | null>(fetchError);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [priceInputs, setPriceInputs] = useState<Record<string, string>>({});
  const [savingKey, setSavingKey] = useState<string | null>(null);

  useEffect(() => {
    setRows(initialRows);
    setPriceInputs(
      Object.fromEntries(initialRows.map((row) => [row.configKey, String(row.priceGhs)])),
    );
  }, [initialRows]);

  function openEdit(configKey: string) {
    const row = rows.find((item) => item.configKey === configKey);
    if (!row) {
      return;
    }
    setEditingKey(configKey);
    setPriceInputs((current) => ({
      ...current,
      [configKey]: String(row.priceGhs),
    }));
    setError(null);
  }

  function cancelEdit() {
    setEditingKey(null);
  }

  async function handleSave(configKey: string) {
    const row = rows.find((item) => item.configKey === configKey);
    if (!row) {
      return;
    }

    const rawValue = Number(priceInputs[configKey]);
    const isIntegerRow = row.valueKind === "integer";

    if (!Number.isFinite(rawValue)) {
      setError(
        isIntegerRow
          ? "Cap must be a valid whole number."
          : "Price (GHS) must be a valid number.",
      );
      return;
    }

    if (rawValue < 0) {
      setError(isIntegerRow ? "Cap cannot be negative." : "Price cannot be negative.");
      return;
    }

    const savedValue = isIntegerRow ? Math.trunc(rawValue) : rawValue;
    if (isIntegerRow && savedValue !== rawValue) {
      setError("Cap must be a whole number.");
      return;
    }

    const confirmed = window.confirm(
      isIntegerRow
        ? `Update ${row.label.toLowerCase()} to ${savedValue} units? Platform-only landlords are not charged for activation or recurring billing on units beyond this cap.`
        : `Update ${row.label.toLowerCase()} to GHS ${savedValue.toFixed(2)}? New charges use this rate; historical audit rows keep their recorded amounts.`,
    );
    if (!confirmed) {
      return;
    }

    setSavingKey(configKey);
    setError(null);

    const response = await fetch("/api/admin/platform-billing/update-pricing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        isIntegerRow
          ? { config_key: configKey, unit_cap: savedValue }
          : { config_key: configKey, price_ghs: savedValue },
      ),
    });

    const payload = (await response.json().catch(() => null)) as
      | { error?: string; success?: boolean; updated_at?: string }
      | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to update pricing.");
      setSavingKey(null);
      return;
    }

    const updatedAt =
      typeof payload?.updated_at === "string"
        ? payload.updated_at
        : new Date().toISOString();
    setRows((current) =>
      current.map((item) =>
        item.configKey === configKey
          ? { ...item, priceGhs: savedValue, updatedAt }
          : item,
      ),
    );
    cancelEdit();
    setSavingKey(null);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-600">
        Manage per-unit pricing and billing limits for platform-only landlords.
        Monthly rate applies to unit activation and monthly recurring billing.
        Annual rate applies to annual recurring billing and immediate annual cycle
        switches. The active-unit cap limits how many units are billed — units
        beyond the cap activate free of charge and are excluded from recurring
        billing.
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
              <th className={scrollableTableThClassName}>Value</th>
              <th className={scrollableTableThClassName}>Last updated</th>
              <th className={scrollableTableThClassName}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {rows.map((row, index) => {
              const isEditing = editingKey === row.configKey;
              const isSaving = savingKey === row.configKey;
              return (
                <tr key={row.configKey} className={getStripedRowClassName(index)}>
                  <td className="px-4 py-3 font-medium text-[#0f2744]">
                    {row.label}
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-xs text-slate-500">
                      {formatValueColumnLabel(row)}
                    </div>
                    {isEditing ? (
                      <input
                        type="number"
                        min="0"
                        step={row.valueKind === "integer" ? "1" : "0.01"}
                        required
                        value={priceInputs[row.configKey] ?? ""}
                        onChange={(event) =>
                          setPriceInputs((current) => ({
                            ...current,
                            [row.configKey]: event.target.value,
                          }))
                        }
                        className={inputClassName}
                      />
                    ) : (
                      formatRowValue(row)
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
                            disabled={isSaving}
                            onClick={() => void handleSave(row.configKey)}
                            className={primaryActionButtonClassName}
                          >
                            {isSaving ? "Saving…" : "Save"}
                          </button>
                          <button
                            type="button"
                            disabled={isSaving}
                            onClick={cancelEdit}
                            className={actionButtonClassName}
                          >
                            Cancel
                          </button>
                        </>
                      ) : (
                        <button
                          type="button"
                          disabled={isSaving}
                          onClick={() => openEdit(row.configKey)}
                          className={primaryActionButtonClassName}
                        >
                          Edit
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </ScrollableTable>
    </div>
  );
}
