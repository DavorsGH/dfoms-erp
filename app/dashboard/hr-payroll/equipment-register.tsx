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
import { allocateEquipmentId } from "./equipment-id-api";
import {
  getEmployeeDisplayName,
  type HrEmployee,
} from "./employee-utils";
import {
  DEFAULT_EQUIPMENT_STATUS,
  EQUIPMENT_REGISTER_SELECT,
  type EquipmentRegisterEntry,
  type EquipmentSiteOption,
} from "./equipment-register-utils";
import { formatDate, inputClassName } from "./hr-register-utils";
import { useBusinessUnitReadScope } from "@/app/dashboard/business-unit-view-context";
import {
  applyEmployeeIdScopeToColumn,
  fetchScopedEmployeeIds,
} from "@/app/dashboard/hr-payroll/payroll-bu-scope-utils";

type EquipmentRegisterProps = {
  initialEntries: EquipmentRegisterEntry[];
  initialEmployees: HrEmployee[];
  initialSites: EquipmentSiteOption[];
  statusOptions: string[];
  fetchError: string | null;
  /** Workspace id for employee-linked BU scoping on refresh. */
  tenantId?: string | null;
};

const emptyForm = {
  equipment_id: "",
  equipment_name: "",
  category: "",
  serial_number: "",
  assigned_to: "",
  assigned_site: "",
  condition: "",
  purchase_date: "",
  last_maintenance: "",
  next_service_due: "",
  current_status: DEFAULT_EQUIPMENT_STATUS,
  service_alert: false,
  notes: "",
};

function nullableText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function siteLabel(
  sites: EquipmentSiteOption[],
  siteCode: string | null,
): string {
  if (!siteCode) {
    return "—";
  }
  const site = sites.find((entry) => entry.site_code === siteCode);
  return site?.site_name ?? siteCode;
}

