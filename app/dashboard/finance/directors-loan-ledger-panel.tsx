"use client";

import { promptDialog } from "@/components/feedback/app-dialogs";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { applyBusinessUnitScope } from "@/utils/business-unit-view";
import { useBusinessUnitReadScope } from "@/app/dashboard/business-unit-view-context";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import { formatGHS } from "./manual-financial-entries-utils";
import {
  DIRECTORS_LOAN_ENTRY_TYPE_LABELS,
  DIRECTORS_LOAN_LEDGER_SELECT,
  calculateDirectorsLoanPositionAsAt,
  formatDirectorsLoanPositionLabel,
  normalizeDirectorsLoanPositionDisplay,
  DIRECTORS_LOAN_ENTRY_TYPE_EFFECT_HINTS,
  type DirectorsLoanLedgerEntry,
  type DirectorsLoanLedgerEntryType,
} from "./directors-loan-ledger-utils";
import type { AccountsPayablePaymentRow } from "./directors-loan-utils";

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButtonClassName =
  "rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

type ExpenseOption = {
  id: string;
  date: string;
  amount: number;
  description: string | null;
  expense_category: string | null;
};

type DirectorsLoanLedgerPanelProps = {
  tenantId: string;
  financialYear: number;
  asAtDate: string;
  initialEntries: DirectorsLoanLedgerEntry[];
  apPayments: AccountsPayablePaymentRow[];
  expenseOptions: ExpenseOption[];
};

