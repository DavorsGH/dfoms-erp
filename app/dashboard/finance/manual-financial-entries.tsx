"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import RegisterRowActions, {
  confirmDeleteEntry,
  getStripedRowClassName,
} from "./register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import FilteredListCount from "../filtered-list-count";
import {
  MANUAL_ENTRY_FIELD_DESCRIPTIONS,
  MANUAL_ENTRY_FIELD_SECTIONS,
  MANUAL_ENTRY_LIST_COLUMNS,
  MANUAL_ENTRY_PAIRING_NOTE,
  MANUAL_ENTRY_SECTION_STYLES,
  buildPeriodMonth,
  emptyManualEntryForm,
  entryToForm,
  findEntryByPeriodMonth,
  formatGHS,
  formatPeriodMonthLabel,
  formToPayload,
  getDefaultPeriodSelection,
  getPeriodMonthParts,
  normalizePeriodMonth,
  type ManualEntryFormFieldKey,
  type ManualFinancialEntryRecord,
} from "./manual-financial-entries-utils";
import { requestTenantAdminDirectorNotification } from "@/utils/request-tenant-admin-director-notification";

import DirectorsLoanRepaymentsPanel, {
  type DirectorsLoanRepaymentRecord,
} from "./directors-loan-repayments-panel";
import type { AccountsPayablePaymentRow } from "./directors-loan-utils";
import type { CashMovementManualEntry } from "./cash-movement-utils";

