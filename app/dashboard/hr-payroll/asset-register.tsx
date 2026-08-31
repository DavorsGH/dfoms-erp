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
import { allocateStaffKitId } from "./staff-kit-id-api";
import {
  getEmployeeDisplayName,
  type HrEmployee,
} from "./employee-utils";
import {
  ASSET_CONDITION_OPTIONS,
  ASSET_REGISTER_SELECT,
  type AssetRegisterEntry,
} from "./asset-register-utils";
import { formatDate, inputClassName } from "./hr-register-utils";
import { useBusinessUnitReadScope } from "@/app/dashboard/business-unit-view-context";
import {
  applyEmployeeIdScope,
  fetchScopedEmployeeIds,
} from "@/app/dashboard/hr-payroll/payroll-bu-scope-utils";

type AssetRegisterProps = {
  initialEntries: AssetRegisterEntry[];
  initialEmployees: HrEmployee[];
  fetchError: string | null;
  /** Workspace id for employee-linked BU scoping on refresh. */
  tenantId?: string | null;
};

const emptyForm = {
  asset_id: "",
  employee_id: "",
  asset_name: "",
  date_issued: "",
  date_returned: "",
  condition: "",
};

function nullableText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export default function AssetRegister({
  initialEntries,
  initialEmployees,
  fetchError,
  tenantId = null,
}: AssetRegisterProps) {
  const supabase = createClient();
  const buReadScope = useBusinessUnitReadScope();
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

  const conditionOptions = useMemo(() => {
    const options: string[] = [...ASSET_CONDITION_OPTIONS];
    if (form.condition && !options.includes(form.condition)) {
      options.push(form.condition);
    }
    return options;
  }, [form.condition]);

  useEffect(() => {
    setEntries(initialEntries);
  }, [initialEntries]);

  async function refreshEntries() {
    if (!tenantId) {
      setError("Unable to resolve your workspace.");
      return;
    }

    const scoped = await fetchScopedEmployeeIds(
      supabase,
      tenantId,
      buReadScope,
    );
    if (scoped.error) {
      setError(scoped.error);
      return;
    }

    const { data, error: refreshError } = await applyEmployeeIdScope(
      supabase
        .from("asset_register")
        .select(ASSET_REGISTER_SELECT),
      scoped.employeeIds,
    ).order("asset_id", { ascending: true });

    if (refreshError) {
      setError(refreshError.message);
      return;
    }

    setEntries((data as AssetRegisterEntry[] | null) ?? []);
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

  function openEditForm(entry: AssetRegisterEntry) {
    setEditingId(entry.asset_id);
    setForm({
      asset_id: entry.asset_id,
      employee_id: entry.employee_id ?? "",
      asset_name: entry.asset_name,
      date_issued: entry.date_issued
        ? toDateInputValue(entry.date_issued)
        : "",
      date_returned: entry.date_returned
        ? toDateInputValue(entry.date_returned)
        : "",
      condition: entry.condition ?? "",
    });
    setShowForm(true);
  }

  function updateField(field: keyof typeof emptyForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleDelete(assetId: string) {
    if (!confirmDeleteEntry()) {
      return;
    }

    setDeletingId(assetId);
    setError(null);

    const { error: deleteError } = await supabase
      .from("asset_register")
      .delete()
      .eq("asset_id", assetId);

    if (deleteError) {
      setError(deleteError.message);
      setDeletingId(null);
      return;
    }

    if (editingId === assetId) {
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
      employee_id: nullableText(form.employee_id),
      asset_name: form.asset_name.trim(),
      date_issued: nullableText(form.date_issued),
      date_returned: nullableText(form.date_returned),
      condition: nullableText(form.condition),
    };

    if (editingId) {
      const { error: saveError } = await supabase
        .from("asset_register")
        .update(payload)
        .eq("asset_id", editingId);

      if (saveError) {
        setError(saveError.message);
        setLoading(false);
        return;
      }
    } else {
      const allocated = await allocateStaffKitId(supabase);
      if (allocated.error || !allocated.assetId) {
        setError(allocated.error ?? "Unable to allocate staff kit ID.");
        setLoading(false);
        return;
      }

      const { error: saveError } = await supabase.from("asset_register").insert({
        ...payload,
        asset_id: allocated.assetId,
      });

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
          Track tools, uniforms, phones, and other kit issued to staff. Separate
          from Finance fixed assets.
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
            {editingId ? "Edit Staff Kit Item" : "New Staff Kit Item"}
          </h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {editingId ? (
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Asset ID
                  </label>
                  <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-[#0f2744]">
                    {form.asset_id}
                  </p>
                </div>
              ) : null}
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Asset Name
                </label>
                <input
                  type="text"
                  required
                  value={form.asset_name}
                  onChange={(e) => updateField("asset_name", e.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Employee
                </label>
                <select
                  value={form.employee_id}
                  onChange={(e) => updateField("employee_id", e.target.value)}
                  className={inputClassName}
                >
                  <option value="">Not assigned (in storage)</option>
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
                  Date Issued
                </label>
                <input
                  type="date"
                  value={form.date_issued}
                  onChange={(e) => updateField("date_issued", e.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Date Returned
                </label>
                <input
                  type="date"
                  value={form.date_returned}
                  onChange={(e) => updateField("date_returned", e.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Condition
                </label>
                <select
                  value={form.condition}
                  onChange={(e) => updateField("condition", e.target.value)}
                  className={inputClassName}
                >
                  <option value="">Select condition</option>
                  {conditionOptions.map((condition) => (
                    <option key={condition} value={condition}>
                      {condition}
                    </option>
                  ))}
                </select>
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
              <th className={scrollableTableThClassName}>Asset ID</th>
              <th className={scrollableTableThClassName}>Asset Name</th>
              <th className={scrollableTableThClassName}>Employee</th>
              <th className={scrollableTableThClassName}>Date Issued</th>
              <th className={scrollableTableThClassName}>Date Returned</th>
              <th className={scrollableTableThClassName}>Condition</th>
              <th className={scrollableTableThClassName}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {entries.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-8 text-center text-slate-500"
                >
                  No staff kit items yet.
                </td>
              </tr>
            ) : (
              entries.map((entry, index) => (
                <tr
                  key={entry.asset_id}
                  className={getStripedRowClassName(index)}
                >
                  <td className="px-4 py-3">{entry.asset_id}</td>
                  <td className="px-4 py-3">{entry.asset_name}</td>
                  <td className="px-4 py-3">
                    {entry.employee_id
                      ? getEmployeeDisplayName(employees, entry.employee_id)
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {entry.date_issued ? formatDate(entry.date_issued) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {entry.date_returned
                      ? formatDate(entry.date_returned)
                      : "—"}
                  </td>
                  <td className="px-4 py-3">{entry.condition ?? "—"}</td>
                  <RegisterRowActions
                    onEdit={() => openEditForm(entry)}
                    onDelete={() => handleDelete(entry.asset_id)}
                    deleting={deletingId === entry.asset_id}
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
