"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { inputClassName } from "../../employees/employee-record-utils";
import { formatGHS } from "../../finance/income-register-utils";

export type OfflineSaleConflictRow = {
  id: string;
  tenant_id: string;
  client_op_id: string;
  status: string;
  claim: Record<string, unknown> | null;
  stock_at_conflict: unknown;
  suspense_income_id: string | null;
  suspense_invoice_no: string | null;
  resolution: Record<string, unknown> | null;
  resolved_at: string | null;
  resolved_by: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

type ClaimLine = {
  product_id: string;
  product_code?: string;
  product_name?: string;
  quantity: number;
  unit_price: number;
};

type StockAtConflictRow = {
  product_id: string;
  claimed_qty: number;
  stock_qty: number;
  shortfall: number;
};

type CashDiffAction = "refund" | "credit_customer" | "misc_income" | "";
type ResolveAction = "A" | "B" | "C" | null;

const CASH_ACTIONS: Array<{ value: CashDiffAction; label: string }> = [
  { value: "refund", label: "Refund" },
  { value: "credit_customer", label: "Credit customer" },
  { value: "misc_income", label: "Misc income" },
];

function asClaimLines(claim: Record<string, unknown> | null): ClaimLine[] {
  const raw = claim?.lines;
  if (!Array.isArray(raw)) {
    return [];
  }
  return raw
    .map((row) => {
      if (!row || typeof row !== "object") {
        return null;
      }
      const item = row as Record<string, unknown>;
      const productId = String(item.product_id ?? "");
      const quantity = Number(item.quantity ?? 0);
      const unitPrice = Number(item.unit_price ?? 0);
      if (!productId) {
        return null;
      }
      const line: ClaimLine = {
        product_id: productId,
        product_code:
          typeof item.product_code === "string" ? item.product_code : undefined,
        product_name:
          typeof item.product_name === "string" ? item.product_name : undefined,
        quantity: Number.isFinite(quantity) ? quantity : 0,
        unit_price: Number.isFinite(unitPrice) ? unitPrice : 0,
      };
      return line;
    })
    .filter((line): line is ClaimLine => line != null);
}

function asStockRows(stock: unknown): StockAtConflictRow[] {
  if (!Array.isArray(stock)) {
    return [];
  }
  return stock
    .map((row) => {
      if (!row || typeof row !== "object") {
        return null;
      }
      const item = row as Record<string, unknown>;
      const productId = String(item.product_id ?? "");
      if (!productId) {
        return null;
      }
      return {
        product_id: productId,
        claimed_qty: Number(item.claimed_qty ?? 0),
        stock_qty: Number(item.stock_qty ?? 0),
        shortfall: Number(item.shortfall ?? 0),
      };
    })
    .filter((row): row is StockAtConflictRow => row != null);
}

function claimAmountReceived(claim: Record<string, unknown> | null): number {
  const value = Number(claim?.amount_received ?? 0);
  return Number.isFinite(value) ? value : 0;
}

function formatStatus(status: string): string {
  switch (status) {
    case "open":
      return "Open";
    case "resolved_a":
      return "Resolved (A)";
    case "resolved_b":
      return "Resolved (B)";
    case "resolved_c":
      return "Resolved (C)";
    default:
      return status;
  }
}

export default function OfflineSaleConflictsPanel({
  initialConflicts,
  fetchError,
}: {
  initialConflicts: OfflineSaleConflictRow[];
  fetchError: string | null;
}) {
  const supabase = createClient();
  const [conflicts, setConflicts] = useState(initialConflicts);
  const [error, setError] = useState<string | null>(fetchError);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [selectedAction, setSelectedAction] = useState<ResolveAction>(null);
  const [confirmedQtyByProduct, setConfirmedQtyByProduct] = useState<
    Record<string, string>
  >({});
  const [cashDifferenceAction, setCashDifferenceAction] =
    useState<CashDiffAction>("");
  const [cashDifferenceNote, setCashDifferenceNote] = useState("");
  const [writeOffReason, setWriteOffReason] = useState("");
  const [reclassAction, setReclassAction] = useState<CashDiffAction>("");
  const [reclassReason, setReclassReason] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const openCount = useMemo(
    () => conflicts.filter((row) => row.status === "open").length,
    [conflicts],
  );

  function resetResolutionForm() {
    setSelectedAction(null);
    setConfirmedQtyByProduct({});
    setCashDifferenceAction("");
    setCashDifferenceNote("");
    setWriteOffReason("");
    setReclassAction("");
    setReclassReason("");
  }

  function openResolve(conflict: OfflineSaleConflictRow) {
    const stockRows = asStockRows(conflict.stock_at_conflict);
    const claimLines = asClaimLines(conflict.claim);
    const defaults: Record<string, string> = {};
    for (const line of claimLines) {
      const stock = stockRows.find((row) => row.product_id === line.product_id);
      const stockQty = stock?.stock_qty ?? 0;
      defaults[line.product_id] = String(Math.min(line.quantity, stockQty));
    }
    setExpandedId(conflict.id);
    resetResolutionForm();
    setConfirmedQtyByProduct(defaults);
    setError(null);
  }

  async function refreshConflicts() {
    const { data, error: refreshError } = await supabase
      .from("offline_sale_conflicts")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(100);

    if (refreshError) {
      setError(refreshError.message);
      return;
    }

    setConflicts((data as OfflineSaleConflictRow[] | null) ?? []);
  }

  async function submitResolution(conflict: OfflineSaleConflictRow) {
    if (!selectedAction) {
      setError("Select resolution A, B, or C.");
      return;
    }

    setSubmitting(true);
    setError(null);

    try {
      let p_params: Record<string, unknown> = {};

      if (selectedAction === "A") {
        const claimLines = asClaimLines(conflict.claim);
        const confirmed_lines = claimLines
          .map((line) => {
            const qty = Number.parseFloat(
              confirmedQtyByProduct[line.product_id] ?? "0",
            );
            return {
              product_id: line.product_id,
              quantity: Number.isFinite(qty) ? qty : 0,
            };
          })
          .filter((line) => line.quantity > 0);

        if (confirmed_lines.length === 0) {
          setError("Enter at least one confirmed quantity greater than zero.");
          setSubmitting(false);
          return;
        }

        const confirmedTotal = confirmed_lines.reduce((sum, line) => {
          const claimLine = claimLines.find(
            (item) => item.product_id === line.product_id,
          );
          return sum + line.quantity * (claimLine?.unit_price ?? 0);
        }, 0);
        const remainder =
          claimAmountReceived(conflict.claim) - confirmedTotal;

        if (remainder > 0.009) {
          if (!cashDifferenceAction) {
            setError("Select a cash difference action for the remainder.");
            setSubmitting(false);
            return;
          }
          if (!cashDifferenceNote.trim()) {
            setError("Enter a cash difference note for the remainder.");
            setSubmitting(false);
            return;
          }
        }

        p_params = {
          confirmed_lines,
          cash_difference_action: cashDifferenceAction || null,
          cash_difference_note:
            cashDifferenceNote.trim() ||
            (remainder > 0.009 ? "" : "No cash difference"),
        };
      } else if (selectedAction === "B") {
        if (!writeOffReason.trim()) {
          setError("Write-off reason is required for action B.");
          setSubmitting(false);
          return;
        }
        p_params = { write_off_reason: writeOffReason.trim() };
      } else {
        if (!reclassAction) {
          setError("Select a reclass action for C.");
          setSubmitting(false);
          return;
        }
        if (!reclassReason.trim()) {
          setError("Reason is required for action C.");
          setSubmitting(false);
          return;
        }
        p_params = {
          reclass_action: reclassAction,
          reason: reclassReason.trim(),
        };
      }

      const { error: rpcError } = await supabase.rpc(
        "resolve_offline_sale_conflict",
        {
          p_conflict_id: conflict.id,
          p_action: selectedAction,
          p_params,
        },
      );

      if (rpcError) {
        setError(rpcError.message);
        setSubmitting(false);
        return;
      }

      setExpandedId(null);
      resetResolutionForm();
      await refreshConflicts();
    } catch (resolveError) {
      setError(
        resolveError instanceof Error
          ? resolveError.message
          : "Failed to resolve conflict.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-sm text-slate-600">
        Stock shortfalls from offline cash POS sync. Open conflicts require an
        explicit A / B / C resolution — nothing is pre-selected.
      </p>
      <p className="text-sm text-slate-700">
        Open:{" "}
        <span className="font-semibold text-[#0f2744]">{openCount}</span>
        {" · "}
        Showing {conflicts.length} most recent
      </p>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {conflicts.length === 0 ? (
        <p className="rounded-md border border-slate-200 bg-white px-4 py-6 text-sm text-slate-500">
          No offline sale conflicts.
        </p>
      ) : (
        <ul className="space-y-4">
          {conflicts.map((conflict) => {
            const claim = conflict.claim;
            const claimLines = asClaimLines(claim);
            const stockRows = asStockRows(conflict.stock_at_conflict);
            const isOpen = conflict.status === "open";
            const isExpanded = expandedId === conflict.id;
            const amount = claimAmountReceived(claim);

            return (
              <li
                key={conflict.id}
                className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 space-y-1">
                    <p className="font-medium text-[#0f2744]">
                      {conflict.suspense_invoice_no?.trim() || "No suspense invoice"}{" "}
                      <span
                        className={`ml-2 inline-block rounded px-2 py-0.5 text-xs font-semibold ${
                          isOpen
                            ? "bg-amber-100 text-amber-900"
                            : "bg-slate-100 text-slate-700"
                        }`}
                      >
                        {formatStatus(conflict.status)}
                      </span>
                    </p>
                    <p className="text-xs text-slate-500">
                      Created {new Date(conflict.created_at).toLocaleString()}
                      {" · "}
                      Op {conflict.client_op_id.slice(0, 8)}…
                    </p>
                    <p className="text-sm text-slate-700">
                      Claimed cash: {formatGHS(amount)}
                      {typeof claim?.provisional_token === "string"
                        ? ` · Token ${claim.provisional_token}`
                        : ""}
                    </p>
                  </div>
                  {isOpen ? (
                    <button
                      type="button"
                      onClick={() => {
                        if (isExpanded) {
                          setExpandedId(null);
                          resetResolutionForm();
                          return;
                        }
                        openResolve(conflict);
                      }}
                      className="rounded-md border border-[#0f2744] px-3 py-1.5 text-sm font-medium text-[#0f2744] hover:bg-slate-50"
                    >
                      {isExpanded ? "Close" : "Resolve"}
                    </button>
                  ) : null}
                </div>

                <div className="mt-4 overflow-x-auto">
                  <table className="min-w-full divide-y divide-slate-200 text-sm">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold text-slate-700">
                          Product
                        </th>
                        <th className="px-3 py-2 text-right font-semibold text-slate-700">
                          Claimed
                        </th>
                        <th className="px-3 py-2 text-right font-semibold text-slate-700">
                          Stock at conflict
                        </th>
                        <th className="px-3 py-2 text-right font-semibold text-slate-700">
                          Shortfall
                        </th>
                        <th className="px-3 py-2 text-right font-semibold text-slate-700">
                          Unit price
                        </th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200">
                      {claimLines.map((line) => {
                        const stock = stockRows.find(
                          (row) => row.product_id === line.product_id,
                        );
                        return (
                          <tr key={line.product_id}>
                            <td className="px-3 py-2 text-slate-900">
                              {line.product_code
                                ? `${line.product_code} — `
                                : ""}
                              {line.product_name ?? line.product_id}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {line.quantity}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {stock?.stock_qty ?? "—"}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums text-red-700">
                              {stock?.shortfall ?? "—"}
                            </td>
                            <td className="px-3 py-2 text-right tabular-nums">
                              {formatGHS(line.unit_price)}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {isOpen && isExpanded ? (
                  <div className="mt-4 space-y-4 rounded-md border border-amber-200 bg-amber-50/60 p-4">
                    <p className="text-sm font-medium text-amber-950">
                      Choose one resolution (no default):
                    </p>
                    <div className="flex flex-wrap gap-2">
                      {(
                        [
                          {
                            key: "A" as const,
                            label: "A — Confirm available qty",
                          },
                          {
                            key: "B" as const,
                            label: "B — Write off shortfall",
                          },
                          {
                            key: "C" as const,
                            label: "C — Reclass cash only",
                          },
                        ] as const
                      ).map((option) => (
                        <button
                          key={option.key}
                          type="button"
                          onClick={() => setSelectedAction(option.key)}
                          className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                            selectedAction === option.key
                              ? "bg-[#0f2744] text-white"
                              : "border border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
                          }`}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>

                    {selectedAction === "A" ? (
                      <div className="space-y-3">
                        <p className="text-sm text-slate-700">
                          Confirmed quantities default to min(claimed, stock at
                          conflict). Adjust per line, then handle any cash
                          remainder.
                        </p>
                        {claimLines.map((line) => {
                          const stock = stockRows.find(
                            (row) => row.product_id === line.product_id,
                          );
                          return (
                            <div
                              key={line.product_id}
                              className="flex flex-wrap items-center gap-3"
                            >
                              <label className="min-w-[12rem] flex-1 text-sm text-slate-800">
                                {line.product_name ?? line.product_id}
                                <span className="ml-1 text-xs text-slate-500">
                                  (max claimed {line.quantity}
                                  {stock
                                    ? `, stock ${stock.stock_qty}`
                                    : ""}
                                  )
                                </span>
                              </label>
                              <input
                                type="number"
                                min={0}
                                step="0.0001"
                                value={
                                  confirmedQtyByProduct[line.product_id] ?? ""
                                }
                                onChange={(event) =>
                                  setConfirmedQtyByProduct((current) => ({
                                    ...current,
                                    [line.product_id]: event.target.value,
                                  }))
                                }
                                className={`${inputClassName} max-w-[140px]`}
                              />
                            </div>
                          );
                        })}
                        <div>
                          <label className="mb-1 block text-sm font-medium text-slate-700">
                            Cash difference action (required when remainder &gt;
                            0)
                          </label>
                          <select
                            value={cashDifferenceAction}
                            onChange={(event) =>
                              setCashDifferenceAction(
                                event.target.value as CashDiffAction,
                              )
                            }
                            className={inputClassName}
                          >
                            <option value="">Select action…</option>
                            {CASH_ACTIONS.map((action) => (
                              <option key={action.value} value={action.value}>
                                {action.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="mb-1 block text-sm font-medium text-slate-700">
                            Cash difference note
                          </label>
                          <textarea
                            rows={2}
                            value={cashDifferenceNote}
                            onChange={(event) =>
                              setCashDifferenceNote(event.target.value)
                            }
                            className={inputClassName}
                            placeholder="Required when remainder cash &gt; 0"
                          />
                        </div>
                      </div>
                    ) : null}

                    {selectedAction === "B" ? (
                      <div>
                        <label className="mb-1 block text-sm font-medium text-slate-700">
                          Write-off reason
                        </label>
                        <textarea
                          rows={3}
                          required
                          value={writeOffReason}
                          onChange={(event) =>
                            setWriteOffReason(event.target.value)
                          }
                          className={inputClassName}
                          placeholder="Required — explains stock write-off boost"
                        />
                      </div>
                    ) : null}

                    {selectedAction === "C" ? (
                      <div className="space-y-3">
                        <div>
                          <label className="mb-1 block text-sm font-medium text-slate-700">
                            Reclass action
                          </label>
                          <select
                            value={reclassAction}
                            onChange={(event) =>
                              setReclassAction(
                                event.target.value as CashDiffAction,
                              )
                            }
                            className={inputClassName}
                          >
                            <option value="">Select action…</option>
                            {CASH_ACTIONS.map((action) => (
                              <option key={action.value} value={action.value}>
                                {action.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div>
                          <label className="mb-1 block text-sm font-medium text-slate-700">
                            Reason
                          </label>
                          <textarea
                            rows={3}
                            value={reclassReason}
                            onChange={(event) =>
                              setReclassReason(event.target.value)
                            }
                            className={inputClassName}
                            placeholder="Required"
                          />
                        </div>
                      </div>
                    ) : null}

                    {selectedAction ? (
                      <button
                        type="button"
                        disabled={submitting}
                        onClick={() => void submitResolution(conflict)}
                        className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        {submitting
                          ? "Resolving…"
                          : `Submit resolution ${selectedAction}`}
                      </button>
                    ) : null}
                  </div>
                ) : null}

                {!isOpen && conflict.resolution ? (
                  <p className="mt-3 text-xs text-slate-500">
                    Resolved{" "}
                    {conflict.resolved_at
                      ? new Date(conflict.resolved_at).toLocaleString()
                      : ""}
                    {typeof conflict.resolution.action === "string"
                      ? ` · action ${conflict.resolution.action}`
                      : ""}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
