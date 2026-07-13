"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import type { Approver } from "../lookup-types";
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
import type { OvertimeRegisterEntry } from "./overtime-register-utils";
import {
  calculateOvertimeAmount,
  formatDate,
  formatGHS,
  inputClassName,
} from "./hr-register-utils";

type OvertimeRegisterProps = {
  initialEntries: OvertimeRegisterEntry[];
  initialEmployees: HrEmployee[];
  initialApprovers: Approver[];
  fetchError: string | null;
};

const emptyForm = {
  date: "",
  employee_id: "",
  hours_worked: "",
  overtime_hours: "",
  overtime_rate: "",
  approved_by: "",
};

export default function OvertimeRegister({
  initialEntries,
  initialEmployees,
  initialApprovers,
  fetchError,
}: OvertimeRegisterProps) {
  const supabase = createClient();
  const [entries, setEntries] = useState(initialEntries);
  const [employees] = useState(initialEmployees);
  const [approvers] = useState(initialApprovers);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(fetchError);

  const previewOvertimeAmount = useMemo(
    () =>
      calculateOvertimeAmount(
        Number(form.overtime_hours) || 0,
        Number(form.overtime_rate) || 0,
      ),
    [form.overtime_hours, form.overtime_rate],
  );

  useEffect(() => {
    setEntries(initialEntries);
  }, [initialEntries]);

  async function refreshEntries() {
    const { data, error: refreshError } = await supabase
      .from("overtime_register")
      .select("*")
      .order("date", { ascending: false });

    if (refreshError) {
      setError(refreshError.message);
      return;
    }

    setEntries((data as OvertimeRegisterEntry[] | null) ?? []);
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

  function openEditForm(entry: OvertimeRegisterEntry) {
    setEditingId(entry.id);
    setForm({
      date: toDateInputValue(entry.date),
      employee_id: entry.employee_id,
      hours_worked:
        entry.hours_worked === null ? "" : String(entry.hours_worked),
      overtime_hours: String(entry.overtime_hours),
      overtime_rate: String(entry.overtime_rate),
      approved_by: entry.approved_by ?? "",
    });
    setShowForm(true);
  }

  function updateField(field: keyof typeof emptyForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleDelete(id: string) {
    if (!confirmDeleteEntry()) {
      return;
    }

    setDeletingId(id);
    setError(null);

    const { error: deleteError } = await supabase
      .from("overtime_register")
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

    const overtimeAmount = calculateOvertimeAmount(
      Number(form.overtime_hours) || 0,
      Number(form.overtime_rate) || 0,
    );

    const payload = {
      date: form.date,
      employee_id: form.employee_id,
      hours_worked: form.hours_worked ? Number(form.hours_worked) : null,
      overtime_hours: Number(form.overtime_hours) || 0,
      overtime_rate: Number(form.overtime_rate) || 0,
      overtime_amount: overtimeAmount,
      approved_by: form.approved_by || null,
    };

    const { error: saveError } = editingId
      ? await supabase
          .from("overtime_register")
          .update(payload)
          .eq("id", editingId)
      : await supabase.from("overtime_register").insert(payload);

    if (saveError) {
      setError(saveError.message);
      setLoading(false);
      return;
    }

    closeForm();
    await refreshEntries();
    setLoading(false);
  }

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">
          Record overtime hours, rates, and approval for payroll processing.
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
            {editingId ? "Edit Overtime Entry" : "New Overtime Entry"}
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
                  Hours Worked
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.hours_worked}
                  onChange={(e) => updateField("hours_worked", e.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Overtime Hours
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={form.overtime_hours}
                  onChange={(e) =>
                    updateField("overtime_hours", e.target.value)
                  }
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Overtime Rate
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={form.overtime_rate}
                  onChange={(e) => updateField("overtime_rate", e.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Approved By
                </label>
                <select
                  value={form.approved_by}
                  onChange={(e) => updateField("approved_by", e.target.value)}
                  className={inputClassName}
                >
                  <option value="">Select approver</option>
                  {approvers.map((approver) => (
                    <option key={approver.employee_id} value={approver.full_name}>
                      {approver.full_name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            <p className="text-sm text-slate-600">
              Overtime Amount:{" "}
              <span className="font-medium text-[#0f2744]">
                {formatGHS(previewOvertimeAmount)}
              </span>
            </p>
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
              <th className={scrollableTableThClassName}>Employee</th>
              <th className={scrollableTableThClassName}>Hours Worked</th>
              <th className={scrollableTableThClassName}>Overtime Hours</th>
              <th className={scrollableTableThClassName}>Overtime Rate</th>
              <th className={scrollableTableThClassName}>Overtime Amount</th>
              <th className={scrollableTableThClassName}>Approved By</th>
              <th className={scrollableTableThClassName}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {entries.length === 0 ? (
              <tr>
                <td
                  colSpan={8}
                  className="px-4 py-8 text-center text-slate-500"
                >
                  No overtime entries yet.
                </td>
              </tr>
            ) : (
              entries.map((entry, index) => {
                const overtimeAmount =
                  entry.overtime_amount ??
                  calculateOvertimeAmount(
                    entry.overtime_hours,
                    entry.overtime_rate,
                  );

                return (
                  <tr key={entry.id} className={getStripedRowClassName(index)}>
                    <td className="px-4 py-3">{formatDate(entry.date)}</td>
                    <td className="px-4 py-3">
                      {getEmployeeDisplayName(employees, entry.employee_id)}
                    </td>
                    <td className="px-4 py-3">{entry.hours_worked ?? "—"}</td>
                    <td className="px-4 py-3">{entry.overtime_hours}</td>
                    <td className="px-4 py-3">{formatGHS(entry.overtime_rate)}</td>
                    <td className="px-4 py-3">{formatGHS(overtimeAmount)}</td>
                    <td className="px-4 py-3">{entry.approved_by ?? "—"}</td>
                    <RegisterRowActions
                      onEdit={() => openEditForm(entry)}
                      onDelete={() => handleDelete(entry.id)}
                      deleting={deletingId === entry.id}
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
