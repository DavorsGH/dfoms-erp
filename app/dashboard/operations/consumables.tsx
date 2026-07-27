"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import RegisterRowActions, {
  confirmDeleteEntry,
  getStripedRowClassName,
  toDateInputValue,
} from "../finance/register-row-actions";
import {
  getEmployeeDisplayName,
  type HrEmployee,
} from "../hr-payroll/employee-utils";
import { formatDate, inputClassName } from "../hr-payroll/hr-register-utils";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import {
  CONSUMABLES_SELECT,
  deriveStockFields,
  type ConsumablesEntry,
  type ConsumablesSiteOption,
} from "./consumables-utils";

type ConsumablesRegisterProps = {
  initialEntries: ConsumablesEntry[];
  initialEmployees: HrEmployee[];
  initialSites: ConsumablesSiteOption[];
  defaultRecordedBy: string;
  fetchError: string | null;
};

const emptyForm = {
  date: "",
  client_site: "",
  item: "",
  category: "",
  unit: "",
  opening_stock: "",
  qty_issued: "",
  qty_used: "",
  minimum_level: "",
  recorded_by: "",
  notes: "",
};

function nullableText(value: string): string | null {
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

function nullableNumber(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatQty(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "—";
  }
  return Number(value).toLocaleString("en-GH", {
    maximumFractionDigits: 2,
  });
}

function siteLabel(
  sites: ConsumablesSiteOption[],
  siteCode: string | null,
): string {
  if (!siteCode) {
    return "—";
  }
  const site = sites.find((entry) => entry.site_code === siteCode);
  return site?.site_name ?? siteCode;
}

export default function ConsumablesRegister({
  initialEntries,
  initialEmployees,
  initialSites,
  defaultRecordedBy,
  fetchError,
}: ConsumablesRegisterProps) {
  const supabase = createClient();
  const [entries, setEntries] = useState(initialEntries);
  const [employees] = useState(initialEmployees);
  const [sites] = useState(initialSites);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [form, setForm] = useState(() => ({
    ...emptyForm,
    recorded_by: defaultRecordedBy,
  }));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(fetchError);

  const selectedEmployeeMissing = Boolean(
    form.recorded_by &&
      !employees.some((employee) => employee.employee_id === form.recorded_by),
  );

  const selectedSiteMissing = Boolean(
    form.client_site &&
      !sites.some((site) => site.site_code === form.client_site),
  );

  const derived = useMemo(
    () =>
      deriveStockFields({
        opening_stock: form.opening_stock,
        qty_issued: form.qty_issued,
        qty_used: form.qty_used,
        minimum_level: form.minimum_level,
      }),
    [
      form.opening_stock,
      form.qty_issued,
      form.qty_used,
      form.minimum_level,
    ],
  );

  useEffect(() => {
    setEntries(initialEntries);
  }, [initialEntries]);

  async function refreshEntries() {
    const { data, error: refreshError } = await supabase
      .from("consumables")
      .select(CONSUMABLES_SELECT)
      .order("date", { ascending: false });

    if (refreshError) {
      setError(refreshError.message);
      return;
    }

    setEntries((data as ConsumablesEntry[] | null) ?? []);
    setError(null);
  }

  function openAddForm() {
    setEditingId(null);
    setForm({ ...emptyForm, recorded_by: defaultRecordedBy });
    setShowForm(true);
  }

  function closeForm() {
    setEditingId(null);
    setForm({ ...emptyForm, recorded_by: defaultRecordedBy });
    setShowForm(false);
  }

  function openEditForm(entry: ConsumablesEntry) {
    setEditingId(entry.id);
    setForm({
      date: toDateInputValue(entry.date),
      client_site: entry.client_site ?? "",
      item: entry.item,
      category: entry.category ?? "",
      unit: entry.unit ?? "",
      opening_stock:
        entry.opening_stock === null || entry.opening_stock === undefined
          ? ""
          : String(entry.opening_stock),
      qty_issued:
        entry.qty_issued === null || entry.qty_issued === undefined
          ? ""
          : String(entry.qty_issued),
      qty_used:
        entry.qty_used === null || entry.qty_used === undefined
          ? ""
          : String(entry.qty_used),
      minimum_level:
        entry.minimum_level === null || entry.minimum_level === undefined
          ? ""
          : String(entry.minimum_level),
      recorded_by: entry.recorded_by ?? "",
      notes: entry.notes ?? "",
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
      .from("consumables")
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

    const stock = deriveStockFields({
      opening_stock: form.opening_stock,
      qty_issued: form.qty_issued,
      qty_used: form.qty_used,
      minimum_level: form.minimum_level,
    });

    const payload = {
      date: form.date,
      client_site: nullableText(form.client_site),
      item: form.item.trim(),
      category: nullableText(form.category),
      unit: nullableText(form.unit),
      opening_stock: nullableNumber(form.opening_stock),
      qty_issued: nullableNumber(form.qty_issued),
      qty_used: nullableNumber(form.qty_used),
      remaining: stock.remaining,
      minimum_level: nullableNumber(form.minimum_level),
      stock_status: stock.stock_status,
      recorded_by: nullableText(form.recorded_by),
      notes: nullableText(form.notes),
    };

    if (editingId) {
      const { error: saveError } = await supabase
        .from("consumables")
        .update(payload)
        .eq("id", editingId);

      if (saveError) {
        setError(saveError.message);
        setLoading(false);
        return;
      }
    } else {
      const { error: saveError } = await supabase
        .from("consumables")
        .insert(payload);

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
          Track site-level supplies (e.g. cleaning materials). Separate from
          Inventory products and batches.
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
            {editingId ? "Edit Consumable Entry" : "New Consumable Entry"}
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
                  Site
                </label>
                <select
                  value={form.client_site}
                  onChange={(e) => updateField("client_site", e.target.value)}
                  className={inputClassName}
                >
                  <option value="">No site</option>
                  {selectedSiteMissing ? (
                    <option value={form.client_site}>{form.client_site}</option>
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
                  Item
                </label>
                <input
                  type="text"
                  required
                  value={form.item}
                  onChange={(e) => updateField("item", e.target.value)}
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
                  Unit
                </label>
                <input
                  type="text"
                  value={form.unit}
                  onChange={(e) => updateField("unit", e.target.value)}
                  className={inputClassName}
                  placeholder="e.g. litres, packs"
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Recorded By
                </label>
                <select
                  value={form.recorded_by}
                  onChange={(e) => updateField("recorded_by", e.target.value)}
                  className={inputClassName}
                >
                  <option value="">Unassigned</option>
                  {selectedEmployeeMissing ? (
                    <option value={form.recorded_by}>{form.recorded_by}</option>
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
                  Opening Stock
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={form.opening_stock}
                  onChange={(e) => updateField("opening_stock", e.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Qty Issued
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={form.qty_issued}
                  onChange={(e) => updateField("qty_issued", e.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Qty Used
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={form.qty_used}
                  onChange={(e) => updateField("qty_used", e.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Minimum Level
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={form.minimum_level}
                  onChange={(e) => updateField("minimum_level", e.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Remaining
                </label>
                <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-[#0f2744]">
                  {formatQty(derived.remaining)}
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Opening + Issued − Used
                </p>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Stock Status
                </label>
                <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-[#0f2744]">
                  {derived.stock_status}
                </p>
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
              <th className={scrollableTableThClassName}>Date</th>
              <th className={scrollableTableThClassName}>Site</th>
              <th className={scrollableTableThClassName}>Item</th>
              <th className={scrollableTableThClassName}>Remaining</th>
              <th className={scrollableTableThClassName}>Min</th>
              <th className={scrollableTableThClassName}>Status</th>
              <th className={scrollableTableThClassName}>Recorded By</th>
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
                  No consumable entries yet.
                </td>
              </tr>
            ) : (
              entries.map((entry, index) => (
                <tr key={entry.id} className={getStripedRowClassName(index)}>
                  <td className="px-4 py-3">{formatDate(entry.date)}</td>
                  <td className="px-4 py-3">
                    {siteLabel(sites, entry.client_site)}
                  </td>
                  <td className="px-4 py-3">{entry.item}</td>
                  <td className="px-4 py-3">
                    {formatQty(entry.remaining)}
                    {entry.unit ? ` ${entry.unit}` : ""}
                  </td>
                  <td className="px-4 py-3">{formatQty(entry.minimum_level)}</td>
                  <td className="px-4 py-3">{entry.stock_status ?? "—"}</td>
                  <td className="px-4 py-3">
                    {entry.recorded_by
                      ? getEmployeeDisplayName(employees, entry.recorded_by)
                      : "—"}
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
