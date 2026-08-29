"use client";

import { useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { resolveSessionTenantId } from "@/utils/session-tenant-client";
import { getCurrentFinancialYear } from "./finance-year-utils";
import { formatGHS } from "./manual-financial-entries-utils";
import {
  allocateDirectorsLoanRepayment,
  calculateDirectorsLoanOutstandingAsAt,
  sumPriorRepaymentAllocations,
  type AccountsPayablePaymentRow,
  type DirectorsLoanRepaymentRow,
} from "./directors-loan-utils";
import { calculateManualLiabilityStockByMonth } from "./balance-sheet-utils";
import type { CashMovementManualEntry } from "./cash-movement-utils";
import RegisterRowActions, {
  confirmDeleteEntry,
  getStripedRowClassName,
  toDateInputValue,
} from "./register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
  scrollableTableWrapTdClassName,
  scrollableTableWrapThClassName,
} from "../scrollable-table";

export type DirectorsLoanRepaymentRecord = DirectorsLoanRepaymentRow & {
  id: string;
  notes?: string | null;
};

type DirectorsLoanRepaymentsPanelProps = {
  tenantId: string;
  manualEntries: CashMovementManualEntry[];
  apPayments: AccountsPayablePaymentRow[];
  initialRepayments: DirectorsLoanRepaymentRecord[];
  fetchError?: string | null;
  /** Create-only stamp; null = All Businesses. */
  activeBusinessUnitId?: string | null;
};

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

