"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import type { ContractProjectOption } from "../administration/projects-utils";
import type { NamedLookup } from "../lookup-types";
import FilteredListCount from "../filtered-list-count";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import RegisterRowActions, {
  confirmDeleteEntry,
  getStripedRowClassName,
} from "./register-row-actions";
import {
  budgetEntriesForList,
  buildPeriodMonth,
  COMPANY_WIDE_PROJECT_VALUE,
  emptyBudgetForm,
  entryToBudgetForm,
  findDuplicateBudget,
  formatBudgetCategoryLabel,
  formatBudgetPeriodLabel,
  formatBudgetProjectLabel,
  formatDuplicateBudgetMessage,
  formatGHS,
  formatPeriodMonthLabel,
  getPeriodMonthParts,
  isBudgetDuplicateError,
  normalizeBudgetRecord,
  resolveBudgetFormPeriodMonth,
  resolveBudgetProjectId,
  resolveBudgetSubcategory,
  WHOLE_CATEGORY_SUBCATEGORY_VALUE,
  type BudgetFormState,
  type BudgetListPeriodTypeFilter,
  type BudgetPeriodType,
  type BudgetRecord,
} from "./budget-utils";
import { getDefaultPeriodSelection } from "./manual-financial-entries-utils";

type BudgetProps = {
  tenantId: string;
  initialEntries: BudgetRecord[];
  expenseCategories: NamedLookup[];
  expenseSubcategories: NamedLookup[];
  projects: ContractProjectOption[];
  fetchError: string | null;
};

const MONTH_OPTIONS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButtonClassName =
  "rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

const periodTypeToggleClassName = (active: boolean) =>
  `rounded-md px-4 py-2 text-sm font-medium transition-colors ${
    active
      ? "bg-[#0f2744] text-white"
      : "bg-white text-slate-700 ring-1 ring-slate-200 hover:bg-slate-50"
  }`;