type ManualFinancialEntriesProps = {
  tenantId: string;
  initialEntries: ManualFinancialEntryRecord[];
  initialManualCashEntries: CashMovementManualEntry[];
  initialApPayments: AccountsPayablePaymentRow[];
  initialDirectorsLoanRepayments: DirectorsLoanRepaymentRecord[];
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

export default function ManualFinancialEntries({
  tenantId,
  initialEntries,
  initialManualCashEntries,
  initialApPayments,
  initialDirectorsLoanRepayments,
  fetchError,
}: ManualFinancialEntriesProps) {
  const router = useRouter();
  const supabase = createClient();
  const defaultPeriod = getDefaultPeriodSelection();

  const [entries, setEntries] = useState(initialEntries);
  const [showForm, setShowForm] = useState(false);
  const [editingPeriodMonth, setEditingPeriodMonth] = useState<string | null>(
    null,
  );
  const [deletingPeriodMonth, setDeletingPeriodMonth] = useState<string | null>(
    null,
  );
  const [form, setForm] = useState(emptyManualEntryForm);
  const [selectedYear, setSelectedYear] = useState(String(defaultPeriod.year));
  const [selectedMonth, setSelectedMonth] = useState(String(defaultPeriod.month));
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(fetchError);
  const [infoMessage, setInfoMessage] = useState<string | null>(null);

  const availableYears = useMemo(() => {
    const years = new Set<number>([
      defaultPeriod.year,
      ...entries.map((entry) => getPeriodMonthParts(entry.period_month)?.year ?? 0),
    ]);

    return Array.from(years)
      .filter((year) => year > 0)
      .sort((left, right) => right - left);
  }, [defaultPeriod.year, entries]);

  useEffect(() => {
    setEntries(initialEntries);
  }, [initialEntries]);

  useEffect(() => {
    if (!showForm) {
      return;
    }

    const periodMonth = buildPeriodMonth(
      Number(selectedYear),
      Number(selectedMonth),
    );
    const existing = findEntryByPeriodMonth(entries, periodMonth);

    if (
      existing &&
      normalizePeriodMonth(existing.period_month) !== editingPeriodMonth
    ) {
      setEditingPeriodMonth(normalizePeriodMonth(existing.period_month));
      setForm(entryToForm(existing));
      setInfoMessage(
        `An entry already exists for ${formatPeriodMonthLabel(periodMonth)}. Opened in edit mode.`,
      );
      return;
    }

    if (!existing && editingPeriodMonth) {
      setEditingPeriodMonth(null);
      setForm(emptyManualEntryForm);
    }

    if (!existing) {
      setInfoMessage(null);
    }
  }, [showForm, selectedYear, selectedMonth, entries, editingPeriodMonth]);

  async function refreshEntries() {
    const { data, error: refreshError } = await supabase
      .from("manual_financial_entries")
      .select("*")
      .order("period_month", { ascending: false });

    if (refreshError) {
      setError(refreshError.message);
      return;
    }

    setEntries((data as ManualFinancialEntryRecord[] | null) ?? []);
    setError(null);
  }

  function openAddForm() {
    const period = getDefaultPeriodSelection();
    const periodMonth = buildPeriodMonth(period.year, period.month);
    const existing = findEntryByPeriodMonth(entries, periodMonth);

    if (existing) {
      openEditForm(existing);
      setInfoMessage(
        `An entry already exists for ${formatPeriodMonthLabel(periodMonth)}. Opened in edit mode.`,
      );
      return;
    }

    setEditingPeriodMonth(null);
    setForm(emptyManualEntryForm);
    setSelectedYear(String(period.year));
    setSelectedMonth(String(period.month));
    setInfoMessage(null);
    setShowForm(true);
  }

  function closeForm() {
    setEditingPeriodMonth(null);
    setForm(emptyManualEntryForm);
    setInfoMessage(null);
    setShowForm(false);
  }

  function openEditForm(entry: ManualFinancialEntryRecord) {
    const parts = getPeriodMonthParts(entry.period_month);
    setEditingPeriodMonth(normalizePeriodMonth(entry.period_month));
    setForm(entryToForm(entry));
    setSelectedYear(String(parts?.year ?? defaultPeriod.year));
    setSelectedMonth(String(parts?.month ?? defaultPeriod.month));
    setInfoMessage(null);
    setShowForm(true);
  }

  async function handleDelete(periodMonth: string, tenantId?: string) {
    if (!confirmDeleteEntry()) {
      return;
    }

    const normalized = normalizePeriodMonth(periodMonth);
    setDeletingPeriodMonth(normalized);
    setError(null);

    let query = supabase
      .from("manual_financial_entries")
      .delete()
      .eq("period_month", normalized);
    if (tenantId) {
      query = query.eq("tenant_id", tenantId);
    }

    const { error: deleteError } = await query;

    if (deleteError) {
      setError(deleteError.message);
      setDeletingPeriodMonth(null);
      return;
    }

    if (editingPeriodMonth === normalized) {
      closeForm();
    }

    await refreshEntries();
    setDeletingPeriodMonth(null);
    router.refresh();
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setInfoMessage(null);

    const periodMonth = buildPeriodMonth(
      Number(selectedYear),
      Number(selectedMonth),
    );
    const existing = findEntryByPeriodMonth(entries, periodMonth);
    const updateKey =
      editingPeriodMonth ??
      (existing ? normalizePeriodMonth(existing.period_month) : null);
    const updateTenantId =
      (updateKey &&
        entries.find(
          (entry) =>
            normalizePeriodMonth(entry.period_month) === updateKey,
        )?.tenant_id) ||
      existing?.tenant_id;
    const payload = formToPayload(form, periodMonth);

    let saveError;
    if (updateKey) {
      let updateQuery = supabase
        .from("manual_financial_entries")
        .update(payload)
        .eq("period_month", updateKey);
      if (updateTenantId) {
        updateQuery = updateQuery.eq("tenant_id", updateTenantId);
      }
      ({ error: saveError } = await updateQuery);
    } else {
      ({ error: saveError } = await supabase
        .from("manual_financial_entries")
        .insert(payload));

      if (!saveError) {
        requestTenantAdminDirectorNotification({
          title: "Director's loan entry recorded",
          detail: formatGHS(Number(form.directors_loan) || 0),
          actionUrl: "/dashboard/finance/manual-financial-entries",
        });
      }
    }

    if (saveError) {
      if (
        saveError.message.includes("duplicate key") ||
        saveError.message.includes("manual_financial_entries_period_month")
      ) {
        const duplicate = findEntryByPeriodMonth(entries, periodMonth);
        if (duplicate) {
          openEditForm(duplicate);
          setError(
            `An entry already exists for ${formatPeriodMonthLabel(periodMonth)}. Switched to edit mode.`,
          );
        } else {
          setError(saveError.message);
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

  function updateField(key: ManualEntryFormFieldKey, value: string) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  const listColumnCount = MANUAL_ENTRY_LIST_COLUMNS.length + 2;

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="max-w-3xl space-y-2 text-sm text-slate-600">
          <p>
            Enter monthly liability balances and cash-flow adjustments that are
            not calculated from other registers. One row per calendar month.
          </p>
          <p>
            Share Capital is managed under{" "}
            <span className="font-medium text-[#0f2744]">
              Balance Sheet → Capital Contributions
            </span>{" "}
            and is excluded here to keep a single source of truth.
          </p>
        </div>
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

      {infoMessage && (
        <p className="rounded-md border border-sky-200 bg-sky-50 px-4 py-3 text-sm text-sky-900">
          {infoMessage}
        </p>
      )}

      {showForm && (
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-[#0f2744]">
            {editingPeriodMonth ? "Edit Manual Entry" : "New Manual Entry"}
          </h2>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="grid gap-4 md:grid-cols-2">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Month
                </label>
                <select
                  required
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
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Year
                </label>
                <select
                  required
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
            </div>

            <p className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
              <span className="font-medium text-[#0f2744]">Pairing rule:</span>{" "}
              {MANUAL_ENTRY_PAIRING_NOTE}
            </p>

            {MANUAL_ENTRY_FIELD_SECTIONS.map((section) => {
              const styles = MANUAL_ENTRY_SECTION_STYLES[section.variant];

              return (
                <div
                  key={section.title}
                  className={`space-y-4 ${styles.sectionClassName}`}
                >
                  <div className="space-y-1">
                    <h3
                      className={`text-sm font-semibold uppercase tracking-wide ${styles.headerClassName}`}
                    >
                      {section.title}
                    </h3>
                    <p className="text-xs text-slate-600">{styles.groupLabel}</p>
                  </div>
                  <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                    {section.fields.map((field) => (
                      <div key={field.key} className={styles.fieldClassName}>
                        <label className="mb-1 block text-sm font-medium text-slate-800">
                          {field.label}
                        </label>
                        <p className="mb-2 text-xs text-slate-600">
                          {MANUAL_ENTRY_FIELD_DESCRIPTIONS[field.key]}
                        </p>
                        <input
                          type="number"
                          step="0.01"
                          value={form[field.key]}
                          onChange={(event) =>
                            updateField(field.key, event.target.value)
                          }
                          aria-label={field.label}
                          className={`${inputClassName} ${styles.inputClassName}`}
                        />
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={loading}
                className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading
                  ? "Saving…"
                  : editingPeriodMonth
                    ? "Save Changes"
                    : "Save Entry"}
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
        filteredCount={entries.length}
        totalCount={entries.length}
        itemSingular="entry"
      />

      <ScrollableTable>
        <table className={scrollableTableClassName}>
          <thead className={scrollableTableHeadClassName}>
            <tr>
              <th className={scrollableTableThClassName}>Period</th>
              {MANUAL_ENTRY_LIST_COLUMNS.map((column) => (
                <th
                  key={column.key}
                  className={scrollableTableThClassName}
                  title={MANUAL_ENTRY_FIELD_DESCRIPTIONS[column.key]}
                >
                  {column.label}
                </th>
              ))}
              <th className={scrollableTableThClassName}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {entries.length === 0 ? (
              <tr>
                <td
                  colSpan={listColumnCount}
                  className="px-4 py-8 text-center text-slate-500"
                >
                  No manual financial entries yet.
                </td>
              </tr>
            ) : (
              entries.map((entry, index) => {
                const rowKey = normalizePeriodMonth(entry.period_month);
                return (
                  <tr key={rowKey} className={getStripedRowClassName(index)}>
                    <td className="px-4 py-3 font-medium text-[#0f2744]">
                      {formatPeriodMonthLabel(entry.period_month)}
                    </td>
                    {MANUAL_ENTRY_LIST_COLUMNS.map((column) => (
                      <td key={column.key} className="px-4 py-3">
                        {formatGHS(entry[column.key] ?? 0)}
                      </td>
                    ))}
                    <RegisterRowActions
                      onEdit={() => openEditForm(entry)}
                      onDelete={() =>
                        handleDelete(entry.period_month, entry.tenant_id)
                      }
                      deleting={deletingPeriodMonth === rowKey}
                    />
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </ScrollableTable>

      <DirectorsLoanRepaymentsPanel
        tenantId={tenantId}
        manualEntries={initialManualCashEntries}
        apPayments={initialApPayments}
        initialRepayments={initialDirectorsLoanRepayments}
      />
    </div>
  );
}
