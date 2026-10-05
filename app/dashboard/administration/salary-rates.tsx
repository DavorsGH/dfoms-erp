"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import {
  assertTenantIdForMutation,
  tenantScopedDelete,
  tenantScopedUpdate,
} from "@/utils/tenant-scoped-supabase";
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
  scrollableTableBodyCellClassNameForHeading,
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableHeadingClassName,
  scrollableTableRegisterDateCellClassName,
} from "../scrollable-table";
import {
  SALARY_RATE_EMPLOYMENT_TYPES,
  SALARY_RATE_SHIFTS,
  type SalaryRateEntry,
} from "./salary-rates-utils";
import { useStampBusinessUnitId } from "@/app/dashboard/business-unit-view-context";

type SalaryRatesProps = {
  tenantId: string;
  initialRates: SalaryRateEntry[];
  initialPositions: string[];
  fetchError: string | null;
  activeBusinessUnitId?: string | null;
};

const emptyForm = {
  position: "",
  employment_type: "",
  shift: "",
  basic_salary: "",
  effective_date: "",
};

export default function SalaryRates({
  tenantId,
  initialRates,
  initialPositions,
  fetchError,
  activeBusinessUnitId = null,
}: SalaryRatesProps) {
  const supabase = createClient();
  const scopedTenantId = assertTenantIdForMutation(tenantId);
  const stampBusinessUnit = useStampBusinessUnitId();
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
      const { data, error: positionsError } = await client
        .from("positions")
        .select("position_title")
        .eq("tenant_id", scopedTenantId)
        .order("position_title", { ascending: true });

      if (positionsError || !data?.length) {
        return;
      }

      setPositions(
        data
          .map((row) =>
            String((row as Record<string, string>).position_title ?? "").trim(),
          )
          .filter(Boolean),
      );
    }

    void loadPositions();
  }, [showForm, scopedTenantId]);

  async function refreshRates() {
    const { data, error: refreshError } = await supabase
      .from("salary_rate_config")
      .select("*")
      .eq("tenant_id", scopedTenantId)
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
    if (!(await confirmDeleteEntry())) {
      return;
    }

    setDeletingId(id);
    setError(null);

    const { error: deleteError } = await tenantScopedDelete(
      supabase,
      "salary_rate_config",
      scopedTenantId,
      { id },
    );

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

    if (!editingId && !stampBusinessUnit.ok) {
      setError(stampBusinessUnit.error);
      setLoading(false);
      return;
    }

    const payload = {
      position: form.position,
      employment_type: form.employment_type,
      shift: form.shift,
      basic_salary: Number(form.basic_salary) || 0,
      effective_date: form.effective_date,
    };

    const { error: saveError } = editingId
      ? await tenantScopedUpdate(
          supabase,
          "salary_rate_config",
          scopedTenantId,
          payload,
          { id: editingId },
        )
      : await supabase.from("salary_rate_config").insert({
          ...payload,
          tenant_id: scopedTenantId,
          business_unit_id: stampBusinessUnit.ok
            ? stampBusinessUnit.businessUnitId
            : null,
        });

    if (saveError) {
      setError(saveError.message);
      setLoading(false);
      return;
    }

    closeForm();
    await refreshRates();
    setLoading(false);
  }

  const positionOptions = [...new Set(positions.filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-600">
          Configure basic salary rates by position, employment type, and shift
          (Morning, Afternoon, Full Day, Night, Rotating).
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
                <select
                  required
                  value={form.position}
                  onChange={(e) => updateField("position", e.target.value)}
                  className={inputClassName}
                >
                  <option value="">Select position</option>
                  {form.position &&
                  !positionOptions.includes(form.position) ? (
                    <option value={form.position}>{form.position}</option>
                  ) : null}
                  {positionOptions.map((position) => (
                    <option key={position} value={position}>
                      {position}
                    </option>
                  ))}
                </select>
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
              <th className={scrollableTableHeadingClassName("Position")}>
                Position
              </th>
              <th className={scrollableTableHeadingClassName("Employment Type")}>
                Employment Type
              </th>
              <th className={scrollableTableHeadingClassName("Shift")}>
                Shift
              </th>
              <th className={scrollableTableHeadingClassName("Basic Salary")}>
                Basic Salary
              </th>
              <th className={scrollableTableRegisterDateCellClassName}>
                Effective Date
              </th>
              <th className={scrollableTableHeadingClassName("Actions")}>
                Actions
              </th>
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
                  <td className={scrollableTableBodyCellClassNameForHeading("Position")}>
                    {rate.position}
                  </td>
                  <td
                    className={scrollableTableBodyCellClassNameForHeading(
                      "Employment Type",
                    )}
                  >
                    {rate.employment_type}
                  </td>
                  <td className={scrollableTableBodyCellClassNameForHeading("Shift")}>
                    {rate.shift}
                  </td>
                  <td
                    className={scrollableTableBodyCellClassNameForHeading(
                      "Basic Salary",
                    )}
                  >
                    {formatGHS(rate.basic_salary)}
                  </td>
                  <td className={scrollableTableRegisterDateCellClassName}>
                    {formatDate(rate.effective_date)}
                  </td>
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
