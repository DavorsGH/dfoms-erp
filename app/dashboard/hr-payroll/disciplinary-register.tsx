"use client";

import { useEffect, useMemo, useState } from "react";
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
  scrollableTableWrapTdClassName,
  scrollableTableWrapThClassName,
} from "../scrollable-table";
import { getEmployeeDisplayName, type HrEmployee } from "./employee-utils";
import { requestTenantAdminDirectorNotification } from "@/utils/request-tenant-admin-director-notification";
import {
  DISCIPLINARY_SELECT,
  WARNING_LEVEL_OPTIONS,
  type DisciplinaryRecordEntry,
} from "./disciplinary-register-utils";
import { formatDate, inputClassName } from "./hr-register-utils";

type DisciplinaryRegisterProps = {
  initialEntries: DisciplinaryRecordEntry[];
  initialEmployees: HrEmployee[];
  fetchError: string | null;
};

const emptyForm = {
  employee_id: "",
  incident_date: "",
  description: "",
  action_taken: "",
  warning_level: "",
};

function nullableText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export default function DisciplinaryRegister({
  initialEntries,
  initialEmployees,
  fetchError,
}: DisciplinaryRegisterProps) {
  const supabase = createClient();
  const [entries, setEntries] = useState(initialEntries);
  const [employees] = useState(initialEmployees);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(fetchError);

  const selectedEmployeeMissing = Boolean(
    form.employee_id &&
      !employees.some((employee) => employee.employee_id === form.employee_id),
  );

  const warningLevelOptions = useMemo(() => {
    const options: string[] = [...WARNING_LEVEL_OPTIONS];
    if (form.warning_level && !options.includes(form.warning_level)) {
      options.push(form.warning_level);
    }
    return options;
  }, [form.warning_level]);

  useEffect(() => {
    setEntries(initialEntries);
  }, [initialEntries]);

  async function refreshEntries() {
    const { data, error: refreshError } = await supabase
      .from("disciplinary_records")
      .select(DISCIPLINARY_SELECT)
      .order("incident_date", { ascending: false });

    if (refreshError) {
      setError(refreshError.message);
      return;
    }

    setEntries((data as DisciplinaryRecordEntry[] | null) ?? []);
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

  function openEditForm(entry: DisciplinaryRecordEntry) {
    setEditingId(entry.id);
    setForm({
      employee_id: entry.employee_id,
      incident_date: toDateInputValue(entry.incident_date),
      description: entry.description ?? "",
      action_taken: entry.action_taken ?? "",
      warning_level: entry.warning_level ?? "",
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
      .from("disciplinary_records")
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
      employee_id: form.employee_id,
      incident_date: form.incident_date,
      description: nullableText(form.description),
      action_taken: nullableText(form.action_taken),
      warning_level: nullableText(form.warning_level),
    };

    if (editingId) {
      const { error: saveError } = await supabase
        .from("disciplinary_records")
        .update(payload)
        .eq("id", editingId);

      if (saveError) {
        setError(saveError.message);
        setLoading(false);
        return;
      }
    } else {
      const { error: saveError } = await supabase
        .from("disciplinary_records")
        .insert(payload);

      if (saveError) {
        setError(saveError.message);
        setLoading(false);
        return;
      }

      requestTenantAdminDirectorNotification({
        title: "Disciplinary record recorded",
        detail: getEmployeeDisplayName(employees, form.employee_id),
        actionUrl: "/dashboard/hr-payroll/disciplinary",
      });
    }

    closeForm();
    await refreshEntries();
    setLoading(false);
  }

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">
          Record disciplinary incidents, warnings, and actions taken.
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
            {editingId ? "Edit Disciplinary Record" : "New Disciplinary Record"}
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
                  {selectedEmployeeMissing ? (
                    <option value={form.employee_id}>{form.employee_id}</option>
                  ) : null}
                  {employees.map((employee) => (
                    <option
                      key={employee.employee_id}
                      value={employee.employee_id}
                    >
                      {employee.staff_id} — {employee.full_name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Incident Date
                </label>
                <input
                  type="date"
                  required
                  value={form.incident_date}
                  onChange={(e) => updateField("incident_date", e.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Warning Level
                </label>
                <select
                  value={form.warning_level}
                  onChange={(e) => updateField("warning_level", e.target.value)}
                  className={inputClassName}
                >
                  <option value="">Select warning level</option>
                  {warningLevelOptions.map((level) => (
                    <option key={level} value={level}>
                      {level}
                    </option>
                  ))}
                </select>
              </div>
              <div className="md:col-span-2 xl:col-span-3">
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Description
                </label>
                <textarea
                  value={form.description}
                  onChange={(e) => updateField("description", e.target.value)}
                  rows={3}
                  className={inputClassName}
                />
              </div>
              <div className="md:col-span-2 xl:col-span-3">
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Action Taken
                </label>
                <textarea
                  value={form.action_taken}
                  onChange={(e) => updateField("action_taken", e.target.value)}
                  rows={3}
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
                {loading
                  ? "Saving…"
                  : editingId
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
              <th className={scrollableTableThClassName}>Employee</th>
              <th className={scrollableTableThClassName}>Incident Date</th>
              <th className={scrollableTableThClassName}>Warning Level</th>
              <th className={scrollableTableWrapThClassName}>Description</th>
              <th className={scrollableTableWrapThClassName}>Action Taken</th>
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
                  No disciplinary records yet.
                </td>
              </tr>
            ) : (
              entries.map((entry, index) => (
                <tr key={entry.id} className={getStripedRowClassName(index)}>
                  <td className="px-4 py-3">
                    {getEmployeeDisplayName(employees, entry.employee_id)}
                  </td>
                  <td className="px-4 py-3">
                    {formatDate(entry.incident_date)}
                  </td>
                  <td className="px-4 py-3">{entry.warning_level ?? "—"}</td>
                  <td className={scrollableTableWrapTdClassName}>
                    {entry.description ?? "—"}
                  </td>
                  <td className={scrollableTableWrapTdClassName}>
                    {entry.action_taken ?? "—"}
                  </td>
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
