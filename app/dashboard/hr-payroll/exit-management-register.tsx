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
} from "../scrollable-table";
import { getEmployeeDisplayName, type HrEmployee } from "./employee-utils";
import { requestTenantAdminDirectorNotification } from "@/utils/request-tenant-admin-director-notification";
import {
  EXIT_MANAGEMENT_SELECT,
  EXIT_REASON_OPTIONS,
  type ExitManagementEntry,
} from "./exit-management-utils";
import { formatDate, formatGHS, inputClassName } from "./hr-register-utils";

type ExitManagementRegisterProps = {
  initialEntries: ExitManagementEntry[];
  initialEmployees: HrEmployee[];
  fetchError: string | null;
};

const emptyForm = {
  employee_id: "",
  exit_date: "",
  exit_reason: "",
  notice_period_days: "",
  final_settlement: "",
};

function nullableText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function nullableInteger(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? Math.trunc(parsed) : null;
}

function nullableAmount(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

export default function ExitManagementRegister({
  initialEntries,
  initialEmployees,
  fetchError,
}: ExitManagementRegisterProps) {
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

  const exitReasonOptions = useMemo(() => {
    const options: string[] = [...EXIT_REASON_OPTIONS];
    if (form.exit_reason && !options.includes(form.exit_reason)) {
      options.push(form.exit_reason);
    }
    return options;
  }, [form.exit_reason]);

  useEffect(() => {
    setEntries(initialEntries);
  }, [initialEntries]);

  async function refreshEntries() {
    const { data, error: refreshError } = await supabase
      .from("exit_management")
      .select(EXIT_MANAGEMENT_SELECT)
      .order("exit_date", { ascending: false });

    if (refreshError) {
      setError(refreshError.message);
      return;
    }

    setEntries((data as ExitManagementEntry[] | null) ?? []);
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

  function openEditForm(entry: ExitManagementEntry) {
    setEditingId(entry.id);
    setForm({
      employee_id: entry.employee_id,
      exit_date: toDateInputValue(entry.exit_date),
      exit_reason: entry.exit_reason ?? "",
      notice_period_days:
        entry.notice_period_days === null
          ? ""
          : String(entry.notice_period_days),
      final_settlement:
        entry.final_settlement === null ? "" : String(entry.final_settlement),
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
      .from("exit_management")
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
      exit_date: form.exit_date,
      exit_reason: nullableText(form.exit_reason),
      notice_period_days: nullableInteger(form.notice_period_days),
      final_settlement: nullableAmount(form.final_settlement),
    };

    if (editingId) {
      const { error: saveError } = await supabase
        .from("exit_management")
        .update(payload)
        .eq("id", editingId);

      if (saveError) {
        setError(saveError.message);
        setLoading(false);
        return;
      }
    } else {
      const { error: saveError } = await supabase
        .from("exit_management")
        .insert(payload);

      if (saveError) {
        setError(saveError.message);
        setLoading(false);
        return;
      }

      requestTenantAdminDirectorNotification({
        title: "Employee exit recorded",
        detail: getEmployeeDisplayName(employees, form.employee_id),
        actionUrl: "/dashboard/hr-payroll/exit-management",
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
          Record employee exits, notice periods, and final settlements.
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
            {editingId ? "Edit Exit Record" : "New Exit Record"}
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
                  Exit Date
                </label>
                <input
                  type="date"
                  required
                  value={form.exit_date}
                  onChange={(e) => updateField("exit_date", e.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Exit Reason
                </label>
                <select
                  value={form.exit_reason}
                  onChange={(e) => updateField("exit_reason", e.target.value)}
                  className={inputClassName}
                >
                  <option value="">Select exit reason</option>
                  {exitReasonOptions.map((reason) => (
                    <option key={reason} value={reason}>
                      {reason}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Notice Period (Days)
                </label>
                <input
                  type="number"
                  min="0"
                  step="1"
                  value={form.notice_period_days}
                  onChange={(e) =>
                    updateField("notice_period_days", e.target.value)
                  }
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Final Settlement
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.final_settlement}
                  onChange={(e) =>
                    updateField("final_settlement", e.target.value)
                  }
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
              <th className={scrollableTableThClassName}>Exit Date</th>
              <th className={scrollableTableThClassName}>Exit Reason</th>
              <th className={scrollableTableThClassName}>Notice Period</th>
              <th className={scrollableTableThClassName}>Final Settlement</th>
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
                  No exit records yet.
                </td>
              </tr>
            ) : (
              entries.map((entry, index) => (
                <tr key={entry.id} className={getStripedRowClassName(index)}>
                  <td className="px-4 py-3">
                    {getEmployeeDisplayName(employees, entry.employee_id)}
                  </td>
                  <td className="px-4 py-3">{formatDate(entry.exit_date)}</td>
                  <td className="px-4 py-3">{entry.exit_reason ?? "—"}</td>
                  <td className="px-4 py-3">
                    {entry.notice_period_days === null
                      ? "—"
                      : `${entry.notice_period_days} days`}
                  </td>
                  <td className="px-4 py-3">
                    {entry.final_settlement === null
                      ? "—"
                      : formatGHS(entry.final_settlement)}
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
