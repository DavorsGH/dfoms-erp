"use client";

import { useAlert, useToast } from "@/components/feedback";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import {
  assertTenantIdForMutation,
  tenantScopedDelete,
  tenantScopedUpdate,
} from "@/utils/tenant-scoped-supabase";
import { applySalaryRateConfigReadScope } from "@/utils/business-unit-view";
import {
  mapSalaryRateConfigSaveError,
  SALARY_SETTINGS_GENERIC_SAVE_ERROR,
} from "@/lib/administration/salary-settings-save-errors";
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
import {
  RegisterColumnFilterHeader,
  collectDistinctColumnValues,
  columnValuePassesFilter,
  createRegisterDateSortState,
  registerColumnSortConfig,
  sortRegisterRows,
  type RegisterColumnFilterValue,
  type RegisterColumnSortState,
} from "../finance/register-column-filter";
import FilteredListCount, {
  anyRegisterColumnFiltersActive,
} from "../filtered-list-count";
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
  isFutureSalaryRateEffectiveDate,
  mergeSalaryRateIntoList,
  sortSalaryRates,
  type SalaryRateEntry,
} from "./salary-rates-utils";
import {
  useBusinessUnitReadScope,
  useStampBusinessUnitId,
} from "@/app/dashboard/business-unit-view-context";

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
}: SalaryRatesProps) {
  const supabase = createClient();
  const scopedTenantId = assertTenantIdForMutation(tenantId);
  const stampBusinessUnit = useStampBusinessUnitId();
  const buReadScope = useBusinessUnitReadScope();
  const router = useRouter();
  const { alertError } = useAlert();
  const { toast } = useToast();
  const submitGuardRef = useRef(false);
  const localRatesMutationRef = useRef(false);

  const [rates, setRates] = useState(() => sortSalaryRates(initialRates));
  const [positions, setPositions] = useState(initialPositions);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (fetchError) {
      void alertError(fetchError);
    }
  }, [alertError, fetchError]);

  const [positionFilter, setPositionFilter] =
    useState<RegisterColumnFilterValue>(null);
  const [employmentTypeFilter, setEmploymentTypeFilter] =
    useState<RegisterColumnFilterValue>(null);
  const [shiftFilter, setShiftFilter] =
    useState<RegisterColumnFilterValue>(null);
  const [columnSort, setColumnSort] = useState<RegisterColumnSortState | null>(
    () => createRegisterDateSortState("effective_date", "desc"),
  );

  useEffect(() => {
    if (localRatesMutationRef.current) {
      localRatesMutationRef.current = false;
      return;
    }
    setRates(sortSalaryRates(initialRates));
  }, [initialRates]);

  const buScopeKey =
    buReadScope.mode === "unit"
      ? `unit:${buReadScope.id}`
      : buReadScope.mode;

  useEffect(() => {
    void refreshRates();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch when BU switcher scope changes
  }, [buScopeKey]);

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
    const { data, error: refreshError } = await applySalaryRateConfigReadScope(
      supabase
        .from("salary_rate_config")
        .select("*")
        .eq("tenant_id", scopedTenantId),
      buReadScope,
    ).order("effective_date", { ascending: false });

    if (refreshError) {
      await alertError(refreshError);
      return;
    }

    setRates(sortSalaryRates((data as SalaryRateEntry[] | null) ?? []));
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

    const { error: deleteError } = await tenantScopedDelete(
      supabase,
      "salary_rate_config",
      scopedTenantId,
      { id },
    );

    if (deleteError) {
      setDeletingId(null);
      await alertError(deleteError);
      return;
    }

    if (editingId === id) {
      closeForm();
    }

    await refreshRates();
    setDeletingId(null);
    toast("Salary rate deleted.");
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (submitGuardRef.current) {
      return;
    }
    submitGuardRef.current = true;
    setLoading(true);

    try {
      if (!editingId && !stampBusinessUnit.ok) {
        await alertError(stampBusinessUnit.error);
        return;
      }

      const payload = {
        position: form.position,
        employment_type: form.employment_type,
        shift: form.shift,
        basic_salary: Number(form.basic_salary) || 0,
        effective_date: form.effective_date,
      };

      const saveResult = editingId
        ? await tenantScopedUpdate(
            supabase,
            "salary_rate_config",
            scopedTenantId,
            payload,
            { id: editingId },
          )
            .select("*")
            .single()
        : await supabase
            .from("salary_rate_config")
            .insert({
              ...payload,
              tenant_id: scopedTenantId,
              business_unit_id: stampBusinessUnit.ok
                ? stampBusinessUnit.businessUnitId
                : null,
            })
            .select("*")
            .single();

      const saveError = saveResult.error;
      const savedRow = saveResult.data as SalaryRateEntry | null;

      if (saveError) {
        const friendly = mapSalaryRateConfigSaveError(saveError, payload);
        if (friendly) {
          void alertError(friendly, { title: "Could not complete action" });
        } else {
          void alertError(SALARY_SETTINGS_GENERIC_SAVE_ERROR, {
            title: "Could not complete action",
          });
        }
        return;
      }

      if (savedRow) {
        localRatesMutationRef.current = true;
        setRates((current) => mergeSalaryRateIntoList(current, savedRow));
      }

      closeForm();
      await refreshRates();
      router.refresh();
      toast(editingId ? "Salary rate updated." : "Salary rate added.");
    } finally {
      submitGuardRef.current = false;
      setLoading(false);
    }
  }

  const positionOptions = [...new Set(positions.filter(Boolean))].sort((a, b) =>
    a.localeCompare(b),
  );

  const filteredRates = useMemo(() => {
    const filtered = rates.filter(
      (rate) =>
        columnValuePassesFilter(rate.position, positionFilter) &&
        columnValuePassesFilter(rate.employment_type, employmentTypeFilter) &&
        columnValuePassesFilter(rate.shift, shiftFilter),
    );
    return sortRegisterRows(
      filtered,
      columnSort,
      (row) => {
        if (columnSort?.columnId === "effective_date") {
          return row.effective_date;
        }
        if (columnSort?.columnId === "basic_salary") {
          return row.basic_salary;
        }
        if (columnSort?.columnId === "position") {
          return row.position;
        }
        if (columnSort?.columnId === "employment_type") {
          return row.employment_type;
        }
        if (columnSort?.columnId === "shift") {
          return row.shift;
        }
        return row.effective_date;
      },
      (left, right) => right.id.localeCompare(left.id),
    );
  }, [
    rates,
    positionFilter,
    employmentTypeFilter,
    shiftFilter,
    columnSort,
  ]);

  const hasActiveFilters = anyRegisterColumnFiltersActive(
    positionFilter,
    employmentTypeFilter,
    shiftFilter,
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
          disabled={loading}
          className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {showForm ? "Cancel" : "Add Rate"}
        </button>
      </div>

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
                  disabled={loading}
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
                  disabled={loading}
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
                  disabled={loading}
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
                  disabled={loading}
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
                  disabled={loading}
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

      <FilteredListCount
        filteredCount={filteredRates.length}
        totalCount={rates.length}
        itemSingular="rate"
        hasActiveFilters={hasActiveFilters}
      />

      <ScrollableTable>
        <table className={scrollableTableClassName}>
          <thead className={scrollableTableHeadClassName}>
            <tr>
              <th className={scrollableTableHeadingClassName("Position")}>
                <RegisterColumnFilterHeader
                  label="Position"
                  options={collectDistinctColumnValues(
                    rates.map((r) => r.position),
                  )}
                  applied={positionFilter}
                  onApply={setPositionFilter}
                  sort={registerColumnSortConfig(
                    "position",
                    "text",
                    columnSort,
                    setColumnSort,
                  )}
                />
              </th>
              <th
                className={scrollableTableHeadingClassName("Employment Type")}
              >
                <RegisterColumnFilterHeader
                  label="Employment Type"
                  options={collectDistinctColumnValues(
                    rates.map((r) => r.employment_type),
                  )}
                  applied={employmentTypeFilter}
                  onApply={setEmploymentTypeFilter}
                  sort={registerColumnSortConfig(
                    "employment_type",
                    "text",
                    columnSort,
                    setColumnSort,
                  )}
                />
              </th>
              <th className={scrollableTableHeadingClassName("Shift")}>
                <RegisterColumnFilterHeader
                  label="Shift"
                  options={collectDistinctColumnValues(rates.map((r) => r.shift))}
                  applied={shiftFilter}
                  onApply={setShiftFilter}
                  sort={registerColumnSortConfig(
                    "shift",
                    "text",
                    columnSort,
                    setColumnSort,
                  )}
                />
              </th>
              <th className={scrollableTableHeadingClassName("Basic Salary")}>
                <RegisterColumnFilterHeader
                  label="Basic Salary"
                  options={[]}
                  applied={null}
                  onApply={() => {}}
                  sort={registerColumnSortConfig(
                    "basic_salary",
                    "number",
                    columnSort,
                    setColumnSort,
                  )}
                />
              </th>
              <th className={scrollableTableRegisterDateCellClassName}>
                <RegisterColumnFilterHeader
                  label="Effective Date"
                  options={[]}
                  applied={null}
                  onApply={() => {}}
                  sort={registerColumnSortConfig(
                    "effective_date",
                    "date",
                    columnSort,
                    setColumnSort,
                  )}
                />
              </th>
              <th className={scrollableTableHeadingClassName("Actions")}>
                Actions
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {filteredRates.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-8 text-center text-slate-500"
                >
                  No salary rates configured yet.
                </td>
              </tr>
            ) : (
              filteredRates.map((rate, index) => {
                const future = isFutureSalaryRateEffectiveDate(rate.effective_date);
                return (
                  <tr key={rate.id} className={getStripedRowClassName(index)}>
                    <td
                      className={scrollableTableBodyCellClassNameForHeading(
                        "Position",
                      )}
                    >
                      {rate.position}
                    </td>
                    <td
                      className={scrollableTableBodyCellClassNameForHeading(
                        "Employment Type",
                      )}
                    >
                      {rate.employment_type}
                    </td>
                    <td
                      className={scrollableTableBodyCellClassNameForHeading(
                        "Shift",
                      )}
                    >
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
                      <span className="inline-flex flex-wrap items-center gap-2">
                        {formatDate(rate.effective_date)}
                        {future ? (
                          <span className="rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-900">
                            From {formatDate(rate.effective_date)}
                          </span>
                        ) : null}
                      </span>
                    </td>
                    <RegisterRowActions
                      onEdit={() => openEditForm(rate)}
                      onDelete={() => handleDelete(rate.id)}
                      deleting={deletingId === rate.id}
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
