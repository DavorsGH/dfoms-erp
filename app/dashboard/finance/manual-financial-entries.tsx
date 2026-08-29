"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import {
  MANUAL_FINANCIAL_ENTRIES_ON_CONFLICT,
  scopeToBusinessUnitId,
} from "@/utils/phase5e-key-structure";
import { useStampBusinessUnitId } from "@/app/dashboard/business-unit-view-context";
import RegisterRowActions, {
  getStripedRowClassName,
} from "./register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import FilteredListCount from "../filtered-list-count";
import {
  LIABILITY_STOCK_LABELS,
  MANUAL_ENTRY_FIELD_DESCRIPTIONS,
  MANUAL_ENTRY_LIST_COLUMNS,
  applyAddOtherCashInflows,
  applyLiabilityMoneyReceived,
  applyLiabilityMoneyRepaid,
  applyLiabilityNonCashAdjustment,
  applySetOpeningCashBalance,
  buildPeriodMonth,
  confirmDeleteManualEntry,
  entryToCashMovementManualEntry,
  findEntryByPeriodMonth,
  formatGHS,
  formatPeriodMonthLabel,
  getDefaultPeriodSelection,
  getPeriodMonthParts,
  normalizePeriodMonth,
  resolveLiabilityStockAsAt,
  type LiabilityStockKey,
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
  /** Create-only stamp for director loan repayments; null = All Businesses. */
  activeBusinessUnitId?: string | null;
};

type ActiveAction =
  | { kind: "receive"; liability: LiabilityStockKey }
  | { kind: "repay"; liability: LiabilityStockKey }
  | { kind: "noncash"; liability: LiabilityStockKey }
  | { kind: "set_opening_cash" }
  | { kind: "add_other_inflows" };

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
  "rounded-md bg-[#0f2744] px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButtonClassName =
  "rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

const advancedButtonClassName =
  "rounded-md border border-dashed border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

function upsertPayloadFromRow(row: ManualFinancialEntryRecord) {
  return {
    tenant_id: row.tenant_id,
    business_unit_id: row.business_unit_id ?? null,
    period_month: normalizePeriodMonth(row.period_month),
    bank_loans: Number(row.bank_loans) || 0,
    other_long_term_liabilities: Number(row.other_long_term_liabilities) || 0,
    directors_loan: Number(row.directors_loan) || 0,
    loan_proceeds: Number(row.loan_proceeds) || 0,
    loan_repayments: Number(row.loan_repayments) || 0,
    opening_cash_balance: Number(row.opening_cash_balance) || 0,
    other_cash_inflows: Number(row.other_cash_inflows) || 0,
    notes: row.notes ?? null,
  };
}