export default function DirectorsLoanRepaymentsPanel({
  tenantId,
  manualEntries,
  apPayments,
  initialRepayments,
  fetchError = null,
  activeBusinessUnitId = null,
}: DirectorsLoanRepaymentsPanelProps) {
  const supabase = createClient();
  const financialYear = getCurrentFinancialYear();
  const [repayments, setRepayments] = useState(initialRepayments);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(fetchError);
  const [form, setForm] = useState({
    repayment_date: new Date().toISOString().slice(0, 10),
    amount: "",
    notes: "",
  });

  const manualStock = useMemo(
    () =>
      calculateManualLiabilityStockByMonth(
        manualEntries,
        "directors_loan",
        financialYear,
      ),
    [manualEntries, financialYear],
  );

  const outstandingPreview = useMemo(() => {
    const asAt = form.repayment_date || new Date().toISOString().slice(0, 10);
    return calculateDirectorsLoanOutstandingAsAt(
      manualStock,
      apPayments,
      repayments.filter((row) => row.id !== editingId),
      tenantId,
      asAt,
      financialYear,
    );
  }, [
    apPayments,
    editingId,
    form.repayment_date,
    manualStock,
    repayments,
    tenantId,
    financialYear,
  ]);

  async function refreshRepayments() {
    const { data, error: refreshError } = await supabase
      .from("directors_loan_repayments")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("repayment_date", { ascending: false });

    if (refreshError) {
      setError(refreshError.message);
      return;
    }

    setRepayments((data as DirectorsLoanRepaymentRecord[] | null) ?? []);
    setError(null);
  }

  function openAddForm() {
    setEditingId(null);
    setForm({
      repayment_date: new Date().toISOString().slice(0, 10),
      amount: "",
      notes: "",
    });
    setShowForm(true);
  }

  function openEditForm(row: DirectorsLoanRepaymentRecord) {
    setEditingId(row.id);
    setForm({
      repayment_date: toDateInputValue(row.repayment_date),
      amount: String(row.amount),
      notes: row.notes ?? "",
    });
    setShowForm(true);
  }

  function closeForm() {
    setEditingId(null);
    setShowForm(false);
  }

  async function handleDelete(id: string) {
    if (!confirmDeleteEntry()) {
      return;
    }

    setDeletingId(id);
    setError(null);

    const { error: deleteError } = await supabase
      .from("directors_loan_repayments")
      .delete()
      .eq("id", id)
      .eq("tenant_id", tenantId);

    if (deleteError) {
      setError(deleteError.message);
      setDeletingId(null);
      return;
    }

    await refreshRepayments();
    setDeletingId(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const amount = Number(form.amount) || 0;
    if (amount <= 0) {
      setError("Repayment amount must be greater than zero.");
      setLoading(false);
      return;
    }

    if (amount > outstandingPreview.netOutstanding + 0.005) {
      setError(
        `Repayment exceeds net outstanding (${formatGHS(outstandingPreview.netOutstanding)}).`,
      );
      setLoading(false);
      return;
    }

    const prior = sumPriorRepaymentAllocations(
      repayments.filter((row) => row.id !== editingId),
      tenantId,
      form.repayment_date,
    );
    const allocation = allocateDirectorsLoanRepayment(
      amount,
      outstandingPreview.manualComponent,
      outstandingPreview.apComponent,
      prior.ap,
      prior.manual,
    );

    const payload = {
      tenant_id: tenantId,
      repayment_date: form.repayment_date,
      amount,
      applied_to_ap_component: allocation.appliedToAp,
      applied_to_manual_component: allocation.appliedToManual,
      notes:
        form.notes.trim() ||
        `Director's Loan repayment (AP: GHS ${allocation.appliedToAp.toFixed(2)}, Manual: GHS ${allocation.appliedToManual.toFixed(2)})`,
    };

    const resolvedTenant = await resolveSessionTenantId(supabase);
    if (resolvedTenant.error || resolvedTenant.tenantId !== tenantId) {
      setError(resolvedTenant.error ?? "Tenant mismatch.");
      setLoading(false);
      return;
    }

    if (editingId) {
      const { error: updateError } = await supabase
        .from("directors_loan_repayments")
        .update(payload)
        .eq("id", editingId)
        .eq("tenant_id", tenantId);

      if (updateError) {
        setError(updateError.message);
        setLoading(false);
        return;
      }
    } else {
      const { error: insertError } = await supabase
        .from("directors_loan_repayments")
        .insert({
          ...payload,
          business_unit_id: activeBusinessUnitId,
        });

      if (insertError) {
        setError(insertError.message);
        setLoading(false);
        return;
      }
    }

    closeForm();
    await refreshRepayments();
    setLoading(false);
  }

  return (
    <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h3 className="text-lg font-semibold text-[#0f2744]">
            Director&apos;s Loan — Repayments
          </h3>
          <p className="mt-1 text-sm text-slate-600">
            Record company cash repayments to the director. These reduce net
            Director&apos;s Loan and create a dedicated cash outflow (separate
            from bank loan repayments).
          </p>
        </div>
        <button
          type="button"
          onClick={() => (showForm ? closeForm() : openAddForm())}
          className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c]"
        >
          {showForm ? "Cancel" : "Record Repayment"}
        </button>
      </div>

      <div className="grid gap-3 text-sm text-slate-700 md:grid-cols-4">
        <p>
          Manual component:{" "}
          <span className="font-medium text-[#0f2744]">
            {formatGHS(outstandingPreview.manualComponent)}
          </span>
        </p>
        <p>
          AP-system component:{" "}
          <span className="font-medium text-[#0f2744]">
            {formatGHS(outstandingPreview.apComponent)}
          </span>
        </p>
        <p>
          Net outstanding:{" "}
          <span className="font-medium text-[#0f2744]">
            {formatGHS(outstandingPreview.netOutstanding)}
          </span>
        </p>
        <p className="text-slate-500">FY {financialYear} · as at payment date</p>
      </div>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {showForm ? (
        <form onSubmit={handleSubmit} className="space-y-4 border-t border-slate-100 pt-4">
          <div className="grid gap-4 md:grid-cols-3">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Repayment Date
              </label>
              <input
                type="date"
                required
                value={form.repayment_date}
                onChange={(e) =>
                  setForm((current) => ({
                    ...current,
                    repayment_date: e.target.value,
                  }))
                }
                className={inputClassName}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Amount
              </label>
              <input
                type="number"
                min="0.01"
                step="0.01"
                required
                value={form.amount}
                onChange={(e) =>
                  setForm((current) => ({ ...current, amount: e.target.value }))
                }
                className={inputClassName}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Notes
              </label>
              <input
                type="text"
                value={form.notes}
                onChange={(e) =>
                  setForm((current) => ({ ...current, notes: e.target.value }))
                }
                className={inputClassName}
              />
            </div>
          </div>
          {Number(form.amount) > 0 ? (
            <p className="text-sm text-slate-600">
              Allocation preview: AP-system{" "}
              {formatGHS(
                allocateDirectorsLoanRepayment(
                  Number(form.amount) || 0,
                  outstandingPreview.manualComponent,
                  outstandingPreview.apComponent,
                  sumPriorRepaymentAllocations(
                    repayments.filter((row) => row.id !== editingId),
                    tenantId,
                    form.repayment_date,
                  ).ap,
                  sumPriorRepaymentAllocations(
                    repayments.filter((row) => row.id !== editingId),
                    tenantId,
                    form.repayment_date,
                  ).manual,
                ).appliedToAp,
              )}
              , manual{" "}
              {formatGHS(
                allocateDirectorsLoanRepayment(
                  Number(form.amount) || 0,
                  outstandingPreview.manualComponent,
                  outstandingPreview.apComponent,
                  sumPriorRepaymentAllocations(
                    repayments.filter((row) => row.id !== editingId),
                    tenantId,
                    form.repayment_date,
                  ).ap,
                  sumPriorRepaymentAllocations(
                    repayments.filter((row) => row.id !== editingId),
                    tenantId,
                    form.repayment_date,
                  ).manual,
                ).appliedToManual,
              )}
            </p>
          ) : null}
          <div className="flex gap-3">
            <button
              type="submit"
              disabled={loading}
              className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
            >
              {loading ? "Saving…" : editingId ? "Save Changes" : "Save Repayment"}
            </button>
            <button
              type="button"
              onClick={closeForm}
              disabled={loading}
              className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50"
            >
              Cancel
            </button>
          </div>
        </form>
      ) : null}

      <ScrollableTable>
        <table className={scrollableTableClassName}>
          <thead className={scrollableTableHeadClassName}>
            <tr>
              <th className={scrollableTableThClassName}>Date</th>
              <th className={scrollableTableThClassName}>Amount</th>
              <th className={scrollableTableThClassName}>AP Component</th>
              <th className={scrollableTableThClassName}>Manual Component</th>
              <th className={scrollableTableWrapThClassName}>Notes</th>
              <th className={scrollableTableThClassName}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {repayments.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-slate-500">
                  No director&apos;s loan repayments recorded yet.
                </td>
              </tr>
            ) : (
              repayments.map((row, index) => (
                <tr key={row.id} className={getStripedRowClassName(index)}>
                  <td className="px-4 py-3">{toDateInputValue(row.repayment_date)}</td>
                  <td className="px-4 py-3">{formatGHS(row.amount)}</td>
                  <td className="px-4 py-3">
                    {formatGHS(Number(row.applied_to_ap_component) || 0)}
                  </td>
                  <td className="px-4 py-3">
                    {formatGHS(Number(row.applied_to_manual_component) || 0)}
                  </td>
                  <td className={scrollableTableWrapTdClassName}>{row.notes ?? "—"}</td>
                  <RegisterRowActions
                    onEdit={() => openEditForm(row)}
                    onDelete={() => handleDelete(row.id)}
                    deleting={deletingId === row.id}
                  />
                </tr>
              ))
            )}
          </tbody>
        </table>
      </ScrollableTable>
    </section>
  );
}
