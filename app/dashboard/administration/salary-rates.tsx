"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import {
  formatDate,
  formatGHS,
  inputClassName,
} from "../employees/employee-record-utils";
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
import {
  SALARY_RATE_EMPLOYMENT_TYPES,
  SALARY_RATE_SHIFTS,
  type SalaryRateEntry,
} from "./salary-rates-utils";

type SalaryRatesProps = {
  initialRates: SalaryRateEntry[];
  initialPositions: string[];
  fetchError: string | null;
};

const emptyForm = {
  position: "",
  employment_type: "",
  shift: "",
  basic_salary: "",
  effective_date: "",
};

export default function SalaryRates({
  initialRates,
  initialPositions,
  fetchError,
}: SalaryRatesProps) {
  const supabase = createClient();
  const [rates, setRates] = useState(initialRates);
  const [positions, setPositions] = useState(initialPositions);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(fetchError);

  useEffect(() => {
    setRates(initialRates);
  }, [initialRates]);

  useEffect(() => {
    if (!showForm) {
      return;
    }

    const client = createClient();

    async function loadPositions() {
      const attempts = [
        "position_name",
        "name",
      ] as const;

      for (const nameColumn of attempts) {
        const { data, error: positionsError } = await client
          .from("positions")
          .select(nameColumn)
          .order(nameColumn, { ascending: true });

        if (positionsError || !data?.length) {
          continue;
        }

        setPositions(
          data
            .map((row) => String((row as Record<string, string>)[nameColumn]))
            .filter(Boolean),
        );
        return;
      }
    }

    loadPositions();
  }, [showForm]);

  async function refreshRates() {
    const { data, error: refreshError } = await supabase
      .from("salary_rate_config")
      .select("*")
      .order("effective_date", { ascending: false });

    if (refreshError) {
      setError(refreshError.message);
      return;
    }

    setRates((data as SalaryRateEntry[] | null) ?? []);
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

  function openEditForm(rate: SalaryRateEntry) {
    setEditingId(rate.id);
    setForm({
      position: rate.position,
      employment_type: rate.employment_type,
      shift: rate.shift,
      basic_salary: String(rate.basic_salary),
      effective_date: toDateInputValue(rate.effective_date),
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
      .from("salary_rate_config")
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

    await refreshRates();
    setDeletingId(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const payload = {
      position: form.position,
      employment_type: form.employment_type,
      shift: form.shift,
      basic_salary: Number(form.basic_salary) || 0,
      effective_date: form.effective_date,
    };

    const { error: saveError } = editingId
      ? await supabase
          .from("salary_rate_config")
          .update(payload)
          .eq("id", editingId)
      : await supabase.from("salary_rate_config").insert(payload);

    if (saveError) {
      setError(saveError.message);
      setLoading(false);
      return;
    }

    closeForm();
    await refreshRates();
    setLoading(false);
  }

  const positionOptions = [...new Set([...positions, form.position].filter(Boolean))].sort(
    (a, b) => a.localeCompare(b),
  );

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">
          Configure basic salary rates by position, employment type, and shift.
        </p>
        <button
          type="button"
          onClick={() => (showForm ? closeForm() : openAddForm())}
          className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c]"
        >
          {showForm ? "Cancel" : "Add Rate"}
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
            {editingId ? "Edit Salary Rate" : "New Salary Rate"}
          </h3>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Position
                </label>
                {positionOptions.length > 0 ? (
                  <select
                    required
                    value={form.position}
                    onChange={(e) => updateField("position", e.target.value)}
                    className={inputClassName}
                  >
                    <option value="">Select position</option>
                    {positionOptions.map((position) => (
                      <option key={position} value={position}>
                        {position}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    required
                    value={form.position}
                    onChange={(e) => updateField("position", e.target.value)}
                    className={inputClassName}
                  />
                )}
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Employment Type
                </label>
                <select
                  required
                  value={form.employment_type}
                  onChange={(e) =>
                    updateField("employment_type", e.target.value)
                  }
                  className={inputClassName}
                >
                  <option value="">Select type</option>
                  {SALARY_RATE_EMPLOYMENT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {type}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Shift
                </label>
                <select
                  required
                  value={form.shift}
                  onChange={(e) => updateField("shift", e.target.value)}
                  className={inputClassName}
                >
                  <option value="">Select shift</option>
                  {SALARY_RATE_SHIFTS.map((shift) => (
                    <option key={shift} value={shift}>
                      {shift}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Basic Salary
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={form.basic_salary}
                  onChange={(e) => updateField("basic_salary", e.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Effective Date
                </label>
                <input
                  type="date"
                  required
                  value={form.effective_date}
                  onChange={(e) =>
                    updateField("effective_date", e.target.value)
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
                {loading ? "Saving…" : editingId ? "Save Changes" : "Add Rate"}
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
              <th className={scrollableTableThClassName}>Position</th>
              <th className={scrollableTableThClassName}>Employment Type</th>
              <th className={scrollableTableThClassName}>Shift</th>
              <th className={scrollableTableThClassName}>Basic Salary</th>
              <th className={scrollableTableThClassName}>Effective Date</th>
              <th className={scrollableTableThClassName}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {rates.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-8 text-center text-slate-500"
                >
                  No salary rates configured yet.
                </td>
              </tr>
            ) : (
              rates.map((rate, index) => (
                <tr key={rate.id} className={getStripedRowClassName(index)}>
                  <td className="px-4 py-3">{rate.position}</td>
                  <td className="px-4 py-3">{rate.employment_type}</td>
                  <td className="px-4 py-3">{rate.shift}</td>
                  <td className="px-4 py-3">{formatGHS(rate.basic_salary)}</td>
                  <td className="px-4 py-3">{formatDate(rate.effective_date)}</td>
                  <RegisterRowActions
                    onEdit={() => openEditForm(rate)}
                    onDelete={() => handleDelete(rate.id)}
                    deleting={deletingId === rate.id}
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
