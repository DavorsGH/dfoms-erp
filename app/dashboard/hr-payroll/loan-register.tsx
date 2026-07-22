"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import RegisterRowActions, {
  confirmDeleteEntry,
  getStripedRowClassName,
  toDateInputValue,
} from "../finance/register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import { getEmployeeDisplayName, type HrEmployee } from "./employee-utils";
import type { LoanRegisterEntry } from "./loan-register-utils";
import {
  calculateLoanOutstanding,
  formatDate,
  formatGHS,
  getLoanStatus,
  inputClassName,
} from "./hr-register-utils";
import { allocateLoanId } from "./hr-ids-api";

type LoanRegisterProps = {
  initialEntries: LoanRegisterEntry[];
  initialEmployees: HrEmployee[];
  fetchError: string | null;
};

const emptyForm = {
  employee_id: "",
  loan_amount: "",
  date_issued: "",
  repayment_period_months: "",
  monthly_deduction: "",
  total_repaid_to_date: "",
};

function LoanStatusBadge({ outstandingBalance }: { outstandingBalance: number }) {
  const status = getLoanStatus(outstandingBalance);
  const isFullyRepaid = status === "Fully Repaid";

  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
        isFullyRepaid
          ? "bg-emerald-100 text-emerald-800"
          : "bg-blue-100 text-blue-800"
      }`}
    >
      {status}
    </span>
  );
}

export default function LoanRegister({
  initialEntries,
  initialEmployees,
  fetchError,
}: LoanRegisterProps) {
  const supabase = createClient();
  const [entries, setEntries] = useState(initialEntries);
  const [employees] = useState(initialEmployees);
  const [showForm, setShowForm] = useState(false);
  const [editingLoanId, setEditingLoanId] = useState<string | null>(null);
  const [deletingLoanId, setDeletingLoanId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(fetchError);

  const previewOutstanding = calculateLoanOutstanding(
    Number(form.loan_amount) || 0,
    Number(form.total_repaid_to_date) || 0,
  );

  useEffect(() => {
    setEntries(initialEntries);
  }, [initialEntries]);

  async function refreshEntries() {
    const { data, error: refreshError } = await supabase
      .from("loan_register")
      .select("*")
      .order("date_issued", { ascending: false });

    if (refreshError) {
      setError(refreshError.message);
      return;
    }

    setEntries((data as LoanRegisterEntry[] | null) ?? []);
    setError(null);
  }

  function openAddForm() {
    setEditingLoanId(null);
    setForm(emptyForm);
    setShowForm(true);
  }

  function closeForm() {
    setEditingLoanId(null);
    setForm(emptyForm);
    setShowForm(false);
  }

  function openEditForm(entry: LoanRegisterEntry) {
    setEditingLoanId(entry.loan_id);
    setForm({
      employee_id: entry.employee_id,
      loan_amount: String(entry.loan_amount),
      date_issued: toDateInputValue(entry.date_issued),
      repayment_period_months: String(entry.repayment_period_months),
      monthly_deduction: String(entry.monthly_deduction),
      total_repaid_to_date:
        entry.total_repaid_to_date === null
          ? ""
          : String(entry.total_repaid_to_date),
    });
    setShowForm(true);
  }

  function updateField(field: keyof typeof emptyForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleDelete(loanId: string) {
    if (!confirmDeleteEntry()) {
      return;
    }

    setDeletingLoanId(loanId);
    setError(null);

    const { error: deleteError } = await supabase
      .from("loan_register")
      .delete()
      .eq("loan_id", loanId);

    if (deleteError) {
      setError(deleteError.message);
      setDeletingLoanId(null);
      return;
    }

    if (editingLoanId === loanId) {
      closeForm();
    }

    await refreshEntries();
    setDeletingLoanId(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const loanAmount = Number(form.loan_amount) || 0;
    const totalRepaid = Number(form.total_repaid_to_date) || 0;
    const outstandingBalance = calculateLoanOutstanding(loanAmount, totalRepaid);

    const payload = {
      employee_id: form.employee_id,
      loan_amount: loanAmount,
      date_issued: form.date_issued,
      repayment_period_months: Number(form.repayment_period_months) || 0,
      monthly_deduction: Number(form.monthly_deduction) || 0,
      total_repaid_to_date: totalRepaid,
      outstanding_balance: outstandingBalance,
    };

    if (editingLoanId) {
      const { error: saveError } = await supabase
        .from("loan_register")
        .update(payload)
        .eq("loan_id", editingLoanId);

      if (saveError) {
        setError(saveError.message);
        setLoading(false);
        return;
      }
    } else {
      const allocated = await allocateLoanId(supabase);
      if (allocated.error || !allocated.loanId) {
        setError(allocated.error ?? "Unable to allocate loan ID.");
        setLoading(false);
        return;
      }

      const { error: saveError } = await supabase
        .from("loan_register")
        .insert({ loan_id: allocated.loanId, ...payload });

      if (saveError) {
        setError(saveError.message);
        setLoading(false);
        return;
      }
    }

    closeForm();
    await refreshEntries();
    setLoading(false);
  }

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">
          Track staff loans, repayments, and outstanding balances.
        </p>
        <button
          type="button"
          onClick={() => (showForm ? closeForm() : openAddForm())}
          className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c]"
        >
          {showForm ? "Cancel" : "Add Entry"}
        </button>
      </div>

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {showForm && (
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-lg font-semibold text-[#0f2744]">
            {editingLoanId ? "Edit Loan Entry" : "New Loan Entry"}
          </h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Employee
                </label>
                <select
                  required
                  value={form.employee_id}
                  onChange={(e) => updateField("employee_id", e.target.value)}
                  className={inputClassName}
                >
                  <option value="">Select employee</option>
                  {employees.map((employee) => (
                    <option
                      key={employee.employee_id}
                      value={employee.employee_id}
                    >
                      {employee.full_name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Loan Amount
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={form.loan_amount}
                  onChange={(e) => updateField("loan_amount", e.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Date Issued
                </label>
                <input
                  type="date"
                  required
                  value={form.date_issued}
                  onChange={(e) => updateField("date_issued", e.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Repayment Period (Months)
                </label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  required
                  value={form.repayment_period_months}
                  onChange={(e) =>
                    updateField("repayment_period_months", e.target.value)
                  }
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Monthly Deduction
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={form.monthly_deduction}
                  onChange={(e) =>
                    updateField("monthly_deduction", e.target.value)
                  }
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Total Repaid to Date
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.total_repaid_to_date}
                  onChange={(e) =>
                    updateField("total_repaid_to_date", e.target.value)
                  }
                  className={inputClassName}
                />
              </div>
            </div>
            <p className="text-sm text-slate-600">
              Outstanding Balance:{" "}
              <span className="font-medium text-[#0f2744]">
                {formatGHS(previewOutstanding)}
              </span>
            </p>
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={loading}
                className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading
                  ? "Saving…"
                  : editingLoanId
                    ? "Save Changes"
                    : "Add Entry"}
              </button>
              <button
                type="button"
                onClick={closeForm}
                disabled={loading}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      )}

      <ScrollableTable>
        <table className={scrollableTableClassName}>
          <thead className={scrollableTableHeadClassName}>
            <tr>
              <th className={scrollableTableThClassName}>Loan ID</th>
              <th className={scrollableTableThClassName}>Employee</th>
              <th className={scrollableTableThClassName}>Loan Amount</th>
              <th className={scrollableTableThClassName}>Date Issued</th>
              <th className={scrollableTableThClassName}>Repayment Period</th>
              <th className={scrollableTableThClassName}>Monthly Deduction</th>
              <th className={scrollableTableThClassName}>Total Repaid</th>
              <th className={scrollableTableThClassName}>Outstanding</th>
              <th className={scrollableTableThClassName}>Status</th>
              <th className={scrollableTableThClassName}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {entries.length === 0 ? (
              <tr>
                <td
                  colSpan={10}
                  className="px-4 py-8 text-center text-slate-500"
                >
                  No loan entries yet.
                </td>
              </tr>
            ) : (
              entries.map((entry, index) => {
                const outstanding =
                  entry.outstanding_balance ??
                  calculateLoanOutstanding(
                    entry.loan_amount,
                    entry.total_repaid_to_date ?? 0,
                  );

                return (
                  <tr key={entry.loan_id} className={getStripedRowClassName(index)}>
                    <td className="px-4 py-3">{entry.loan_id}</td>
                    <td className="px-4 py-3">
                      {getEmployeeDisplayName(employees, entry.employee_id)}
                    </td>
                    <td className="px-4 py-3">{formatGHS(entry.loan_amount)}</td>
                    <td className="px-4 py-3">{formatDate(entry.date_issued)}</td>
                    <td className="px-4 py-3">
                      {entry.repayment_period_months} months
                    </td>
                    <td className="px-4 py-3">
                      {formatGHS(entry.monthly_deduction)}
                    </td>
                    <td className="px-4 py-3">
                      {formatGHS(entry.total_repaid_to_date ?? 0)}
                    </td>
                    <td className="px-4 py-3">{formatGHS(outstanding)}</td>
                    <td className="px-4 py-3">
                      <LoanStatusBadge outstandingBalance={outstanding} />
                    </td>
                    <RegisterRowActions
                      onEdit={() => openEditForm(entry)}
                      onDelete={() => handleDelete(entry.loan_id)}
                      deleting={deletingLoanId === entry.loan_id}
                    />
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
