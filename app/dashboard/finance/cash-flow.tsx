"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import { getDefaultSelectedYear } from "./finance-year-utils";
import FinancialYearSelector from "./financial-year-selector";
import { formatGHS } from "./income-register-utils";
import {
  FULL_YEAR_INDEX,
  MONTH_LABELS,
  buildCashFlowReport,
  buildPeriodMonth,
  emptyManualEntryForm,
  filterManualEntriesForYear,
  getManualEntryForMonth,
  type CashFlowExpenseEntry,
  type CashFlowIncomeEntry,
  type CashFlowRow,
  type ManualFinancialEntry,
} from "./cash-flow-utils";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";

type CashFlowProps = {
  initialIncomeEntries: CashFlowIncomeEntry[];
  initialExpenseEntries: CashFlowExpenseEntry[];
  initialManualEntries: ManualFinancialEntry[];
  availableYears: number[];
  canEditManualEntries: boolean;
  fetchError: string | null;
};

const fullYearHeaderClassName =
  "sticky top-0 z-10 bg-slate-200 px-4 py-3 font-semibold text-[#0f2744]";

const fullYearCellClassName =
  "bg-slate-100 px-4 py-3 font-semibold text-[#0f2744]";

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

function formatAmount(amount: number): string {
  return formatGHS(amount);
}

function getRowClassName(row: CashFlowRow, index: number): string {
  if (row.kind === "section") {
    return "bg-[#0f2744] text-sm font-semibold uppercase tracking-wide text-white";
  }

  if (
    row.kind === "subtotal" ||
    row.kind === "total" ||
    row.kind === "metric" ||
    row.kind === "balance"
  ) {
    return "bg-slate-50 text-sm font-semibold text-[#0f2744]";
  }

  return index % 2 === 1 ? "bg-slate-50 text-slate-700" : "text-slate-700";
}

function getFullYearAmount(row: CashFlowRow): number {
  return row.amounts[FULL_YEAR_INDEX] ?? 0;
}