export default function EquipmentRegister({
  initialEntries,
  initialEmployees,
  initialSites,
  statusOptions,
  fetchError,
  tenantId = null,
}: EquipmentRegisterProps) {
  const supabase = createClient();
  const buReadScope = useBusinessUnitReadScope();
  const [entries, setEntries] = useState(initialEntries);
  const [employees] = useState(initialEmployees);
  const [sites] = useState(initialSites);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(fetchError);

  const selectedEmployeeMissing = Boolean(
    form.assigned_to &&
      !employees.some((employee) => employee.employee_id === form.assigned_to),
  );

  const selectedSiteMissing = Boolean(
    form.assigned_site &&
      !sites.some((site) => site.site_code === form.assigned_site),
  );

  const currentStatusOptions = useMemo(() => {
    const options = [...statusOptions];
    if (form.current_status && !options.includes(form.current_status)) {
      options.push(form.current_status);
    }
    return options;
  }, [form.current_status, statusOptions]);

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

    const { data, error: refreshError } = await applyEmployeeIdScopeToColumn(
      supabase
        .from("equipment_register")
        .select(EQUIPMENT_REGISTER_SELECT),
      scoped.employeeIds,
      "assigned_to",
    ).order("equipment_id", { ascending: true });

    if (refreshError) {
      setError(refreshError.message);
      return;
    }

    setEntries((data as EquipmentRegisterEntry[] | null) ?? []);
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

  function openEditForm(entry: EquipmentRegisterEntry) {
    setEditingId(entry.equipment_id);
    setForm({
      equipment_id: entry.equipment_id,
      equipment_name: entry.equipment_name,
      category: entry.category ?? "",
      serial_number: entry.serial_number ?? "",
      assigned_to: entry.assigned_to ?? "",
      assigned_site: entry.assigned_site ?? "",
      condition: entry.condition ?? "",
      purchase_date: entry.purchase_date
        ? toDateInputValue(entry.purchase_date)
        : "",
      last_maintenance: entry.last_maintenance
        ? toDateInputValue(entry.last_maintenance)
        : "",
      next_service_due: entry.next_service_due
        ? toDateInputValue(entry.next_service_due)
        : "",
      current_status: entry.current_status ?? DEFAULT_EQUIPMENT_STATUS,
      service_alert: Boolean(entry.service_alert),
      notes: entry.notes ?? "",
    });
    setShowForm(true);
  }

  function updateField(
    field: keyof typeof emptyForm,
    value: string | boolean,
  ) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function handleDelete(equipmentId: string) {
    if (!confirmDeleteEntry()) {
      return;
    }

    setDeletingId(equipmentId);
    setError(null);

    const { error: deleteError } = await supabase
      .from("equipment_register")
      .delete()
      .eq("equipment_id", equipmentId);

    if (deleteError) {
      setError(deleteError.message);
      setDeletingId(null);
      return;
    }

    if (editingId === equipmentId) {
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
      equipment_name: form.equipment_name.trim(),
      category: nullableText(form.category),
      serial_number: nullableText(form.serial_number),
      assigned_to: nullableText(form.assigned_to),
      assigned_site: nullableText(form.assigned_site),
      condition: nullableText(form.condition),
      purchase_date: nullableText(form.purchase_date),
      last_maintenance: nullableText(form.last_maintenance),
      next_service_due: nullableText(form.next_service_due),
      current_status: nullableText(form.current_status) ?? DEFAULT_EQUIPMENT_STATUS,
      service_alert: form.service_alert,
      notes: nullableText(form.notes),
    };

    if (editingId) {
      const { error: saveError } = await supabase
        .from("equipment_register")
        .update(payload)
        .eq("equipment_id", editingId);

      if (saveError) {
        setError(saveError.message);
        setLoading(false);
        return;
      }
    } else {
      const allocated = await allocateEquipmentId(supabase);
      if (allocated.error || !allocated.equipmentId) {
        setError(allocated.error ?? "Unable to allocate equipment ID.");
        setLoading(false);
        return;
      }

      const { error: saveError } = await supabase
        .from("equipment_register")
        .insert({
          ...payload,
          equipment_id: allocated.equipmentId,
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
          Track equipment assignment, condition, and service due dates.
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
            {editingId ? "Edit Equipment" : "New Equipment"}
          </h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {editingId ? (
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Equipment ID
                  </label>
                  <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-[#0f2744]">
                    {form.equipment_id}
                  </p>
                </div>
              ) : null}
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Equipment Name
                </label>
                <input
                  type="text"
                  required
                  value={form.equipment_name}
                  onChange={(e) => updateField("equipment_name", e.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Category
                </label>
                <input
                  type="text"
                  value={form.category}
                  onChange={(e) => updateField("category", e.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Serial Number
                </label>
                <input
                  type="text"
                  value={form.serial_number}
                  onChange={(e) => updateField("serial_number", e.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Assigned To
                </label>
                <select
                  value={form.assigned_to}
                  onChange={(e) => updateField("assigned_to", e.target.value)}
                  className={inputClassName}
                >
                  <option value="">Unassigned</option>
                  {selectedEmployeeMissing ? (
                    <option value={form.assigned_to}>{form.assigned_to}</option>
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
                  Assigned Site
                </label>
                <select
                  value={form.assigned_site}
                  onChange={(e) => updateField("assigned_site", e.target.value)}
                  className={inputClassName}
                >
                  <option value="">Unassigned</option>
                  {selectedSiteMissing ? (
                    <option value={form.assigned_site}>
                      {form.assigned_site}
                    </option>
                  ) : null}
                  {sites.map((site) => (
                    <option key={site.site_code} value={site.site_code}>
                      {site.site_name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Condition
                </label>
                <input
                  type="text"
                  value={form.condition}
                  onChange={(e) => updateField("condition", e.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Purchase Date
                </label>
                <input
                  type="date"
                  value={form.purchase_date}
                  onChange={(e) => updateField("purchase_date", e.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Last Maintenance
                </label>
                <input
                  type="date"
                  value={form.last_maintenance}
                  onChange={(e) =>
                    updateField("last_maintenance", e.target.value)
                  }
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Next Service Due
                </label>
                <input
                  type="date"
                  value={form.next_service_due}
                  onChange={(e) =>
                    updateField("next_service_due", e.target.value)
                  }
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Current Status
                </label>
                <select
                  value={form.current_status}
                  onChange={(e) =>
                    updateField("current_status", e.target.value)
                  }
                  className={inputClassName}
                >
                  <option value="">Select status</option>
                  {currentStatusOptions.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-end">
                <label className="flex items-center gap-2 text-sm font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={form.service_alert}
                    onChange={(e) =>
                      updateField("service_alert", e.target.checked)
                    }
                    className="h-4 w-4 rounded border-slate-300"
                  />
                  Service Alert
                </label>
              </div>
              <div className="md:col-span-2 xl:col-span-3">
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Notes
                </label>
                <textarea
                  value={form.notes}
                  onChange={(e) => updateField("notes", e.target.value)}
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
              <th className={scrollableTableThClassName}>Equipment ID</th>
              <th className={scrollableTableThClassName}>Name</th>
              <th className={scrollableTableThClassName}>Status</th>
              <th className={scrollableTableThClassName}>Assigned To</th>
              <th className={scrollableTableThClassName}>Site</th>
              <th className={scrollableTableThClassName}>Next Service</th>
              <th className={scrollableTableThClassName}>Alert</th>
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
                  No equipment records yet.
                </td>
              </tr>
            ) : (
              entries.map((entry, index) => (
                <tr
                  key={entry.equipment_id}
                  className={getStripedRowClassName(index)}
                >
                  <td className="px-4 py-3">{entry.equipment_id}</td>
                  <td className="px-4 py-3">{entry.equipment_name}</td>
                  <td className="px-4 py-3">
                    {entry.current_status ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    {entry.assigned_to
                      ? getEmployeeDisplayName(employees, entry.assigned_to)
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {siteLabel(sites, entry.assigned_site)}
                  </td>
                  <td className="px-4 py-3">
                    {entry.next_service_due
                      ? formatDate(entry.next_service_due)
                      : "—"}
                  </td>
                  <td className="px-4 py-3">
                    {entry.service_alert ? "Yes" : "No"}
                  </td>
                  <RegisterRowActions
                    onEdit={() => openEditForm(entry)}
                    onDelete={() => handleDelete(entry.equipment_id)}
                    deleting={deletingId === entry.equipment_id}
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
