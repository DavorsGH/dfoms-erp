"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAlert, useToast } from "@/components/feedback";
import { createClient } from "@/utils/supabase/client";
import {
  useStampBusinessUnitId,
  useBusinessUnitReadScope,
} from "@/app/dashboard/business-unit-view-context";
import { applyBusinessUnitScope } from "@/utils/business-unit-view";
import {
  assertCanModifyBusinessUnitRow,
  formatBusinessUnitAccessError,
  loadWriteBusinessUnitContext,
  resolveWriteBusinessUnitIdForCreate,
} from "@/utils/business-unit-access";
import type { ContractProjectOption } from "../administration/projects-utils";
import type { NamedLookup } from "../lookup-types";
import {
  lookupOptionLabel,
  namedLookupSelectOptionsForCreate,
} from "../administration/lookup-settings-shared";
import {
  expenseSubcategoryOptionsForCategory,
  type ExpenseSubcategoryLookup,
} from "./expense-register-utils";
import FilteredListCount from "../filtered-list-count";
import ScrollableTable, {
  scrollableTableActionsTdClassName,
  scrollableTableActionsThClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
  scrollableTableWrapCellClassName,
  scrollableTableWrapThClassName,
} from "../scrollable-table";

const budgetTableBodyCellClassName = "px-4 py-3 align-middle text-sm text-slate-700";
const budgetTableWrapTdClassName = `max-w-md whitespace-normal break-words align-middle ${scrollableTableWrapCellClassName} ${budgetTableBodyCellClassName}`;
import RegisterRowActions, {
  confirmDeleteEntry,
  getStripedRowClassName,
} from "./register-row-actions";
import {
  budgetEntriesForList,
  buildPeriodMonth,
  COMPANY_WIDE_PROJECT_VALUE,
  defaultBudgetCopySourceMonth,
  emptyBudgetForm,
  entryToBudgetForm,
  findDuplicateBudget,
  formatBudgetCategoryLabel,
  formatBudgetPeriodLabel,
  monthlyBudgetLinesForPeriod,
  formatBudgetProjectLabel,
  formatDuplicateBudgetMessage,
  formatGHS,
  formatPeriodMonthLabel,
  getPeriodMonthParts,
  isBudgetDuplicateError,
  isSameCalendarMonth,
  normalizePeriodMonth,
  normalizeBudgetRecord,
  planMonthlyBudgetCopy,
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
  expenseCategories: Array<NamedLookup & { is_active?: boolean }>;
  expenseSubcategories: ExpenseSubcategoryLookup[];
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
  const { alertError } = useAlert();
  const { toast } = useToast();
  const stampBusinessUnit = useStampBusinessUnitId();
  const buReadScope = useBusinessUnitReadScope();
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
  const [copyDialogOpen, setCopyDialogOpen] = useState(false);
  const [copySourceYear, setCopySourceYear] = useState(String(defaultPeriod.year));
  const [copySourceMonth, setCopySourceMonth] = useState(String(defaultPeriod.month));
  const [copyTargetYear, setCopyTargetYear] = useState(String(defaultPeriod.year));
  const [copyTargetMonth, setCopyTargetMonth] = useState(String(defaultPeriod.month));
  const [copySelectedLineIds, setCopySelectedLineIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [copyingBudget, setCopyingBudget] = useState(false);
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

  const categorySelectOptions = useMemo(
    () =>
      namedLookupSelectOptionsForCreate(
        expenseCategories,
        Boolean(editingId),
        form.category,
      ),
    [expenseCategories, editingId, form.category],
  );

  const subcategoryOptionsForCategory = useMemo(() => {
    const current =
      form.subcategory.trim() === WHOLE_CATEGORY_SUBCATEGORY_VALUE
        ? ""
        : form.subcategory.trim();
    return expenseSubcategoryOptionsForCategory(
      form.category,
      expenseSubcategories,
      current,
      expenseCategories,
    ).map((row) => row.name);
  }, [expenseCategories, expenseSubcategories, form.category, form.subcategory]);

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

  async function fetchBudgetEntriesFromDb(): Promise<BudgetRecord[] | null> {
    const { data, error: refreshError } = await applyBusinessUnitScope(
      supabase.from("budgets").select("*").eq("tenant_id", tenantId),
      buReadScope,
    )
      .order("period_month", { ascending: false })
      .order("category", { ascending: true });

    if (refreshError) {
      setError(refreshError.message);
      return null;
    }

    return (data as BudgetRecord[] | null)?.map(normalizeBudgetRecord) ?? [];
  }

  async function refreshEntries() {
    const next = await fetchBudgetEntriesFromDb();
    if (next) {
      setEntries(next);
      setError(null);
    }
  }

  function closeForm() {
    setLoading(false);
    setEditingId(null);
    setForm(emptyBudgetForm());
    setInfoMessage(null);
    setShowForm(false);
  }

  function openAddForm() {
    setLoading(false);
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
    setLoading(false);
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

  const viewedMonthYear = useMemo(
    () => ({
      year: Number(selectedYear),
      month: Number(selectedMonth),
    }),
    [selectedYear, selectedMonth],
  );

  const monthlyLinesForViewedMonth = useMemo(
    () =>
      Number.isFinite(viewedMonthYear.year) && Number.isFinite(viewedMonthYear.month)
        ? monthlyBudgetLinesForPeriod(
            entries,
            viewedMonthYear.year,
            viewedMonthYear.month,
          )
        : [],
    [entries, viewedMonthYear.month, viewedMonthYear.year],
  );

  const previousMonthForViewed = useMemo(() => {
    if (
      !Number.isFinite(viewedMonthYear.year) ||
      !Number.isFinite(viewedMonthYear.month)
    ) {
      return null;
    }
    return defaultBudgetCopySourceMonth(
      viewedMonthYear.year,
      viewedMonthYear.month,
    );
  }, [viewedMonthYear.month, viewedMonthYear.year]);

  const showEmptyMonthPrompt =
    listPeriodTypeFilter !== "annual" &&
    monthlyLinesForViewedMonth.length === 0 &&
    (listPeriodTypeFilter === "monthly" || visibleEntries.length === 0);

  const emptyMonthLabel = useMemo(() => {
    if (
      !Number.isFinite(viewedMonthYear.year) ||
      !Number.isFinite(viewedMonthYear.month)
    ) {
      return "this month";
    }
    return formatPeriodMonthLabel(
      buildPeriodMonth(viewedMonthYear.year, viewedMonthYear.month),
    );
  }, [viewedMonthYear.month, viewedMonthYear.year]);

  const copyTarget = useMemo(
    () => ({
      year: Number(copyTargetYear),
      month: Number(copyTargetMonth),
    }),
    [copyTargetYear, copyTargetMonth],
  );

  const copySource = useMemo(
    () => ({
      year: Number(copySourceYear),
      month: Number(copySourceMonth),
    }),
    [copySourceYear, copySourceMonth],
  );

  const copyPlanPreview = useMemo(() => {
    if (
      !Number.isFinite(copyTarget.year) ||
      !Number.isFinite(copyTarget.month) ||
      !Number.isFinite(copySource.year) ||
      !Number.isFinite(copySource.month)
    ) {
      return {
        sourceLines: [] as BudgetRecord[],
        toCopyCount: 0,
        skippedCount: 0,
      };
    }

    return planMonthlyBudgetCopy(entries, copySource, copyTarget);
  }, [entries, copySource, copyTarget]);

  const copyTargetPeriodMonth = useMemo(() => {
    if (
      !Number.isFinite(copyTarget.year) ||
      !Number.isFinite(copyTarget.month)
    ) {
      return "";
    }
    return buildPeriodMonth(copyTarget.year, copyTarget.month);
  }, [copyTarget.month, copyTarget.year]);

  const copyTargetMonthLabel = useMemo(
    () =>
      copyTargetPeriodMonth
        ? formatPeriodMonthLabel(copyTargetPeriodMonth)
        : "target month",
    [copyTargetPeriodMonth],
  );

  const copyPreviewRows = useMemo(() => {
    if (!copyTargetPeriodMonth) {
      return [];
    }
    return copyPlanPreview.sourceLines.map((line) => ({
      line,
      alreadyInTarget: Boolean(
        findDuplicateBudget(entries, {
          project_id: line.project_id,
          category: line.category,
          subcategory: line.subcategory,
          period_month: copyTargetPeriodMonth,
          period_type: "monthly",
        }),
      ),
    }));
  }, [copyPlanPreview.sourceLines, copyTargetPeriodMonth, entries]);

  const copySelectionSummary = useMemo(() => {
    let selectedCount = 0;
    let totalGhs = 0;
    for (const row of copyPreviewRows) {
      if (row.alreadyInTarget || !copySelectedLineIds.has(row.line.id)) {
        continue;
      }
      selectedCount += 1;
      totalGhs += Number(row.line.budgeted_amount) || 0;
    }
    return {
      selectedCount,
      totalGhs,
      skippedCount: copyPlanPreview.skippedCount,
    };
  }, [
    copyPlanPreview.skippedCount,
    copyPreviewRows,
    copySelectedLineIds,
  ]);

  const copySourceSameAsTarget = useMemo(
    () =>
      Number.isFinite(copyTarget.year) &&
      Number.isFinite(copyTarget.month) &&
      isSameCalendarMonth(copySource, copyTarget),
    [copySource, copyTarget],
  );

  const copyDialogPeriodKey = `${copySourceYear}-${copySourceMonth}-${copyTargetYear}-${copyTargetMonth}`;

  useEffect(() => {
    if (!copyDialogOpen) {
      return;
    }
    const targetYear = Number(copyTargetYear);
    const targetMonth = Number(copyTargetMonth);
    const sourceYear = Number(copySourceYear);
    const sourceMonth = Number(copySourceMonth);
    if (
      !Number.isFinite(targetYear) ||
      !Number.isFinite(targetMonth) ||
      !Number.isFinite(sourceYear) ||
      !Number.isFinite(sourceMonth)
    ) {
      setCopySelectedLineIds(new Set());
      return;
    }
    const targetPeriodMonth = buildPeriodMonth(targetYear, targetMonth);
    const sourceLines = monthlyBudgetLinesForPeriod(
      entries,
      sourceYear,
      sourceMonth,
    );
    const next = new Set<string>();
    for (const line of sourceLines) {
      const alreadyInTarget = findDuplicateBudget(entries, {
        project_id: line.project_id,
        category: line.category,
        subcategory: line.subcategory,
        period_month: targetPeriodMonth,
        period_type: "monthly",
      });
      if (!alreadyInTarget) {
        next.add(line.id);
      }
    }
    setCopySelectedLineIds(next);
  }, [copyDialogOpen, copyDialogPeriodKey, entries]);

  function applyDefaultCopySourceForTarget(targetYear: number, targetMonth: number) {
    const defaultSource = defaultBudgetCopySourceMonth(targetYear, targetMonth);
    setCopySourceYear(String(defaultSource.year));
    setCopySourceMonth(String(defaultSource.month));
  }

  function openCopyBudgetDialog(options?: {
    targetYear?: number;
    targetMonth?: number;
    sourceYear?: number;
    sourceMonth?: number;
  }) {
    const targetYear = options?.targetYear ?? Number(selectedYear);
    const targetMonth = options?.targetMonth ?? Number(selectedMonth);
    if (!Number.isFinite(targetYear) || !Number.isFinite(targetMonth)) {
      return;
    }

    setCopyTargetYear(String(targetYear));
    setCopyTargetMonth(String(targetMonth));

    if (
      options?.sourceYear !== undefined &&
      options?.sourceMonth !== undefined
    ) {
      setCopySourceYear(String(options.sourceYear));
      setCopySourceMonth(String(options.sourceMonth));
    } else {
      applyDefaultCopySourceForTarget(targetYear, targetMonth);
    }

    setCopyDialogOpen(true);
  }

  function updateCopyTargetMonth(month: string) {
    setCopyTargetMonth(month);
    const year = Number(copyTargetYear);
    const monthNumber = Number(month);
    if (Number.isFinite(year) && Number.isFinite(monthNumber)) {
      applyDefaultCopySourceForTarget(year, monthNumber);
    }
  }

  function updateCopyTargetYear(year: string) {
    setCopyTargetYear(year);
    const yearNumber = Number(year);
    const monthNumber = Number(copyTargetMonth);
    if (Number.isFinite(yearNumber) && Number.isFinite(monthNumber)) {
      applyDefaultCopySourceForTarget(yearNumber, monthNumber);
    }
  }

  function toggleCopyLineSelected(lineId: string, selected: boolean) {
    setCopySelectedLineIds((current) => {
      const next = new Set(current);
      if (selected) {
        next.add(lineId);
      } else {
        next.delete(lineId);
      }
      return next;
    });
  }

  function closeCopyFromMonthDialog() {
    if (copyingBudget) {
      return;
    }
    setCopyDialogOpen(false);
  }

  async function handleCopyFromMonth() {
    const targetYear = Number(copyTargetYear);
    const targetMonth = Number(copyTargetMonth);
    if (!Number.isFinite(targetYear) || !Number.isFinite(targetMonth)) {
      return;
    }

    const source = {
      year: Number(copySourceYear),
      month: Number(copySourceMonth),
    };
    if (!Number.isFinite(source.year) || !Number.isFinite(source.month)) {
      return;
    }

    if (isSameCalendarMonth(source, { year: targetYear, month: targetMonth })) {
      await alertError("Choose a different source month — the target month cannot copy from itself.");
      return;
    }

    if (copySelectionSummary.selectedCount === 0) {
      return;
    }

    setCopyingBudget(true);
    setError(null);

    try {
      let dbEntries = await fetchBudgetEntriesFromDb();
      if (!dbEntries) {
        return;
      }

      const plan = planMonthlyBudgetCopy(dbEntries, source, {
        year: targetYear,
        month: targetMonth,
      });

      if (plan.sourceLines.length === 0) {
        await alertError(
          `No monthly budget lines found for ${formatPeriodMonthLabel(buildPeriodMonth(source.year, source.month))}.`,
        );
        return;
      }

      const linesToCopy = plan.sourceLines.filter(
        (line) =>
          copySelectedLineIds.has(line.id) &&
          !findDuplicateBudget(dbEntries!, {
            project_id: line.project_id,
            category: line.category,
            subcategory: line.subcategory,
            period_month: buildPeriodMonth(targetYear, targetMonth),
            period_type: "monthly",
          }),
      );

      if (linesToCopy.length === 0) {
        return;
      }

      const buContext = await loadWriteBusinessUnitContext(supabase);
      if (!buContext.ok) {
        await alertError(buContext.error);
        return;
      }

      const targetPeriodMonth = buildPeriodMonth(targetYear, targetMonth);
      let copiedCount = 0;
      let skippedCount = plan.skippedCount;

      for (const line of linesToCopy) {
        try {
          assertCanModifyBusinessUnitRow(
            buContext.allowedUnits,
            line.business_unit_id,
          );
        } catch (accessError) {
          await alertError(formatBusinessUnitAccessError(accessError));
          return;
        }

        const duplicate = findDuplicateBudget(dbEntries, {
          project_id: line.project_id,
          category: line.category,
          subcategory: line.subcategory,
          period_month: targetPeriodMonth,
          period_type: "monthly",
        });
        if (duplicate) {
          skippedCount += 1;
          continue;
        }

        const { error: insertError } = await supabase.from("budgets").insert({
          tenant_id: tenantId,
          business_unit_id: line.business_unit_id ?? null,
          project_id: line.project_id,
          category: line.category,
          subcategory: line.subcategory,
          period_month: targetPeriodMonth,
          period_type: "monthly",
          budgeted_amount: line.budgeted_amount,
          notes: line.notes,
          updated_at: new Date().toISOString(),
        });

        if (insertError) {
          if (isBudgetDuplicateError(insertError.message)) {
            skippedCount += 1;
            continue;
          }
          await alertError(insertError.message);
          return;
        }

        copiedCount += 1;
        dbEntries = [
          ...dbEntries,
          {
            ...line,
            id: `pending-${copiedCount}`,
            period_month: targetPeriodMonth,
            period_type: "monthly" as const,
          },
        ];
      }

      await refreshEntries();
      router.refresh();
      setCopyDialogOpen(false);
      setSelectedYear(String(targetYear));
      setSelectedMonth(String(targetMonth));
      setListPeriodTypeFilter("monthly");
      toast(`Copied ${copiedCount} line(s), skipped ${skippedCount}.`);
    } catch (unexpected) {
      await alertError(
        unexpected instanceof Error
          ? unexpected.message
          : "Unable to copy budget lines.",
      );
    } finally {
      setCopyingBudget(false);
    }
  }

  async function handleDelete(entry: BudgetRecord) {
    if (!(await confirmDeleteEntry())) {
      return;
    }

    setDeletingId(entry.id);
    setError(null);

    const buContext = await loadWriteBusinessUnitContext(supabase);
    if (!buContext.ok) {
      setError(buContext.error);
      setDeletingId(null);
      return;
    }

    try {
      assertCanModifyBusinessUnitRow(
        buContext.allowedUnits,
        entry.business_unit_id,
      );
    } catch (accessError) {
      setError(formatBusinessUnitAccessError(accessError));
      setDeletingId(null);
      return;
    }

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

    try {
    const buContext = await loadWriteBusinessUnitContext(supabase);
    if (!buContext.ok) {
      setError(buContext.error);
      return;
    }

    let stampedBusinessUnitId: string | null = null;
    if (editingId) {
      const existing = entries.find((entry) => entry.id === editingId);
      try {
        assertCanModifyBusinessUnitRow(
          buContext.allowedUnits,
          existing?.business_unit_id,
        );
      } catch (accessError) {
        setError(formatBusinessUnitAccessError(accessError));
        return;
      }
    } else {
      const stampResult = resolveWriteBusinessUnitIdForCreate({
        allowedUnits: buContext.allowedUnits,
        stamp: stampBusinessUnit,
      });
      if (!stampResult.ok) {
        setError(stampResult.error);
        return;
      }
      stampedBusinessUnitId = stampResult.businessUnitId;
    }

    const periodType = form.period_type;
    const periodMonth = resolveBudgetFormPeriodMonth(form);
    if (!validateBeforeSave(periodMonth, periodType)) {
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
      ({ error: saveError } = await supabase.from("budgets").insert({
        ...payload,
        business_unit_id: stampedBusinessUnitId,
      }));
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

      return;
    }

    closeForm();
    await refreshEntries();
    router.refresh();
    } catch (unexpected) {
      setError(
        unexpected instanceof Error
          ? unexpected.message
          : "Unable to save the budget line.",
      );
    } finally {
      setLoading(false);
    }
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
          {listPeriodTypeFilter !== "annual" ? (
            <button
              type="button"
              onClick={() => openCopyBudgetDialog()}
              disabled={copyingBudget || loading}
              className={secondaryButtonClassName}
            >
              Copy budget…
            </button>
          ) : null}
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

      {copyDialogOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
          role="presentation"
          onClick={() => {
            if (!copyingBudget) {
              closeCopyFromMonthDialog();
            }
          }}
        >
          <div
            className="flex max-h-[92vh] w-full max-w-2xl flex-col rounded-t-xl bg-white shadow-xl sm:max-h-[min(90vh,720px)] sm:rounded-lg"
            role="dialog"
            aria-labelledby="budget-copy-dialog-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-6">
              <h3
                id="budget-copy-dialog-title"
                className="text-lg font-semibold text-[#0f2744]"
              >
                Copy budget
              </h3>
              <button
                type="button"
                onClick={closeCopyFromMonthDialog}
                disabled={copyingBudget}
                className={secondaryButtonClassName}
              >
                Cancel
              </button>
            </div>

            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-4 py-4 sm:px-6">
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    From
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={copySourceMonth}
                      onChange={(event) =>
                        setCopySourceMonth(event.target.value)
                      }
                      disabled={copyingBudget}
                      className={inputClassName}
                      aria-label="Source month"
                    >
                      {MONTH_OPTIONS.map((label, index) => (
                        <option key={label} value={String(index + 1)}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <select
                      value={copySourceYear}
                      onChange={(event) =>
                        setCopySourceYear(event.target.value)
                      }
                      disabled={copyingBudget}
                      className={inputClassName}
                      aria-label="Source year"
                    >
                      {availableYears.map((year) => (
                        <option key={year} value={String(year)}>
                          {year}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="space-y-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                    To
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    <select
                      value={copyTargetMonth}
                      onChange={(event) =>
                        updateCopyTargetMonth(event.target.value)
                      }
                      disabled={copyingBudget}
                      className={inputClassName}
                      aria-label="Target month"
                    >
                      {MONTH_OPTIONS.map((label, index) => (
                        <option key={label} value={String(index + 1)}>
                          {label}
                        </option>
                      ))}
                    </select>
                    <select
                      value={copyTargetYear}
                      onChange={(event) =>
                        updateCopyTargetYear(event.target.value)
                      }
                      disabled={copyingBudget}
                      className={inputClassName}
                      aria-label="Target year"
                    >
                      {availableYears.map((year) => (
                        <option key={year} value={String(year)}>
                          {year}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {copySourceSameAsTarget ? (
                <p className="text-sm text-amber-800">
                  From and To are the same month — choose a different source or
                  target.
                </p>
              ) : null}

              {copyPlanPreview.sourceLines.length === 0 &&
              !copySourceSameAsTarget ? (
                <p className="text-sm text-slate-600">
                  No monthly budget lines in the source month for this business
                  unit.
                </p>
              ) : null}

              {copyPreviewRows.length > 0 ? (
                <ul className="divide-y divide-slate-100 rounded-md border border-slate-200">
                  {copyPreviewRows.map(({ line, alreadyInTarget }) => {
                    const categoryLabel = formatBudgetCategoryLabel(
                      line.category,
                      line.subcategory,
                    );
                    const checked =
                      !alreadyInTarget && copySelectedLineIds.has(line.id);
                    return (
                      <li
                        key={line.id}
                        className={`flex gap-3 px-3 py-3 text-sm ${
                          alreadyInTarget
                            ? "bg-slate-50 text-slate-400"
                            : "text-slate-800"
                        }`}
                      >
                        <input
                          type="checkbox"
                          className="mt-1 shrink-0"
                          checked={checked}
                          disabled={alreadyInTarget || copyingBudget}
                          onChange={(event) =>
                            toggleCopyLineSelected(
                              line.id,
                              event.target.checked,
                            )
                          }
                          aria-label={`Copy ${categoryLabel}`}
                        />
                        <div className="min-w-0 flex-1 space-y-0.5">
                          <p className="font-medium">{categoryLabel}</p>
                          <p className="text-slate-600">
                            {formatBudgetProjectLabel(line.project_id, projects)}
                          </p>
                          {alreadyInTarget ? (
                            <p className="text-xs text-slate-500">
                              Already in {copyTargetMonthLabel}
                            </p>
                          ) : (
                            <p className="tabular-nums text-slate-700">
                              {formatGHS(line.budgeted_amount)}
                            </p>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : null}
            </div>

            <div className="shrink-0 space-y-3 border-t border-slate-200 bg-white px-4 py-3 sm:px-6">
              <p className="text-sm text-slate-700">
                Total to copy:{" "}
                <span className="font-medium tabular-nums">
                  {formatGHS(copySelectionSummary.totalGhs)}
                </span>{" "}
                ({copySelectionSummary.selectedCount}{" "}
                {copySelectionSummary.selectedCount === 1 ? "line" : "lines"}) ·{" "}
                {copySelectionSummary.skippedCount} skipped
              </p>
              <div className="flex flex-wrap justify-end gap-3">
                <button
                  type="button"
                  onClick={() => void handleCopyFromMonth()}
                  disabled={
                    copyingBudget ||
                    copySourceSameAsTarget ||
                    copySelectionSummary.selectedCount === 0
                  }
                  className={primaryButtonClassName}
                >
                  {copyingBudget
                    ? "Copying…"
                    : `Copy ${copySelectionSummary.selectedCount} line${copySelectionSummary.selectedCount === 1 ? "" : "s"}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : null}

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
                {categorySelectOptions.map((category) => (
                  <option key={category.name} value={category.name}>
                    {lookupOptionLabel(category.name, category.is_active)}
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

      <ScrollableTable stickyEdgeColumns={false} boundedHeight={false}>
        <table className="min-w-full text-left text-sm">
          <thead className={scrollableTableHeadClassName}>
            <tr>
              <th className={scrollableTableThClassName}>Period</th>
              <th className={scrollableTableThClassName}>Project / Contract</th>
              <th className={scrollableTableWrapThClassName}>Category</th>
              <th className={scrollableTableThClassName}>Budgeted</th>
              <th className={scrollableTableThClassName}>Notes</th>
              <th className={scrollableTableActionsThClassName}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {showEmptyMonthPrompt ? (
              <tr>
                <td colSpan={6} className="px-4 py-10">
                  <div className="mx-auto flex max-w-md flex-col items-center gap-4 text-center">
                    <p className="text-sm text-slate-600">
                      No budget lines for {emptyMonthLabel}.
                    </p>
                    <div className="flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-center">
                      {previousMonthForViewed ? (
                        <button
                          type="button"
                          onClick={() =>
                            openCopyBudgetDialog({
                              targetYear: viewedMonthYear.year,
                              targetMonth: viewedMonthYear.month,
                              sourceYear: previousMonthForViewed.year,
                              sourceMonth: previousMonthForViewed.month,
                            })
                          }
                          disabled={copyingBudget || loading}
                          className={secondaryButtonClassName}
                        >
                          Copy from{" "}
                          {formatPeriodMonthLabel(
                            buildPeriodMonth(
                              previousMonthForViewed.year,
                              previousMonthForViewed.month,
                            ),
                          )}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => openCopyBudgetDialog()}
                        disabled={copyingBudget || loading}
                        className={secondaryButtonClassName}
                      >
                        Choose another month
                      </button>
                      <button
                        type="button"
                        onClick={openAddForm}
                        className={primaryButtonClassName}
                      >
                        Add budget line
                      </button>
                    </div>
                  </div>
                </td>
              </tr>
            ) : visibleEntries.length === 0 ? (
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
                  <td className={budgetTableBodyCellClassName}>
                    {formatBudgetPeriodLabel(entry)}
                  </td>
                  <td className={budgetTableBodyCellClassName}>
                    {formatBudgetProjectLabel(entry.project_id, projects)}
                  </td>
                  <td
                    className={budgetTableWrapTdClassName}
                    title={formatBudgetCategoryLabel(
                      entry.category,
                      entry.subcategory,
                    )}
                  >
                    {formatBudgetCategoryLabel(entry.category, entry.subcategory)}
                  </td>
                  <td className={budgetTableBodyCellClassName}>
                    {formatGHS(entry.budgeted_amount)}
                  </td>
                  <td className={budgetTableBodyCellClassName}>
                    {entry.notes?.trim() || "—"}
                  </td>
                  <td className={scrollableTableActionsTdClassName}>
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