export default function ManualFinancialEntries({
  tenantId,
  initialEntries,
  initialManualCashEntries,
  initialApPayments,
  initialDirectorsLoanRepayments,
  fetchError,
  activeBusinessUnitId = null,
}: ManualFinancialEntriesProps) {
  const router = useRouter();
  const supabase = createClient();
  const stampBusinessUnit = useStampBusinessUnitId();
  const defaultPeriod = getDefaultPeriodSelection();

  const [entries, setEntries] = useState(initialEntries);
  const [deletingPeriodMonth, setDeletingPeriodMonth] = useState<string | null>(
    null,
  );
  const [selectedYear, setSelectedYear] = useState(String(defaultPeriod.year));
  const [selectedMonth, setSelectedMonth] = useState(
    String(defaultPeriod.month),
  );
  const [activeAction, setActiveAction] = useState<ActiveAction | null>(null);
  const [amount, setAmount] = useState("");
  const [notes, setNotes] = useState("");
  const [nonCashDirection, setNonCashDirection] = useState<
    "increase" | "decrease"
  >("increase");
  const [nonCashReason, setNonCashReason] = useState("");
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

  const periodMonth = buildPeriodMonth(
    Number(selectedYear),
    Number(selectedMonth),
  );
  const periodLabel = formatPeriodMonthLabel(periodMonth);

  const liveManualCashEntries = useMemo(
    () => entries.map(entryToCashMovementManualEntry),
    [entries],
  );

  useEffect(() => {
    setEntries(initialEntries);
  }, [initialEntries]);

  function closeActionForm() {
    setActiveAction(null);
    setAmount("");
    setNotes("");
    setNonCashDirection("increase");
    setNonCashReason("");
  }

  function openAction(action: ActiveAction) {
    setError(null);
    setInfoMessage(null);
    setAmount("");
    setNotes("");
    setNonCashDirection("increase");
    setNonCashReason("");
    setActiveAction(action);
  }

  async function refreshEntries() {
    const { data, error: refreshError } = await scopeToBusinessUnitId(
      supabase.from("manual_financial_entries").select("*"),
      activeBusinessUnitId,
    ).order("period_month", { ascending: false });

    if (refreshError) {
      setError(refreshError.message);
      return;
    }

    setEntries((data as ManualFinancialEntryRecord[] | null) ?? []);
    setError(null);
  }

  async function saveRow(
    row: ManualFinancialEntryRecord,
    successMessage: string,
    notifyDirectorsLoanReceive?: number,
  ) {
    setLoading(true);
    setError(null);
    setInfoMessage(null);

    if (!stampBusinessUnit.ok) {
      setError(stampBusinessUnit.error);
      setLoading(false);
      return;
    }

    const { error: saveError } = await supabase
      .from("manual_financial_entries")
      .upsert(
        upsertPayloadFromRow({
          ...row,
          business_unit_id: stampBusinessUnit.businessUnitId,
        }),
        {
          onConflict: MANUAL_FINANCIAL_ENTRIES_ON_CONFLICT,
        },
      );

    if (saveError) {
      setError(saveError.message);
      setLoading(false);
      return;
    }

    if (
      notifyDirectorsLoanReceive !== undefined &&
      notifyDirectorsLoanReceive > 0
    ) {
      requestTenantAdminDirectorNotification({
        title: "Director's loan cash received",
        detail: formatGHS(notifyDirectorsLoanReceive),
        actionUrl: "/dashboard/finance/manual-financial-entries",
      });
    }

    closeActionForm();
    await refreshEntries();
    setInfoMessage(successMessage);
    setLoading(false);
    router.refresh();
  }

  async function handleDelete(entry: ManualFinancialEntryRecord) {
    if (!confirmDeleteManualEntry(entry)) {
      return;
    }

    const normalized = normalizePeriodMonth(entry.period_month);
    setDeletingPeriodMonth(normalized);
    setError(null);

    let query = scopeToBusinessUnitId(
      supabase
        .from("manual_financial_entries")
        .delete()
        .eq("period_month", normalized),
      activeBusinessUnitId,
    );
    if (entry.tenant_id) {
      query = query.eq("tenant_id", entry.tenant_id);
    } else {
      query = query.eq("tenant_id", tenantId);
    }

    const { error: deleteError } = await query;

    if (deleteError) {
      setError(deleteError.message);
      setDeletingPeriodMonth(null);
      return;
    }

    await refreshEntries();
    setDeletingPeriodMonth(null);
    setInfoMessage(`Deleted entry for ${formatPeriodMonthLabel(normalized)}.`);
    router.refresh();
  }

  async function handleGuidedSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!activeAction) {
      return;
    }

    if (!stampBusinessUnit.ok) {
      setError(stampBusinessUnit.error);
      return;
    }

    const parsedAmount = Number(amount);
    if (!Number.isFinite(parsedAmount)) {
      setError("Enter a valid amount.");
      return;
    }

    const existing = findEntryByPeriodMonth(
      entries,
      periodMonth,
      activeBusinessUnitId,
    );

    if (activeAction.kind === "set_opening_cash") {
      if (parsedAmount < 0) {
        setError("Opening cash balance cannot be negative.");
        return;
      }
      const row = applySetOpeningCashBalance({
        existing,
        periodMonth,
        tenantId,
        businessUnitId: stampBusinessUnit.businessUnitId,
        amount: parsedAmount,
        notes,
      });
      await saveRow(
        row,
        `Opening cash balance set to ${formatGHS(parsedAmount)} for ${periodLabel}.`,
      );
      return;
    }

    if (parsedAmount <= 0) {
      setError("Enter an amount greater than zero.");
      return;
    }

    if (activeAction.kind === "add_other_inflows") {
      const prior = Number(existing?.other_cash_inflows) || 0;
      const row = applyAddOtherCashInflows({
        existing,
        periodMonth,
        tenantId,
        businessUnitId: stampBusinessUnit.businessUnitId,
        amount: parsedAmount,
        notes,
      });
      await saveRow(
        row,
        `Added ${formatGHS(parsedAmount)} to Other Cash Inflows for ${periodLabel} (now ${formatGHS(prior + parsedAmount)}).`,
      );
      return;
    }

    const stockKey = activeAction.liability;
    const label = LIABILITY_STOCK_LABELS[stockKey];
    const priorStock = resolveLiabilityStockAsAt(
      entries,
      stockKey,
      Number(selectedYear),
      Number(selectedMonth),
    );

    if (activeAction.kind === "receive") {
      const nextStock = priorStock + parsedAmount;
      const row = applyLiabilityMoneyReceived({
        existing,
        periodMonth,
        tenantId,
        businessUnitId: stampBusinessUnit.businessUnitId,
        stockKey,
        priorStock,
        amount: parsedAmount,
        notes,
      });
      await saveRow(
        row,
        `${label}: recorded ${formatGHS(parsedAmount)} received (${formatGHS(priorStock)} → ${formatGHS(nextStock)}).`,
        stockKey === "directors_loan" ? parsedAmount : undefined,
      );
      return;
    }

    if (activeAction.kind === "repay") {
      if (parsedAmount > priorStock + 0.005) {
        setError(
          `Repayment exceeds outstanding ${label} (${formatGHS(priorStock)}).`,
        );
        return;
      }
      const nextStock = Math.max(0, priorStock - parsedAmount);
      const row = applyLiabilityMoneyRepaid({
        existing,
        periodMonth,
        tenantId,
        businessUnitId: stampBusinessUnit.businessUnitId,
        stockKey,
        priorStock,
        amount: parsedAmount,
        notes,
      });
      await saveRow(
        row,
        `${label}: recorded ${formatGHS(parsedAmount)} repaid (${formatGHS(priorStock)} → ${formatGHS(nextStock)}).`,
      );
      return;
    }

    // non-cash
    if (nonCashReason.trim().length < 5) {
      setError("Non-cash adjustment requires a reason (at least 5 characters).");
      return;
    }
    const nextStock =
      nonCashDirection === "increase"
        ? priorStock + parsedAmount
        : Math.max(0, priorStock - parsedAmount);
    const row = applyLiabilityNonCashAdjustment({
      existing,
      periodMonth,
      tenantId,
      businessUnitId: stampBusinessUnit.businessUnitId,
      stockKey,
      priorStock,
      amount: parsedAmount,
      direction: nonCashDirection,
      reason: nonCashReason,
    });
    await saveRow(
      row,
      `${label}: non-cash adjustment (${formatGHS(priorStock)} → ${formatGHS(nextStock)}). Cash flow unchanged.`,
    );
  }

  function renderLiabilityCard(
    stockKey: LiabilityStockKey,
    options: { includeRepay: boolean },
  ) {
    const label = LIABILITY_STOCK_LABELS[stockKey];
    const outstanding = resolveLiabilityStockAsAt(
      entries,
      stockKey,
      Number(selectedYear),
      Number(selectedMonth),
    );
    const isActive =
      activeAction &&
      (activeAction.kind === "receive" ||
        activeAction.kind === "repay" ||
        activeAction.kind === "noncash") &&
      activeAction.liability === stockKey;

    const previewAmount = Number(amount) || 0;
    let preview: string | null = null;
    if (isActive && previewAmount > 0) {
      if (activeAction.kind === "receive") {
        preview = `Will set ${label} to ${formatGHS(outstanding)} → ${formatGHS(outstanding + previewAmount)} and add ${formatGHS(previewAmount)} to Loan Proceeds for ${periodLabel}.`;
      } else if (activeAction.kind === "repay") {
        preview = `Will set ${label} to ${formatGHS(outstanding)} → ${formatGHS(Math.max(0, outstanding - previewAmount))} and add ${formatGHS(previewAmount)} to Loan Repayments for ${periodLabel}.`;
      } else {
        const next =
          nonCashDirection === "increase"
            ? outstanding + previewAmount
            : Math.max(0, outstanding - previewAmount);
        preview = `Will change ${label} ${formatGHS(outstanding)} → ${formatGHS(next)} only. Cash flow fields will not change.`;
      }
    }

    return (
      <section
        key={stockKey}
        className="space-y-4 rounded-lg border border-amber-200 bg-amber-50/40 p-5"
      >
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-[#0f2744]">{label}</h3>
            <p className="mt-1 text-sm text-slate-600">
              Outstanding as of {periodLabel}:{" "}
              <span className="font-medium text-[#0f2744]">
                {formatGHS(outstanding)}
              </span>
            </p>
            {stockKey === "directors_loan" ? (
              <p className="mt-1 text-xs text-slate-500">
                To repay the director in cash, use Director&apos;s Loan —
                Repayments below.
              </p>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={primaryButtonClassName}
              onClick={() => openAction({ kind: "receive", liability: stockKey })}
            >
              Record money received
            </button>
            {options.includeRepay ? (
              <button
                type="button"
                className={primaryButtonClassName}
                onClick={() => openAction({ kind: "repay", liability: stockKey })}
              >
                Record money repaid
              </button>
            ) : null}
            <button
              type="button"
              className={advancedButtonClassName}
              onClick={() => openAction({ kind: "noncash", liability: stockKey })}
            >
              Non-cash adjustment
            </button>
          </div>
        </div>

        {isActive ? (
          <form
            onSubmit={handleGuidedSubmit}
            className="space-y-4 rounded-md border border-amber-200 bg-white p-4"
          >
            <h4 className="text-sm font-semibold text-[#0f2744]">
              {activeAction.kind === "receive"
                ? "Record money received"
                : activeAction.kind === "repay"
                  ? "Record money repaid"
                  : "Non-cash adjustment"}
            </h4>

            {activeAction.kind === "noncash" ? (
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Direction
                </label>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    className={
                      nonCashDirection === "increase"
                        ? primaryButtonClassName
                        : secondaryButtonClassName
                    }
                    onClick={() => setNonCashDirection("increase")}
                  >
                    Increase liability
                  </button>
                  <button
                    type="button"
                    className={
                      nonCashDirection === "decrease"
                        ? primaryButtonClassName
                        : secondaryButtonClassName
                    }
                    onClick={() => setNonCashDirection("decrease")}
                  >
                    Decrease liability
                  </button>
                </div>
              </div>
            ) : null}

            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Amount (GHS)
              </label>
              <input
                type="number"
                step="0.01"
                min="0.01"
                required
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                className={inputClassName}
              />
            </div>

            {activeAction.kind === "noncash" ? (
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Reason (required — no cash movement)
                </label>
                <textarea
                  required
                  minLength={5}
                  rows={3}
                  value={nonCashReason}
                  onChange={(event) => setNonCashReason(event.target.value)}
                  className={inputClassName}
                  placeholder="e.g. Opening balance brought forward; loan forgiveness; reclassification"
                />
              </div>
            ) : (
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Notes (optional)
                </label>
                <input
                  type="text"
                  value={notes}
                  onChange={(event) => setNotes(event.target.value)}
                  className={inputClassName}
                />
              </div>
            )}

            {preview ? (
              <p className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-950">
                {preview}
              </p>
            ) : null}

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={loading}
                className={primaryButtonClassName}
              >
                {loading ? "Saving…" : "Save"}
              </button>
              <button
                type="button"
                disabled={loading}
                onClick={closeActionForm}
                className={secondaryButtonClassName}
              >
                Cancel
              </button>
            </div>
          </form>
        ) : null}
      </section>
    );
  }

  const openingCashActive = activeAction?.kind === "set_opening_cash";
  const otherInflowsActive = activeAction?.kind === "add_other_inflows";
  const existingForPeriod = findEntryByPeriodMonth(
    entries,
    periodMonth,
    activeBusinessUnitId,
  );
  const currentOpeningCash = Number(existingForPeriod?.opening_cash_balance) || 0;
  const currentOtherInflows = Number(existingForPeriod?.other_cash_inflows) || 0;
  const otherInflowsPreviewAmount = Number(amount) || 0;

  const listColumnCount = MANUAL_ENTRY_LIST_COLUMNS.length + 2;

  return (
    <div className="min-w-0 space-y-6">
      <div className="max-w-3xl space-y-2 text-sm text-slate-600">
        <p>
          Pick an action for each liability — enter one amount and the system
          updates the liability balance and matching cash movement. Opening cash
          and other inflows are entered directly.
        </p>
        <p>
          Share Capital is managed under{" "}
          <span className="font-medium text-[#0f2744]">
            Balance Sheet → Capital Contributions
          </span>
          .
        </p>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-600">
          Period for actions
        </h3>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Month
            </label>
            <select
              value={selectedMonth}
              onChange={(event) => {
                setSelectedMonth(event.target.value);
                closeActionForm();
              }}
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
              value={selectedYear}
              onChange={(event) => {
                setSelectedYear(event.target.value);
                closeActionForm();
              }}
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
      </section>

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

      {renderLiabilityCard("bank_loans", { includeRepay: true })}
      {renderLiabilityCard("other_long_term_liabilities", {
        includeRepay: true,
      })}
      {renderLiabilityCard("directors_loan", { includeRepay: false })}

      <section className="space-y-4 rounded-lg border border-emerald-200 bg-emerald-50/40 p-5">
        <h3 className="text-lg font-semibold text-[#0f2744]">Cash-only entries</h3>
        <p className="text-sm text-slate-600">
          These do not change liability balances.
        </p>

        <div className="grid gap-4 lg:grid-cols-2">
          <div className="space-y-3 rounded-md border border-emerald-200 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h4 className="font-medium text-[#0f2744]">
                  Opening Cash Balance
                </h4>
                <p className="mt-1 text-xs text-slate-500">
                  {MANUAL_ENTRY_FIELD_DESCRIPTIONS.opening_cash_balance} Current
                  for {periodLabel}: {formatGHS(currentOpeningCash)}
                </p>
              </div>
              <button
                type="button"
                className={primaryButtonClassName}
                onClick={() => openAction({ kind: "set_opening_cash" })}
              >
                Set Opening Cash Balance
              </button>
            </div>
            {openingCashActive ? (
              <form onSubmit={handleGuidedSubmit} className="space-y-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Amount (GHS) — replaces this month&apos;s value
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0"
                    required
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    className={inputClassName}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Notes (optional)
                  </label>
                  <input
                    type="text"
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    className={inputClassName}
                  />
                </div>
                {Number(amount) >= 0 && amount !== "" ? (
                  <p className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-950">
                    Will set Opening Cash Balance to{" "}
                    {formatGHS(Number(amount) || 0)} for {periodLabel}{" "}
                    (replaces {formatGHS(currentOpeningCash)}).
                  </p>
                ) : null}
                <div className="flex gap-3">
                  <button
                    type="submit"
                    disabled={loading}
                    className={primaryButtonClassName}
                  >
                    {loading ? "Saving…" : "Set"}
                  </button>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={closeActionForm}
                    className={secondaryButtonClassName}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : null}
          </div>

          <div className="space-y-3 rounded-md border border-emerald-200 bg-white p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h4 className="font-medium text-[#0f2744]">
                  Other Cash Inflows
                </h4>
                <p className="mt-1 text-xs text-slate-500">
                  {MANUAL_ENTRY_FIELD_DESCRIPTIONS.other_cash_inflows} Current for{" "}
                  {periodLabel}: {formatGHS(currentOtherInflows)}
                </p>
              </div>
              <button
                type="button"
                className={primaryButtonClassName}
                onClick={() => openAction({ kind: "add_other_inflows" })}
              >
                Record Other Cash Inflow
              </button>
            </div>
            {otherInflowsActive ? (
              <form onSubmit={handleGuidedSubmit} className="space-y-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Amount (GHS) — adds to this month&apos;s total
                  </label>
                  <input
                    type="number"
                    step="0.01"
                    min="0.01"
                    required
                    value={amount}
                    onChange={(event) => setAmount(event.target.value)}
                    className={inputClassName}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Notes (optional)
                  </label>
                  <input
                    type="text"
                    value={notes}
                    onChange={(event) => setNotes(event.target.value)}
                    className={inputClassName}
                  />
                </div>
                {otherInflowsPreviewAmount > 0 ? (
                  <p className="rounded-md border border-sky-200 bg-sky-50 px-3 py-2 text-sm text-sky-950">
                    Will add {formatGHS(otherInflowsPreviewAmount)} to Other Cash
                    Inflows for {periodLabel} (
                    {formatGHS(currentOtherInflows)} →{" "}
                    {formatGHS(currentOtherInflows + otherInflowsPreviewAmount)}
                    ).
                  </p>
                ) : null}
                <div className="flex gap-3">
                  <button
                    type="submit"
                    disabled={loading}
                    className={primaryButtonClassName}
                  >
                    {loading ? "Saving…" : "Save"}
                  </button>
                  <button
                    type="button"
                    disabled={loading}
                    onClick={closeActionForm}
                    className={secondaryButtonClassName}
                  >
                    Cancel
                  </button>
                </div>
              </form>
            ) : null}
          </div>
        </div>
      </section>

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
                      onDelete={() => handleDelete(entry)}
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
        manualEntries={
          liveManualCashEntries.length > 0
            ? liveManualCashEntries
            : initialManualCashEntries
        }
        apPayments={initialApPayments}
        initialRepayments={initialDirectorsLoanRepayments}
        activeBusinessUnitId={activeBusinessUnitId}
      />
    </div>
  );
}
