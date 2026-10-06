"use client";

import Tooltip from "@/components/ui/tooltip";

import Link from "next/link";
import DashboardButton from "@/components/dashboard-button";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import {
  useBusinessUnitReadScope,
  useBusinessUnitView,
} from "@/app/dashboard/business-unit-view-context";
import { applyBusinessUnitScope } from "@/utils/business-unit-view";
import { formatDate, formatGHS } from "../income-register-utils";
import { evaluateReturnBusinessUnitGate } from "../../crm/product-return-utils";
import { SALES_REGISTER_VIEW_ONLY_TOOLTIP } from "../../crm/sales/sales-register-drawer-data";
import {
  creditNoteAvailableBalance,
  formatCreditNoteCustomerLabel,
  formatCreditNoteOutcome,
  CREDIT_NOTES_LIST_SELECT,
  type CreditNoteListRow,
} from "../credit-notes-utils";
import {
  CREDIT_NOTE_USAGE_FILTER_VALUES,
  formatCreditNoteUsageStatus,
} from "../credit-note-display-utils";
import { buildPosStoreCreditCheckoutUrl } from "../../pos/pos-store-credit-utils";

type CreditNotesProps = {
  initialRows: CreditNoteListRow[];
  paymentMethods: string[];
  fetchError: string | null;
  allowRecordRefund?: boolean;
};

function canShowPosStoreCreditActions(row: CreditNoteListRow): boolean {
  const available = creditNoteAvailableBalance(row);
  if (available <= 0) {
    return false;
  }
  const mode = String(row.return_mode ?? "").toLowerCase();
  return mode === "store_credit" || mode === "exchange_hold";
}

