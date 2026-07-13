"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import type { Employee } from "../lookup-types";
import {
  calculateShareCapitalAsOf,
  formatContributionDate,
  formatGHS,
  getContributorName,
  type CapitalContributionEntry,
} from "./capital-contributions-utils";
import RegisterRowActions, {
  confirmDeleteEntry,
  getStripedRowClassName,
  toDateInputValue,
} from "./register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";

type CapitalContributionsProps = {
  initialEntries: CapitalContributionEntry[];
  initialEmployees: Employee[];
  fetchError: string | null;
};

const emptyForm = {
  date: "",
  contributed_by: "",
  amount: "",
  description: "",
  notes: "",
};

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

export default function CapitalContributions({
  initialEntries,
  initialEmployees,
  fetchError,
}: CapitalContributionsProps) {
  const supabase = createClient();
  const [entries, setEntries] = useState(initialEntries);
  const [employees, setEmployees] = useState(initialEmployees);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(fetchError);

  const totalShareCapital = useMemo(
    () => calculateShareCapitalAsOf(entries, "9999-12-31"),
    [entries],
  );

  useEffect(() => {
    setEntries(initialEntries);
  }, [initialEntries]);

  useEffect(() => {
    if (!showForm) {
      return;
    }

    const client = createClient();

    async function loadEmployees() {
      const { data, error: refreshError } = await client
        .from("employees")
        .select("employee_id, full_name")
        .order("full_name", { ascending: true });

      if (refreshError) {
        setError(refreshError.message);
        return;
      }

      setEmployees(data ?? []);
    }

    loadEmployees();
  }, [showForm]);

  async function refreshEntries() {
    const { data, error: refreshError } = await supabase
      .from("capital_contributions")
      .select("*, employees(full_name)")
      .order("date", { ascending: false });

    if (refreshError) {
      setError(refreshError.message);
      return;
    }

    setEntries((data as CapitalContributionEntry[] | null) ?? []);
    setError(null);
  }

  function openAddForm() {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(true);
  }

  function closeForm() {
    setEditingId(null);
    setForm(emptyForm);
    setShowForm(false);
  }

  function openEditForm(entry: CapitalContributionEntry) {
    setEditingId(entry.id);
    setForm({
      date: toDateInputValue(entry.date),
      contributed_by: entry.contributed_by,
      amount: String(entry.amount),
      description: entry.description ?? "",
      notes: entry.notes ?? "",
    });
    setShowForm(true);
  }

  async function handleDelete(id: string) {
    if (!confirmDeleteEntry()) {
      return;
    }

    setDeletingId(id);
    setError(null);

    const { error: deleteError } = await supabase
      .from("capital_contributions")
      .delete()
      .eq("id", id);

    if (deleteError) {
      setError(deleteError.message);
      setDeletingId(null);
      return;
    }

    if (editingId === id) {
      closeForm();
    }

    await refreshEntries();
    setDeletingId(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const payload = {
      date: form.date,
      contributed_by: form.contributed_by,
      amount: Number(form.amount),
      description: form.description || null,
      notes: form.notes || null,
    };

    const { error: saveError } = editingId
      ? await supabase
          .from("capital_contributions")
          .update(payload)
          .eq("id", editingId)
      : await supabase.from("capital_contributions").insert(payload);

    if (saveError) {
      setError(saveError.message);
      setLoading(false);
      return;
    }

    closeForm();
    await refreshEntries();
    setLoading(false);
  }

  function updateField(field: keyof typeof emptyForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div>
          <p className="text-sm text-slate-600">
            Record share capital contributions by date and contributor. Balance
            Sheet Share Capital is always calculated as the sum of these
            entries on or before each reporting period.
          </p>
          <p className="mt-2 text-sm font-medium text-[#0f2744]">
            Total Share Capital: {formatGHS(totalShareCapital)}
          </p>
        </div>
        <button
          type="button"
          onClick={() => (showForm ? closeForm() : openAddForm())}
          className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c]"
        >
          {showForm ? "Cancel" : "Add Contribution"}
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
            {editingId ? "Edit Capital Contribution" : "New Capital Contribution"}
          </h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Date
                </label>
                <input
                  type="date"
                  required
                  value={form.date}
                  onChange={(e) => updateField("date", e.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Contributed By
                </label>
                <select
                  required
                  value={form.contributed_by}
                  onChange={(e) =>
                    updateField("contributed_by", e.target.value)
                  }
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
                  Amount
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={form.amount}
                  onChange={(e) => updateField("amount", e.target.value)}
                  className={inputClassName}
                />
              </div>
              <div className="md:col-span-2">
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Description
                </label>
                <input
                  type="text"
                  value={form.description}
                  onChange={(e) => updateField("description", e.target.value)}
                  className={inputClassName}
                />
              </div>
              <div className="md:col-span-2 xl:col-span-3">
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Notes
                </label>
                <textarea
                  rows={3}
                  value={form.notes}
                  onChange={(e) => updateField("notes", e.target.value)}
                  className={inputClassName}
                />
              </div>
            </div>
            <div className="flex gap-3">
              <button
                type="submit"
                disabled={loading}
                className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "Saving…" : editingId ? "Save Changes" : "Add Entry"}
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
              <th className={scrollableTableThClassName}>Date</th>
              <th className={scrollableTableThClassName}>Contributed By</th>
              <th className={scrollableTableThClassName}>Amount</th>
              <th className={scrollableTableThClassName}>Description</th>
              <th className={scrollableTableThClassName}>Notes</th>
              <th className={scrollableTableThClassName}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {entries.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-8 text-center text-slate-500"
                >
                  No capital contributions recorded yet.
                </td>
              </tr>
            ) : (
              entries.map((entry, index) => (
                <tr
                  key={entry.id}
                  className={getStripedRowClassName(index)}
                >
                  <td className="px-4 py-3">
                    {formatContributionDate(entry.date)}
                  </td>
                  <td className="px-4 py-3">{getContributorName(entry)}</td>
                  <td className="px-4 py-3">{formatGHS(entry.amount)}</td>
                  <td className="px-4 py-3">{entry.description ?? "—"}</td>
                  <td className="px-4 py-3">{entry.notes ?? "—"}</td>
                  <RegisterRowActions
                    onEdit={() => openEditForm(entry)}
                    onDelete={() => handleDelete(entry.id)}
                    deleting={deletingId === entry.id}
                  />
                </tr>
              ))
            )}
          </tbody>
        </table>
      </ScrollableTable>
    </div>
  );
}
