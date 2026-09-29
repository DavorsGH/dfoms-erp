"use client";

import { useEffect, useState } from "react";
import DashboardButton from "@/components/dashboard-button";
import { formatGHS } from "../finance/income-register-utils";
import {
  deletePosHeldCart,
  fetchPosHeldCarts,
  heldCartItemCount,
  heldCartTotal,
  isPosHeldCartOld,
  type PosHeldCartRow,
  type PosRecallLineWarning,
} from "./pos-held-cart-utils";
import type { SupabaseClient } from "@supabase/supabase-js";

type PosHeldCartsPanelProps = {
  supabase: SupabaseClient;
  tenantId: string;
  open: boolean;
  onClose: () => void;
  onRecall: (row: PosHeldCartRow) => void;
  onCountChange?: (count: number) => void;
};

function formatHeldTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) {
    return iso;
  }
  return date.toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" });
}

export function PosHoldLabelDialog({
  open,
  defaultLabel,
  busy,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  defaultLabel: string;
  busy: boolean;
  onCancel: () => void;
  onConfirm: (label: string) => void;
}) {
  const [label, setLabel] = useState(defaultLabel);

  useEffect(() => {
    if (open) {
      setLabel(defaultLabel);
    }
  }, [open, defaultLabel]);

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-[#0f2744]">Hold cart</h2>
        <p className="mt-1 text-sm text-slate-600">
          Optional label (e.g. customer name). The till will be cleared after saving.
        </p>
        <input
          type="text"
          value={label}
          onChange={(event) => setLabel(event.target.value)}
          className="mt-4 w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
          placeholder="Label"
          autoFocus
        />
        <div className="mt-6 flex justify-end gap-2">
          <DashboardButton variant="secondary" disabled={busy} onClick={onCancel}>
            Cancel
          </DashboardButton>
          <DashboardButton
            variant="warning"
            disabled={busy}
            onClick={() => onConfirm(label)}
          >
            {busy ? "Saving…" : "Hold cart"}
          </DashboardButton>
        </div>
      </div>
    </div>
  );
}

export function PosRecallWarningsDialog({
  open,
  warnings,
  storeCreditError,
  busy,
  onCancel,
  onAccept,
}: {
  open: boolean;
  warnings: PosRecallLineWarning[];
  storeCreditError: string | null;
  busy: boolean;
  onCancel: () => void;
  onAccept: () => void;
}) {
  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-lg bg-white p-6 shadow-xl">
        <h2 className="text-lg font-semibold text-[#0f2744]">Review recalled cart</h2>
        <p className="mt-2 text-sm text-slate-600">
          Prices and stock are checked again. Adjust lines after recall if needed.
        </p>
        {warnings.length > 0 ? (
          <ul className="mt-4 space-y-3 text-sm">
            {warnings.map((warning) => (
              <li
                key={`${warning.productCode}-${warning.productName}`}
                className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-amber-950"
              >
                <p className="font-medium">
                  {warning.productCode} — {warning.productName}
                </p>
                {warning.priceChanged ? (
                  <p>
                    Price changed: held {formatGHS(warning.heldUnitPrice)} → now{" "}
                    {formatGHS(warning.currentUnitPrice)} (current price applied).
                  </p>
                ) : null}
                {warning.insufficientStock ? (
                  <p>
                    Stock insufficient: held qty {warning.heldQuantity}, only{" "}
                    {warning.maxAvailable} available now.
                  </p>
                ) : null}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-slate-600">No price or stock warnings.</p>
        )}
        {storeCreditError ? (
          <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
            Store credit will not be applied: {storeCreditError}
          </p>
        ) : null}
        <div className="mt-6 flex justify-end gap-2">
          <DashboardButton variant="secondary" disabled={busy} onClick={onCancel}>
            Cancel
          </DashboardButton>
          <DashboardButton
            variant="success"
            disabled={busy}
            onClick={onAccept}
          >
            {busy ? "Loading…" : "Accept & load cart"}
          </DashboardButton>
        </div>
      </div>
    </div>
  );
}

export default function PosHeldCartsPanel({
  supabase,
  tenantId,
  open,
  onClose,
  onRecall,
  onCountChange,
}: PosHeldCartsPanelProps) {
  const [rows, setRows] = useState<PosHeldCartRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [discardingId, setDiscardingId] = useState<string | null>(null);

  async function loadRows() {
    setLoading(true);
    setError(null);
    try {
      const next = await fetchPosHeldCarts(supabase, tenantId);
      setRows(next);
      onCountChange?.(next.length);
    } catch (loadError) {
      setError(
        loadError instanceof Error ? loadError.message : "Could not load held carts.",
      );
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (open) {
      void loadRows();
    }
  }, [open, tenantId]);

  async function handleDiscard(id: string) {
    setDiscardingId(id);
    setError(null);
    try {
      await deletePosHeldCart(supabase, id);
      await loadRows();
    } catch (discardError) {
      setError(
        discardError instanceof Error
          ? discardError.message
          : "Could not discard held cart.",
      );
    } finally {
      setDiscardingId(null);
    }
  }

  if (!open) {
    return null;
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4">
      <div className="flex max-h-[90dvh] w-full max-w-2xl flex-col rounded-t-xl bg-white shadow-xl sm:rounded-lg">
        <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
          <h2 className="text-lg font-semibold text-[#0f2744]">Held carts</h2>
          <DashboardButton variant="secondary" onClick={onClose}>
            Close
          </DashboardButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          {error ? (
            <p className="mb-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800">
              {error}
            </p>
          ) : null}
          {loading ? (
            <p className="text-sm text-slate-600">Loading…</p>
          ) : rows.length === 0 ? (
            <p className="text-sm text-slate-500">No held carts for this business unit.</p>
          ) : (
            <ul className="space-y-3">
              {rows.map((row) => {
                const old = isPosHeldCartOld(row.held_at);
                return (
                  <li
                    key={row.id}
                    className="rounded-lg border border-slate-200 p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="font-medium text-[#0f2744]">
                          {row.label}
                          {old ? (
                            <span className="ml-2 rounded bg-amber-100 px-2 py-0.5 text-xs font-semibold text-amber-900">
                              Old
                            </span>
                          ) : null}
                        </p>
                        <p className="text-sm text-slate-600">
                          {heldCartItemCount(row)} item
                          {heldCartItemCount(row) === 1 ? "" : "s"} ·{" "}
                          {formatGHS(heldCartTotal(row))}
                        </p>
                        <p className="text-xs text-slate-500">
                          Held by {row.heldByLabel ?? row.held_by} ·{" "}
                          {formatHeldTime(row.held_at)}
                        </p>
                      </div>
                      <div className="flex shrink-0 gap-2">
                        <DashboardButton
                          variant="primary"
                          disabled={discardingId !== null}
                          onClick={() => onRecall(row)}
                        >
                          Recall
                        </DashboardButton>
                        <DashboardButton
                          variant="danger"
                          disabled={discardingId === row.id}
                          onClick={() => void handleDiscard(row.id)}
                        >
                          {discardingId === row.id ? "…" : "Discard"}
                        </DashboardButton>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