export default function DirectorsLoanLedgerPanel({
  tenantId,
  financialYear,
  asAtDate,
  initialEntries,
  apPayments,
  expenseOptions,
}: DirectorsLoanLedgerPanelProps) {
  const router = useRouter();
  const supabase = createClient();
  const buReadScope = useBusinessUnitReadScope();
  const [entries, setEntries] = useState(initialEntries);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [entryDate, setEntryDate] = useState(asAtDate.slice(0, 10));
  const [entryType, setEntryType] =
    useState<DirectorsLoanLedgerEntryType>("director_lent_company");
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [notes, setNotes] = useState("");
  const [linkedExpenseId, setLinkedExpenseId] = useState("");
  const [removeLinkedExpense, setRemoveLinkedExpense] = useState(false);

  const position = useMemo(
    () =>
      calculateDirectorsLoanPositionAsAt(
        entries,
        apPayments,
        tenantId,
        asAtDate,
        financialYear,
      ),
    [entries, apPayments, tenantId, asAtDate, financialYear],
  );
  const positionDisplay = useMemo(
    () => normalizeDirectorsLoanPositionDisplay(position),
    [position],
  );

  async function refreshEntries() {
    const { data, error: refreshError } = await applyBusinessUnitScope(
      supabase.from("directors_loan_entries").select(DIRECTORS_LOAN_LEDGER_SELECT),
      buReadScope,
    )
      .eq("tenant_id", tenantId)
      .order("entry_date", { ascending: false });

    if (refreshError) {
      setError(refreshError.message);
      return;
    }
    setEntries((data as DirectorsLoanLedgerEntry[] | null) ?? []);
  }

  function resetForm() {
    setShowForm(false);
    setEditingId(null);
    setAmount("");
    setDescription("");
    setNotes("");
    setLinkedExpenseId("");
    setRemoveLinkedExpense(false);
    setEntryType("director_lent_company");
    setEntryDate(asAtDate.slice(0, 10));
  }

  function openEdit(entry: DirectorsLoanLedgerEntry) {
    setEditingId(entry.id);
    setShowForm(true);
    setEntryDate(entry.entry_date.slice(0, 10));
    setEntryType(entry.entry_type);
    setAmount(String(entry.amount));
    setDescription(entry.description);
    setNotes(entry.notes ?? "");
    setLinkedExpenseId(entry.linked_expense_id ?? "");
    setRemoveLinkedExpense(false);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
      setError("Enter an amount greater than zero.");
      setLoading(false);
      return;
    }
    if (!description.trim()) {
      setError("Description is required.");
      setLoading(false);
      return;
    }

    try {
      if (editingId) {
        const response = await fetch(
          `/api/finance/directors-loan-entries/${editingId}`,
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              entry_date: entryDate,
              entry_type: entryType,
              amount: parsedAmount,
              description: description.trim(),
              notes: notes.trim() || null,
              linked_expense_id: linkedExpenseId.trim() || null,
            }),
          },
        );
        const payload = (await response.json()) as { error?: string };
        if (!response.ok) {
          throw new Error(payload.error ?? "Update failed.");
        }
      } else {
        const response = await fetch("/api/finance/directors-loan-entries", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            entry_date: entryDate,
            entry_type: entryType,
            amount: parsedAmount,
            description: description.trim(),
            notes: notes.trim() || null,
            linked_expense_id: linkedExpenseId.trim() || null,
            remove_linked_expense:
              entryType === "company_paid_for_director" && removeLinkedExpense,
          }),
        });
        const payload = (await response.json()) as { error?: string };
        if (!response.ok) {
          throw new Error(payload.error ?? "Create failed.");
        }
      }
      resetForm();
      await refreshEntries();
      router.refresh();
    } catch (submitError) {
      setError(
        submitError instanceof Error ? submitError.message : "Save failed.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleReverse(entry: DirectorsLoanLedgerEntry) {
    const reason = await promptDialog({
      message: "Reason for reversing this entry (required, min 5 characters):",
      required: true,
    });
    if (!reason || reason.trim().length < 5) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/finance/directors-loan-entries/${entry.id}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "reverse",
            reversal_reason: reason.trim(),
          }),
        },
      );
      const payload = (await response.json()) as { error?: string };
      if (!response.ok) {
        throw new Error(payload.error ?? "Reverse failed.");
      }
      await refreshEntries();
      router.refresh();
    } catch (reverseError) {
      setError(
        reverseError instanceof Error ? reverseError.message : "Reverse failed.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="space-y-4 rounded-lg border border-violet-200 bg-violet-50/40 p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-[#0f2744]">
            Director&apos;s Loan ledger
          </h3>
          <p className="mt-1 text-sm font-medium text-[#0f2744]">
            {formatDirectorsLoanPositionLabel(position)}
          </p>
          <p className="mt-1 text-xs text-slate-600">
            Owed to director: {formatGHS(positionDisplay.owedToDirector)} · Owed by
            director: {formatGHS(positionDisplay.owedByDirector)} (includes AP paid
            from director personal funds)
          </p>
        </div>
        <button
          type="button"
          className={primaryButtonClassName}
          onClick={() => {
            resetForm();
            setShowForm(true);
          }}
        >
          Add entry
        </button>
      </div>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {showForm ? (
        <form
          onSubmit={handleSubmit}
          className="space-y-3 rounded-md border border-violet-200 bg-white p-4"
        >
          <div className="grid gap-3 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Date
              </label>
              <input
                type="date"
                required
                value={entryDate}
                onChange={(event) => setEntryDate(event.target.value)}
                className={inputClassName}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Type
              </label>
              <select
                value={entryType}
                onChange={(event) =>
                  setEntryType(event.target.value as DirectorsLoanLedgerEntryType)
                }
                className={inputClassName}
              >
                {(
                  Object.entries(DIRECTORS_LOAN_ENTRY_TYPE_LABELS) as Array<
                    [DirectorsLoanLedgerEntryType, string]
                  >
                ).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-xs text-slate-600">
                {DIRECTORS_LOAN_ENTRY_TYPE_EFFECT_HINTS[entryType]}
              </p>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Amount (GHS)
            </label>
            <input
              type="number"
              step="0.01"
              min="0.01"
              required
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className={inputClassName}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Description
            </label>
            <input
              type="text"
              required
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              className={inputClassName}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Notes (optional)
            </label>
            <input
              type="text"
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className={inputClassName}
            />
          </div>
          {entryType === "company_paid_for_director" ? (
            <div className="space-y-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Link expense (optional)
                </label>
                <select
                  value={linkedExpenseId}
                  onChange={(event) => setLinkedExpenseId(event.target.value)}
                  className={inputClassName}
                >
                  <option value="">— None —</option>
                  {expenseOptions.map((expense) => (
                    <option key={expense.id} value={expense.id}>
                      {expense.date.slice(0, 10)} · {formatGHS(expense.amount)} ·{" "}
                      {expense.description ?? expense.expense_category ?? "Expense"}
                    </option>
                  ))}
                </select>
              </div>
              {!editingId && linkedExpenseId ? (
                <label className="flex items-center gap-2 text-sm text-slate-700">
                  <input
                    type="checkbox"
                    checked={removeLinkedExpense}
                    onChange={(event) => setRemoveLinkedExpense(event.target.checked)}
                  />
                  Remove linked expense row (avoid double-counting as business
                  expense)
                </label>
              ) : null}
            </div>
          ) : null}
          <div className="flex gap-2">
            <button
              type="submit"
              disabled={loading}
              className={primaryButtonClassName}
            >
              {loading ? "Saving…" : editingId ? "Save changes" : "Add entry"}
            </button>
            <button
              type="button"
              disabled={loading}
              onClick={resetForm}
              className={secondaryButtonClassName}
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
              <th className={scrollableTableThClassName}>Type</th>
              <th className={scrollableTableThClassName}>Description</th>
              <th className={scrollableTableThClassName}>Amount</th>
              <th className={scrollableTableThClassName}>Linked expense</th>
              <th className={scrollableTableThClassName}>Status</th>
              <th className={scrollableTableThClassName}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {entries.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-6 text-center text-slate-500">
                  No director&apos;s loan ledger entries yet.
                </td>
              </tr>
            ) : (
              entries.map((entry) => (
                <tr key={entry.id}>
                  <td className="px-4 py-3">{entry.entry_date.slice(0, 10)}</td>
                  <td className="px-4 py-3 text-sm">
                    {DIRECTORS_LOAN_ENTRY_TYPE_LABELS[entry.entry_type]}
                  </td>
                  <td className="px-4 py-3 text-sm">{entry.description}</td>
                  <td className="px-4 py-3">{formatGHS(entry.amount)}</td>
                  <td className="px-4 py-3 text-xs text-slate-600">
                    {entry.linked_expense_id ? entry.linked_expense_id.slice(0, 8) : "—"}
                  </td>
                  <td className="px-4 py-3 text-sm">
                    {entry.reversed_at ? "Reversed" : "Active"}
                  </td>
                  <td className="px-4 py-3">
                    {!entry.reversed_at ? (
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          className={secondaryButtonClassName}
                          onClick={() => openEdit(entry)}
                        >
                          Edit
                        </button>
                        <button
                          type="button"
                          className={secondaryButtonClassName}
                          onClick={() => handleReverse(entry)}
                        >
                          Reverse
                        </button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </ScrollableTable>
    </section>
  );
}