export default function Budget({
  tenantId,
  initialEntries,
  expenseCategories,
  expenseSubcategories,
  projects,
  fetchError,
}: BudgetProps) {
  const router = useRouter();
  const supabase = createClient();
  const defaultPeriod = getDefaultPeriodSelection();

  const [entries, setEntries] = useState(
    initialEntries.map(normalizeBudgetRecord),
  );
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [form, setForm] = useState<BudgetFormState>(emptyBudgetForm());
  const [selectedYear, setSelectedYear] = useState(String(defaultPeriod.year));
  const [selectedMonth, setSelectedMonth] = useState(String(defaultPeriod.month));
  const [listPeriodTypeFilter, setListPeriodTypeFilter] =
    useState<BudgetListPeriodTypeFilter>("all");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(fetchError);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  const availableYears = useMemo(() => {
    const years = new Set<number>([
      defaultPeriod.year,
      ...entries.map(
        (entry) => getPeriodMonthParts(entry.period_month)?.year ?? 0,
      ),
    ]);

    return Array.from(years)
      .filter((year) => year > 0)
      .sort((left, right) => right - left);
  }, [defaultPeriod.year, entries]);

  const visibleEntries = useMemo(
    () =>
      budgetEntriesForList(entries, {
        year: Number(selectedYear),
        month: Number(selectedMonth),
        periodTypeFilter: listPeriodTypeFilter,
      }),
    [entries, selectedYear, selectedMonth, listPeriodTypeFilter],
  );

  const subcategoryOptionsForCategory = useMemo(() => {
    const names = new Set(
      expenseSubcategories.map((entry) => entry.name.trim()).filter(Boolean),
    );
    const current = form.subcategory.trim();
    if (current && current !== WHOLE_CATEGORY_SUBCATEGORY_VALUE) {
      names.add(current);
    }

    return Array.from(names).sort((left, right) => left.localeCompare(right));
  }, [expenseSubcategories, form.subcategory]);

  const showSubcategoryField =
    form.category.trim() !== "" && subcategoryOptionsForCategory.length > 0;

  const listSummaryLabel = useMemo(() => {
    if (listPeriodTypeFilter === "annual") {
      return `${selectedYear} annual budgets`;
    }

    if (listPeriodTypeFilter === "monthly") {
      return formatPeriodMonthLabel(
        buildPeriodMonth(Number(selectedYear), Number(selectedMonth)),
      );
    }

    return `${formatPeriodMonthLabel(
      buildPeriodMonth(Number(selectedYear), Number(selectedMonth)),
    )} and ${selectedYear} annual budgets`;
  }, [listPeriodTypeFilter, selectedYear, selectedMonth]);

  useEffect(() => {
    setEntries(initialEntries.map(normalizeBudgetRecord));
  }, [initialEntries]);

  async function refreshEntries() {
    const { data, error: refreshError } = await supabase
      .from("budgets")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("period_month", { ascending: false })
      .order("category", { ascending: true });

    if (refreshError) {
      setError(refreshError.message);
      return;
    }

    setEntries((data as BudgetRecord[] | null)?.map(normalizeBudgetRecord) ?? []);
    setError(null);
  }

  function closeForm() {
    setEditingId(null);
    setForm(emptyBudgetForm());
    setInfoMessage(null);
    setShowForm(false);
  }

  function openAddForm() {
    setEditingId(null);
    setForm({
      ...emptyBudgetForm(),
      period_year: selectedYear,
      period_month: selectedMonth,
    });
    setInfoMessage(null);
    setShowForm(true);
  }

  function openEditForm(entry: BudgetRecord) {
    setEditingId(entry.id);
    setForm(entryToBudgetForm(entry));
    setInfoMessage(null);
    setShowForm(true);
  }

  function validateBeforeSave(
    periodMonth: string,
    periodType: BudgetPeriodType,
  ): boolean {
    const category = form.category.trim();
    if (!category) {
      setError("Category is required.");
      return false;
    }

    const budgetedAmount = Number(form.budgeted_amount);
    if (!Number.isFinite(budgetedAmount) || budgetedAmount < 0) {
      setError("Budgeted amount must be zero or greater.");
      return false;
    }

    const subcategory = showSubcategoryField
      ? resolveBudgetSubcategory(form.subcategory)
      : null;

    const duplicate = findDuplicateBudget(
      entries,
      {
        project_id: resolveBudgetProjectId(form.project_id),
        category,
        subcategory,
        period_month: periodMonth,
        period_type: periodType,
      },
      editingId,
    );

    if (duplicate) {
      setError(formatDuplicateBudgetMessage(duplicate, projects));
      return false;
    }

    return true;
  }

  async function handleDelete(entry: BudgetRecord) {
    if (!confirmDeleteEntry()) {
      return;
    }

    setDeletingId(entry.id);
    setError(null);

    const { error: deleteError } = await supabase
      .from("budgets")
      .delete()
      .eq("id", entry.id)
      .eq("tenant_id", tenantId);

    if (deleteError) {
      setError(deleteError.message);
      setDeletingId(null);
      return;
    }

    if (editingId === entry.id) {
      closeForm();
    }

    await refreshEntries();
    setDeletingId(null);
    router.refresh();
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setInfoMessage(null);

    const periodType = form.period_type;
    const periodMonth = resolveBudgetFormPeriodMonth(form);
    if (!validateBeforeSave(periodMonth, periodType)) {
      setLoading(false);
      return;
    }

    const payload = {
      tenant_id: tenantId,
      project_id: resolveBudgetProjectId(form.project_id),
      category: form.category.trim(),
      subcategory: showSubcategoryField
        ? resolveBudgetSubcategory(form.subcategory)
        : null,
      period_month: periodMonth,
      period_type: periodType,
      budgeted_amount: Number(form.budgeted_amount) || 0,
      notes: form.notes.trim() || null,
      updated_at: new Date().toISOString(),
    };

    let saveError;
    if (editingId) {
      ({ error: saveError } = await supabase
        .from("budgets")
        .update(payload)
        .eq("id", editingId)
        .eq("tenant_id", tenantId));
    } else {
      ({ error: saveError } = await supabase.from("budgets").insert(payload));
    }

    if (saveError) {
      if (isBudgetDuplicateError(saveError.message)) {
        const existing = findDuplicateBudget(entries, {
          project_id: payload.project_id,
          category: payload.category,
          subcategory: payload.subcategory,
          period_month: payload.period_month,
          period_type: payload.period_type,
        });
        if (existing) {
          openEditForm(existing);
          setError(formatDuplicateBudgetMessage(existing, projects));
        } else {
          setError(
            "A budget line already exists for this project, category, subcategory, period type, and period.",
          );
        }
      } else {
        setError(saveError.message);
      }

      setLoading(false);
      return;
    }

    closeForm();
    await refreshEntries();
    setLoading(false);
    router.refresh();
  }

  function updateField<K extends keyof BudgetFormState>(
    key: K,
    value: BudgetFormState[K],
  ) {
    setForm((current) => {
      if (key === "category") {
        return {
          ...current,
          category: value as BudgetFormState["category"],
          subcategory: WHOLE_CATEGORY_SUBCATEGORY_VALUE,
        };
      }

      return { ...current, [key]: value };
    });
  }

  function setFormPeriodType(periodType: BudgetPeriodType) {
    setForm((current) => ({ ...current, period_type: periodType }));
  }

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl space-y-2 text-sm text-slate-600">
          <p>
            Set monthly or annual budget lines by project or company-wide
            category. Monthly and annual budgets can coexist for the same
            project, category, and year.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <Link
            href={`/dashboard/reports/finance/budget-vs-actual?year=${encodeURIComponent(selectedYear)}&month=${encodeURIComponent(selectedMonth)}`}
            className={secondaryButtonClassName}
          >
            View budget vs actual
          </Link>
          <button
            type="button"
            onClick={openAddForm}
            className={primaryButtonClassName}
          >
            Add budget line
          </button>
        </div>
      </div>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {infoMessage ? (
        <p className="rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-800">
          {infoMessage}
        </p>
      ) : null}

      <div className="flex flex-wrap items-end gap-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Show
          </label>
          <select
            value={listPeriodTypeFilter}
            onChange={(event) =>
              setListPeriodTypeFilter(
                event.target.value as BudgetListPeriodTypeFilter,
              )
            }
            className={inputClassName}
          >
            <option value="all">Monthly and annual</option>
            <option value="monthly">Monthly only</option>
            <option value="annual">Annual only</option>
          </select>
        </div>
        {listPeriodTypeFilter !== "annual" ? (
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Month
            </label>
            <select
              value={selectedMonth}
              onChange={(event) => setSelectedMonth(event.target.value)}
              className={inputClassName}
            >
              {MONTH_OPTIONS.map((label, index) => (
                <option key={label} value={String(index + 1)}>
                  {label}
                </option>
              ))}
            </select>
          </div>
        ) : null}
        <div>
          <label className="mb-1 block text-sm font-medium text-slate-700">
            Year
          </label>
          <select
            value={selectedYear}
            onChange={(event) => setSelectedYear(event.target.value)}
            className={inputClassName}
          >
            {availableYears.map((year) => (
              <option key={year} value={String(year)}>
                {year}
              </option>
            ))}
          </select>
        </div>
        <p className="pb-2 text-sm text-slate-600">Showing {listSummaryLabel}</p>
      </div>

      {showForm ? (
        <form
          onSubmit={handleSubmit}
          className="space-y-4 rounded-lg border border-slate-200 bg-white p-4 sm:p-6"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h3 className="text-lg font-semibold text-[#0f2744]">
              {editingId ? "Edit budget line" : "Add budget line"}
            </h3>
            <button
              type="button"
              onClick={closeForm}
              className={secondaryButtonClassName}
            >
              Cancel
            </button>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <div className="md:col-span-2">
              <label className="mb-2 block text-sm font-medium text-slate-700">
                Period type
              </label>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setFormPeriodType("monthly")}
                  className={periodTypeToggleClassName(form.period_type === "monthly")}
                >
                  Monthly
                </button>
                <button
                  type="button"
                  onClick={() => setFormPeriodType("annual")}
                  className={periodTypeToggleClassName(form.period_type === "annual")}
                >
                  Annual
                </button>
              </div>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Project / Contract
              </label>
              <select
                value={form.project_id}
                onChange={(event) =>
                  updateField("project_id", event.target.value)
                }
                className={inputClassName}
              >
                <option value={COMPANY_WIDE_PROJECT_VALUE}>Company-wide</option>
                {projects.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.project_code} — {project.project_name}
                    {project.is_archived ? " (Inactive)" : ""}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Category
              </label>
              <select
                value={form.category}
                onChange={(event) => updateField("category", event.target.value)}
                required
                className={inputClassName}
              >
                <option value="">Select category…</option>
                {expenseCategories.map((category) => (
                  <option key={category.name} value={category.name}>
                    {category.name}
                  </option>
                ))}
              </select>
            </div>
            {showSubcategoryField ? (
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Subcategory
                </label>
                <select
                  value={form.subcategory}
                  onChange={(event) =>
                    updateField("subcategory", event.target.value)
                  }
                  className={inputClassName}
                >
                  <option value={WHOLE_CATEGORY_SUBCATEGORY_VALUE}>
                    Whole category
                  </option>
                  {subcategoryOptionsForCategory.map((name) => (
                    <option key={name} value={name}>
                      {name}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Budgeted amount (GHS)
              </label>
              <input
                type="number"
                min="0"
                step="0.01"
                value={form.budgeted_amount}
                onChange={(event) =>
                  updateField("budgeted_amount", event.target.value)
                }
                required
                className={inputClassName}
              />
            </div>
            {form.period_type === "monthly" ? (
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Month
                </label>
                <select
                  value={form.period_month}
                  onChange={(event) =>
                    updateField("period_month", event.target.value)
                  }
                  className={inputClassName}
                >
                  {MONTH_OPTIONS.map((label, index) => (
                    <option key={label} value={String(index + 1)}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
            ) : null}
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Year
              </label>
              <select
                value={form.period_year}
                onChange={(event) =>
                  updateField("period_year", event.target.value)
                }
                className={inputClassName}
              >
                {availableYears.map((year) => (
                  <option key={year} value={String(year)}>
                    {year}
                  </option>
                ))}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Period
              </label>
              <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                {formatBudgetPeriodLabel({
                  period_month: resolveBudgetFormPeriodMonth(form),
                  period_type: form.period_type,
                })}
              </p>
            </div>
            <div className="md:col-span-2">
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Notes (optional)
              </label>
              <textarea
                value={form.notes}
                onChange={(event) => updateField("notes", event.target.value)}
                rows={3}
                className={inputClassName}
              />
            </div>
          </div>

          <div className="flex justify-end">
            <button
              type="submit"
              disabled={loading}
              className={primaryButtonClassName}
            >
              {loading ? "Saving…" : editingId ? "Save changes" : "Add budget line"}
            </button>
          </div>
        </form>
      ) : null}

      <FilteredListCount
        filteredCount={visibleEntries.length}
        totalCount={entries.length}
        itemSingular="budget line"
        hasActiveFilters={visibleEntries.length !== entries.length}
      />

      <ScrollableTable>
        <table className={scrollableTableClassName}>
          <thead className={scrollableTableHeadClassName}>
            <tr>
              <th className={scrollableTableThClassName}>Period</th>
              <th className={scrollableTableThClassName}>Project / Contract</th>
              <th className={scrollableTableThClassName}>Category</th>
              <th className={scrollableTableThClassName}>Budgeted</th>
              <th className={scrollableTableThClassName}>Notes</th>
              <th className={scrollableTableThClassName}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {visibleEntries.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-8 text-center text-sm text-slate-500"
                >
                  No budget lines for {listSummaryLabel}.
                </td>
              </tr>
            ) : (
              visibleEntries.map((entry, index) => (
                <tr
                  key={entry.id}
                  className={`border-b border-slate-100 ${getStripedRowClassName(index)}`}
                >
                  <td className="px-4 py-3 text-sm text-slate-700">
                    {formatBudgetPeriodLabel(entry)}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700">
                    {formatBudgetProjectLabel(entry.project_id, projects)}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700">
                    {formatBudgetCategoryLabel(entry.category, entry.subcategory)}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700">
                    {formatGHS(entry.budgeted_amount)}
                  </td>
                  <td className="px-4 py-3 text-sm text-slate-700">
                    {entry.notes?.trim() || "—"}
                  </td>
                  <td className="px-4 py-3">
                    <RegisterRowActions
                      onEdit={() => openEditForm(entry)}
                      onDelete={() => void handleDelete(entry)}
                      deleting={deletingId === entry.id}
                    />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </ScrollableTable>
    </div>
  );
}