export default function CreditNotes({
  initialRows,
  paymentMethods,
  fetchError,
  allowRecordRefund = true,
}: CreditNotesProps) {
  const router = useRouter();
  const supabase = createClient();
  const { viewAllBusinessUnits, activeBusinessUnitId, units } =
    useBusinessUnitView();
  const buReadScope = useBusinessUnitReadScope();
  const [rows, setRows] = useState(initialRows);
  const [usageFilter, setUsageFilter] = useState<string>("all");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [availableOnly, setAvailableOnly] = useState(false);
  const [refundNoteId, setRefundNoteId] = useState<string | null>(null);
  const [refundAmount, setRefundAmount] = useState("");
  const [refundMethod, setRefundMethod] = useState(paymentMethods[0] ?? "Cash");
  const [refundNotes, setRefundNotes] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(fetchError);

  const visibleRows = useMemo(() => {
    return rows.filter((row) => {
      if (usageFilter !== "all") {
        if (formatCreditNoteUsageStatus(row) !== usageFilter) {
          return false;
        }
      }
      const date = row.credit_note_date?.slice(0, 10) ?? "";
      if (dateFrom && date < dateFrom) {
        return false;
      }
      if (dateTo && date > dateTo) {
        return false;
      }
      if (availableOnly && creditNoteAvailableBalance(row) <= 0) {
        return false;
      }
      return true;
    });
  }, [rows, usageFilter, dateFrom, dateTo, availableOnly]);

  const refundTarget = rows.find((row) => row.id === refundNoteId) ?? null;

  async function refreshRows() {
    const { data, error: loadError } = await applyBusinessUnitScope(
      supabase.from("credit_notes").select(CREDIT_NOTES_LIST_SELECT),
      buReadScope,
    ).order("credit_note_date", { ascending: false });
    if (loadError) {
      setError(loadError.message);
      return;
    }
    setRows((data as CreditNoteListRow[] | null) ?? []);
    router.refresh();
  }

  async function handleRecordRefund() {
    if (!refundTarget) {
      return;
    }
    const refundBuGate = evaluateReturnBusinessUnitGate({
      viewAllBusinessUnits,
      activeBusinessUnitId,
      saleBusinessUnitId: refundTarget.business_unit_id,
      units,
    });
    if (!refundBuGate.ok) {
      setError(refundBuGate.message);
      return;
    }
    setSubmitting(true);
    setError(null);
    const amount = Number(refundAmount);
    const { error: rpcError } = await supabase.rpc("record_refund", {
      p_credit_note_id: refundTarget.id,
      p_amount: amount,
      p_method: refundMethod,
      p_notes: refundNotes.trim() || null,
    });
    setSubmitting(false);
    if (rpcError) {
      setError(rpcError.message);
      return;
    }
    setRefundNoteId(null);
    setRefundAmount("");
    setRefundNotes("");
    await refreshRows();
  }

  return (
    <div className="space-y-6">
      <p className="text-sm text-slate-600">
        Product return credit notes, refunds, and store credit balances.
      </p>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">
            Usage
          </label>
          <select
            value={usageFilter}
            onChange={(e) => setUsageFilter(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="all">All</option>
            {CREDIT_NOTE_USAGE_FILTER_VALUES.map((value) => (
              <option key={value} value={value}>
                {value}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">
            From
          </label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">
            To
          </label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <label className="flex items-center gap-2 text-sm text-slate-700">
          <input
            type="checkbox"
            checked={availableOnly}
            onChange={(e) => setAvailableOnly(e.target.checked)}
          />
          Has available balance
        </label>
      </div>

      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full divide-y divide-slate-200 text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="px-4 py-3 text-left font-medium">Number</th>
              <th className="px-4 py-3 text-left font-medium">Date</th>
              <th className="px-4 py-3 text-left font-medium">Customer</th>
              <th className="px-4 py-3 text-left font-medium">Receipt</th>
              <th className="px-4 py-3 text-right font-medium">Total</th>
              <th className="px-4 py-3 text-right font-medium">Refunded</th>
              <th className="px-4 py-3 text-right font-medium">Applied</th>
              <th className="px-4 py-3 text-right font-medium">Available</th>
              <th className="px-4 py-3 text-left font-medium">Outcome</th>
              <th className="px-4 py-3 text-left font-medium">Usage</th>
              <th className="px-4 py-3 text-left font-medium">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200 bg-white">
            {visibleRows.length === 0 ? (
              <tr>
                <td colSpan={11} className="px-4 py-8 text-center text-slate-500">
                  No credit notes match the filters.
                </td>
              </tr>
            ) : (
              visibleRows.map((row) => {
                const available = creditNoteAvailableBalance(row);
                return (
                  <tr key={row.id}>
                    <td className="px-4 py-3 font-medium">{row.credit_note_number}</td>
                    <td className="px-4 py-3">{formatDate(row.credit_note_date)}</td>
                    <td className="px-4 py-3">{formatCreditNoteCustomerLabel(row)}</td>
                    <td className="px-4 py-3">
                      {row.pos_invoice_no ? (
                        <Link
                          href={`/dashboard/crm/sales?invoice=${encodeURIComponent(row.pos_invoice_no)}`}
                          className="text-[#0f2744] underline hover:no-underline"
                        >
                          {row.pos_invoice_no}
                        </Link>
                      ) : (
                        "—"
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">{formatGHS(row.total_amount)}</td>
                    <td className="px-4 py-3 text-right">{formatGHS(row.refunded_amount)}</td>
                    <td className="px-4 py-3 text-right">{formatGHS(row.applied_amount)}</td>
                    <td className="px-4 py-3 text-right">{formatGHS(available)}</td>
                    <td className="px-4 py-3">{formatCreditNoteOutcome(row)}</td>
                    <td className="px-4 py-3">
                      {formatCreditNoteUsageStatus(row)}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-2">
                        {canShowPosStoreCreditActions(row) ? (
                          viewAllBusinessUnits ? (
                            <>
                              <Tooltip
                                content={SALES_REGISTER_VIEW_ONLY_TOOLTIP}
                                variant="blocked"
                              >
                                <span className="cursor-not-allowed rounded border border-slate-200 px-2 py-1 text-xs font-medium text-slate-400">
                                  Apply at POS
                                </span>
                              </Tooltip>
                              <Tooltip
                                content={SALES_REGISTER_VIEW_ONLY_TOOLTIP}
                                variant="blocked"
                              >
                                <span className="cursor-not-allowed rounded border border-slate-200 px-2 py-1 text-xs font-medium text-slate-400">
                                  Load returned items
                                </span>
                              </Tooltip>
                            </>
                          ) : (
                            <>
                              <Link
                                href={buildPosStoreCreditCheckoutUrl({
                                  creditNoteId: row.id,
                                })}
                                className="rounded border border-[#0f2744] px-2 py-1 text-xs font-medium text-[#0f2744] hover:bg-slate-50"
                              >
                                Apply at POS
                              </Link>
                              <Link
                                href={buildPosStoreCreditCheckoutUrl({
                                  creditNoteId: row.id,
                                  loadLines: true,
                                })}
                                className="rounded border border-[#0f2744] px-2 py-1 text-xs font-medium text-[#0f2744] hover:bg-slate-50"
                              >
                                Load returned items
                              </Link>
                            </>
                          )
                        ) : null}
                        {allowRecordRefund ? (() => {
                          const refundDisabled =
                            viewAllBusinessUnits || available <= 0;
                          const refundTooltip = viewAllBusinessUnits
                            ? SALES_REGISTER_VIEW_ONLY_TOOLTIP
                            : available <= 0
                              ? "No balance available to refund"
                              : undefined;
                          const refundButton = (
                            <button
                              type="button"
                              disabled={refundDisabled}
                              onClick={() => {
                                const gate = evaluateReturnBusinessUnitGate({
                                  viewAllBusinessUnits,
                                  activeBusinessUnitId,
                                  saleBusinessUnitId: row.business_unit_id,
                                  units,
                                });
                                if (!gate.ok) {
                                  setError(gate.message);
                                  return;
                                }
                                setError(null);
                                setRefundNoteId(row.id);
                                setRefundAmount(String(available));
                              }}
                              className="rounded border border-emerald-200 px-2 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-50 disabled:opacity-50"
                            >
                              Record Refund
                            </button>
                          );
                          return refundDisabled && refundTooltip ? (
                            <Tooltip content={refundTooltip} variant="blocked">
                              {refundButton}
                            </Tooltip>
                          ) : (
                            refundButton
                          );
                        })() : null}
                      </div>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      {refundTarget ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl">
            <h2 className="text-lg font-semibold text-[#0f2744]">
              Record refund — {refundTarget.credit_note_number}
            </h2>
            <p className="mt-1 text-sm text-slate-600">
              Available {formatGHS(creditNoteAvailableBalance(refundTarget))}
            </p>
            <div className="mt-4 space-y-3">
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  Amount
                </label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  value={refundAmount}
                  onChange={(e) => setRefundAmount(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  Payment method
                </label>
                <select
                  value={refundMethod}
                  onChange={(e) => setRefundMethod(e.target.value)}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                >
                  {paymentMethods.map((method) => (
                    <option key={method} value={method}>
                      {method}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium text-slate-600">
                  Notes
                </label>
                <textarea
                  value={refundNotes}
                  onChange={(e) => setRefundNotes(e.target.value)}
                  rows={2}
                  className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
                />
              </div>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <DashboardButton
                type="button"
                variant="secondary"
                onClick={() => setRefundNoteId(null)}
              >
                Cancel
              </DashboardButton>
              <DashboardButton
                type="button"
                variant="primary"
                disabled={submitting}
                onClick={() => void handleRecordRefund()}
              >
                {submitting ? "Saving…" : "Record Refund"}
              </DashboardButton>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