export default function CashFlow({
  initialIncomeEntries,
  initialExpenseEntries,
  initialManualEntries,
  availableYears,
  canEditManualEntries,
  fetchError,
}: CashFlowProps) {
  const router = useRouter();
  const supabase = createClient();
  const [selectedYear, setSelectedYear] = useState(() =>
    getDefaultSelectedYear(availableYears),
  );
  const [manualEntries, setManualEntries] = useState(initialManualEntries);
  const [selectedMonth, setSelectedMonth] = useState("1");
  const [manualForm, setManualForm] = useState(emptyManualEntryForm);
  const [manualLoading, setManualLoading] = useState(false);
  const [manualError, setManualError] = useState<string | null>(null);
  const [manualSuccess, setManualSuccess] = useState<string | null>(null);

  const manualEntriesForYear = useMemo(
    () => filterManualEntriesForYear(manualEntries, selectedYear),
    [manualEntries, selectedYear],
  );

  const report = useMemo(
    () =>
      buildCashFlowReport(
        initialIncomeEntries,
        initialExpenseEntries,
        manualEntriesForYear,
        selectedYear,
      ),
    [
      initialIncomeEntries,
      initialExpenseEntries,
      manualEntriesForYear,
      selectedYear,
    ],
  );

  useEffect(() => {
    setManualEntries(initialManualEntries);
  }, [initialManualEntries]);

  useEffect(() => {
    const month = Number(selectedMonth);
    const existing = getManualEntryForMonth(
      manualEntriesForYear,
      selectedYear,
      month,
    );

    if (existing) {
      setManualForm({
        purchase_of_fixed_assets: String(existing.purchase_of_fixed_assets),
        loan_proceeds: String(existing.loan_proceeds),
        loan_repayments: String(existing.loan_repayments),
        opening_cash_balance: String(existing.opening_cash_balance),
        other_cash_inflows: String(existing.other_cash_inflows),
      });
      return;
    }

    setManualForm(emptyManualEntryForm);
  }, [selectedMonth, manualEntriesForYear, selectedYear]);

  function updateManualField(
    field: keyof typeof emptyManualEntryForm,
    value: string,
  ) {
    setManualForm((current) => ({ ...current, [field]: value }));
  }

  async function handleManualSave(e: React.FormEvent) {
    e.preventDefault();
    setManualLoading(true);
    setManualError(null);
    setManualSuccess(null);

    const month = Number(selectedMonth);
    const periodMonth = buildPeriodMonth(selectedYear, month);
    const payload = {
      period_month: periodMonth,
      purchase_of_fixed_assets:
        Number(manualForm.purchase_of_fixed_assets) || 0,
      loan_proceeds: Number(manualForm.loan_proceeds) || 0,
      loan_repayments: Number(manualForm.loan_repayments) || 0,
      opening_cash_balance: Number(manualForm.opening_cash_balance) || 0,
      other_cash_inflows: Number(manualForm.other_cash_inflows) || 0,
    };

    const existing = getManualEntryForMonth(
      manualEntriesForYear,
      selectedYear,
      month,
    );

    const { error: saveError } = existing?.id
      ? await supabase
          .from("manual_financial_entries")
          .update(payload)
          .eq("id", existing.id)
      : await supabase.from("manual_financial_entries").insert(payload);

    if (saveError) {
      setManualError(saveError.message);
      setManualLoading(false);
      return;
    }

    const { data, error: refreshError } = await supabase
      .from("manual_financial_entries")
      .select("*")
      .order("period_month", { ascending: true });

    if (refreshError) {
      setManualError(refreshError.message);
      setManualLoading(false);
      return;
    }

    setManualEntries((data as ManualFinancialEntry[] | null) ?? []);
    setManualSuccess(
      `Saved manual entries for ${MONTH_LABELS[month - 1]} ${selectedYear}.`,
    );
    setManualLoading(false);
    router.refresh();
  }

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <p className="text-sm text-slate-600">
          Monthly cash flow for financial year {report.financialYear}, calculated
          live from receipts, paid expenses, and manual entries.
        </p>
        <FinancialYearSelector
          years={availableYears}
          selectedYear={selectedYear}
          onChange={setSelectedYear}
        />
      </div>

      {fetchError && (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {fetchError}
        </p>
      )}

      <ScrollableTable>
        <table className={scrollableTableClassName}>
          <thead className={scrollableTableHeadClassName}>
            <tr>
              <th className={scrollableTableThClassName}>Line Item</th>
              {MONTH_LABELS.map((month) => (
                <th key={month} className={scrollableTableThClassName}>
                  {month} {report.financialYear}
                </th>
              ))}
              <th className={fullYearHeaderClassName}>Full Year</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {report.rows.map((row, index) => (
              <tr key={row.key} className={getRowClassName(row, index)}>
                <td
                  className={`px-4 py-3 ${
                    row.kind === "section"
                      ? "font-semibold uppercase"
                      : row.kind === "subtotal" ||
                          row.kind === "total" ||
                          row.kind === "metric" ||
                          row.kind === "balance"
                        ? "font-semibold"
                        : ""
                  }`}
                >
                  {row.label}
                </td>
                {row.kind === "section" ? (
                  <>
                    {MONTH_LABELS.map((month) => (
                      <td key={month} className="px-4 py-3" />
                    ))}
                    <td className={fullYearCellClassName} />
                  </>
                ) : (
                  <>
                    {row.amounts
                      .slice(0, FULL_YEAR_INDEX)
                      .map((amount, monthIndex) => (
                        <td key={monthIndex} className="px-4 py-3">
                          {formatAmount(amount)}
                        </td>
                      ))}
                    <td className={fullYearCellClassName}>
                      {formatAmount(getFullYearAmount(row))}
                    </td>
                  </>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </ScrollableTable>

      {canEditManualEntries && (
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-lg font-semibold text-[#0f2744]">
            Manual Entries
          </h3>
          <p className="mb-4 text-sm text-slate-600">
            Enter investing, financing, opening balance, and other inflow
            figures for each month. Values save to the manual financial entries
            register and update the cash flow statement immediately.
          </p>

          {manualError && (
            <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              {manualError}
            </p>
          )}

          {manualSuccess && (
            <p className="mb-4 rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-700">
              {manualSuccess}
            </p>
          )}

          <form
            onSubmit={handleManualSave}
            className="grid gap-4 md:grid-cols-2 xl:grid-cols-3"
          >
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Month
              </label>
              <select
                value={selectedMonth}
                onChange={(e) => setSelectedMonth(e.target.value)}
                className={inputClassName}
              >
                {MONTH_LABELS.map((label, index) => (
                  <option key={label} value={String(index + 1)}>
                    {label} {selectedYear}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Purchase of Fixed Assets
              </label>
              <input
                type="number"
                step="0.01"
                value={manualForm.purchase_of_fixed_assets}
                onChange={(e) =>
                  updateManualField("purchase_of_fixed_assets", e.target.value)
                }
                className={inputClassName}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Loan Proceeds
              </label>
              <input
                type="number"
                step="0.01"
                value={manualForm.loan_proceeds}
                onChange={(e) =>
                  updateManualField("loan_proceeds", e.target.value)
                }
                className={inputClassName}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Loan Repayments
              </label>
              <input
                type="number"
                step="0.01"
                value={manualForm.loan_repayments}
                onChange={(e) =>
                  updateManualField("loan_repayments", e.target.value)
                }
                className={inputClassName}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Opening Cash Balance
              </label>
              <input
                type="number"
                step="0.01"
                value={manualForm.opening_cash_balance}
                onChange={(e) =>
                  updateManualField("opening_cash_balance", e.target.value)
                }
                className={inputClassName}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Other Cash Inflows
              </label>
              <input
                type="number"
                step="0.01"
                value={manualForm.other_cash_inflows}
                onChange={(e) =>
                  updateManualField("other_cash_inflows", e.target.value)
                }
                className={inputClassName}
              />
            </div>
            <div className="md:col-span-2 xl:col-span-3">
              <button
                type="submit"
                disabled={manualLoading}
                className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {manualLoading ? "Saving…" : "Save Manual Entries"}
              </button>
            </div>
          </form>
        </section>
      )}
    </div>
  );
}
