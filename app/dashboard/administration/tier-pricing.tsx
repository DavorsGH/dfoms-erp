"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import {
  formatBillingCycle,
  formatProductPrice,
  formatUsdPrice,
} from "../crm/products/products-utils";
import { getStripedRowClassName } from "../finance/register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";

export type TierPricingRow = {
  id: string;
  name: string;
  unit_price: number | null;
  price_ghs: number | null;
  billing_cycle: string | null;
  is_active: boolean | null;
};

type TierPricingProps = {
  initialRows: TierPricingRow[];
  fetchError: string | null;
};

const inputClassName =
  "w-full min-w-[7rem] rounded-md border border-slate-300 px-2 py-1 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

const actionButtonClassName =
  "shrink-0 whitespace-nowrap rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

const primaryActionButtonClassName =
  "shrink-0 whitespace-nowrap rounded-md border border-[#0f2744] px-2 py-1 text-xs font-medium text-[#0f2744] transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

type EditForm = {
  unit_price: string;
  price_ghs: string;
};

const TIER_RANK: Record<string, number> = {
  Starter: 0,
  Professional: 1,
  Business: 2,
  Enterprise: 3,
};

const BILLING_RANK: Record<string, number> = {
  monthly: 0,
  yearly: 1,
};

function tierSortKey(row: { name: string; billing_cycle: string | null }) {
  const tierName = Object.keys(TIER_RANK).find((tier) =>
    row.name.includes(tier),
  );
  const tierRank = tierName ? TIER_RANK[tierName] : 99;
  const billingRank = row.billing_cycle
    ? (BILLING_RANK[row.billing_cycle] ?? 99)
    : 99;
  return tierRank * 10 + billingRank;
}

function sortTierPricingRows(rows: TierPricingRow[]): TierPricingRow[] {
  return [...rows].sort(
    (a, b) => tierSortKey(a) - tierSortKey(b) || a.name.localeCompare(b.name),
  );
}

function toEditForm(row: TierPricingRow): EditForm {
  return {
    unit_price:
      row.unit_price === null || row.unit_price === undefined
        ? ""
        : String(row.unit_price),
    price_ghs:
      row.price_ghs === null || row.price_ghs === undefined
        ? ""
        : String(row.price_ghs),
  };
}

export default function TierPricing({
  initialRows,
  fetchError,
}: TierPricingProps) {
  const router = useRouter();
  const [rows, setRows] = useState(() => sortTierPricingRows(initialRows));
  const [error, setError] = useState<string | null>(fetchError);
  const [warning, setWarning] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<EditForm>({
    unit_price: "",
    price_ghs: "",
  });
  const [savingId, setSavingId] = useState<string | null>(null);

  useEffect(() => {
    setRows(sortTierPricingRows(initialRows));
  }, [initialRows]);

  function openEdit(row: TierPricingRow) {
    setEditingId(row.id);
    setEditForm(toEditForm(row));
    setError(null);
    setWarning(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditForm({ unit_price: "", price_ghs: "" });
  }

  async function handleSave(row: TierPricingRow) {
    const unitPrice = Number(editForm.unit_price);
    const priceGhs = Number(editForm.price_ghs);

    if (!Number.isFinite(unitPrice) || !Number.isFinite(priceGhs)) {
      setError("Price (USD) and price (GHS) must be valid numbers.");
      return;
    }

    if (unitPrice < 0 || priceGhs < 0) {
      setError("Prices cannot be negative.");
      return;
    }

    const confirmed = window.confirm(
      `Update ${row.name} to USD ${unitPrice.toFixed(2)} / GHS ${priceGhs.toFixed(2)}? This affects pricing shown to new signups.`,
    );
    if (!confirmed) {
      return;
    }

    setSavingId(row.id);
    setError(null);
    setWarning(null);

    const response = await fetch("/api/admin/tenants/update-pricing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: row.id,
        unit_price: unitPrice,
        price_ghs: priceGhs,
      }),
    });

    const payload = (await response.json().catch(() => null)) as
      | { error?: string; warning?: string; success?: boolean }
      | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to update pricing.");
      setSavingId(null);
      return;
    }

    setRows((current) =>
      sortTierPricingRows(
        current.map((entry) =>
          entry.id === row.id
            ? { ...entry, unit_price: unitPrice, price_ghs: priceGhs }
            : entry,
        ),
      ),
    );
    if (payload?.warning) {
      setWarning(payload.warning);
    }
    cancelEdit();
    setSavingId(null);
    router.refresh();
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-600">
        Manage ERP Suite subscription tier pricing for customer signups. Changes
        apply to new billing only; existing subscriptions keep their assigned
        tier.
      </p>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {warning ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {warning}
        </p>
      ) : null}

      <ScrollableTable>
        <table className={scrollableTableClassName}>
          <thead className={scrollableTableHeadClassName}>
            <tr>
              <th className={scrollableTableThClassName}>Tier</th>
              <th className={scrollableTableThClassName}>Billing Cycle</th>
              <th className={scrollableTableThClassName}>Price (USD)</th>
              <th className={scrollableTableThClassName}>Price (GHS)</th>
              <th className={scrollableTableThClassName}>Active</th>
              <th className={scrollableTableThClassName}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {rows.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-8 text-center text-sm text-slate-500"
                >
                  No ERP Suite pricing tiers found.
                </td>
              </tr>
            ) : (
              rows.map((row, index) => {
                const isEditing = editingId === row.id;
                const isSaving = savingId === row.id;

                return (
                  <tr key={row.id} className={getStripedRowClassName(index)}>
                    <td className="px-4 py-3 font-medium text-[#0f2744]">
                      {row.name}
                    </td>
                    <td className="px-4 py-3">
                      {formatBillingCycle(row.billing_cycle)}
                    </td>
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          required
                          value={editForm.unit_price}
                          onChange={(event) =>
                            setEditForm((current) => ({
                              ...current,
                              unit_price: event.target.value,
                            }))
                          }
                          className={inputClassName}
                        />
                      ) : (
                        formatUsdPrice(row.unit_price)
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {isEditing ? (
                        <input
                          type="number"
                          min="0"
                          step="0.01"
                          required
                          value={editForm.price_ghs}
                          onChange={(event) =>
                            setEditForm((current) => ({
                              ...current,
                              price_ghs: event.target.value,
                            }))
                          }
                          className={inputClassName}
                        />
                      ) : (
                        formatProductPrice(row.price_ghs)
                      )}
                    </td>
                    <td className="px-4 py-3">
                      {row.is_active ? "Yes" : "No"}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        {isEditing ? (
                          <>
                            <button
                              type="button"
                              disabled={isSaving}
                              onClick={() => handleSave(row)}
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
                            disabled={Boolean(savingId)}
                            onClick={() => openEdit(row)}
                            className={primaryActionButtonClassName}
                          >
                            Edit
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </ScrollableTable>
    </div>
  );
}
