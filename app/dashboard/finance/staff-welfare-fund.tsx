"use client";

import { useMemo, useState } from "react";
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
import { filterActiveEmployees, type HrEmployee } from "../hr-payroll/employee-utils";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import { formatGHS, formatDate } from "./income-register-utils";
import { toPeriodMonth } from "./tax-utils";
import {
  STAFF_WELFARE_COMPANY_CONTRIBUTION_COUNTERPARTY,
  STAFF_WELFARE_CONTRIBUTION_CATEGORY,
  STAFF_WELFARE_DISBURSEMENT_CATEGORY,
  STAFF_WELFARE_FUND_MANUAL_SOURCE_TYPE,
  STAFF_WELFARE_LEDGER_SELECT,
  buildStaffWelfareContributionReceiptNo,
  calculateStaffWelfareFundBalance,
  buildStaffWelfareDisbursementReceiptNo,
  getEntryTypeLabel,
  getWelfareFundStatusLabel,
  normalizeStaffWelfareFundEntry,
  type StaffWelfareFundLedgerEntry,
} from "./staff-welfare-fund-utils";

type StaffWelfareFundProps = {
  tenantId: string;
  initialEntries: StaffWelfareFundLedgerEntry[];
  initialEmployees: HrEmployee[];
  fetchError: string | null;
  activeBusinessUnitId?: string | null;
};

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#18365c] disabled:cursor-not-allowed disabled:opacity-50";

async function ensureExpenseCategory(
  supabase: ReturnType<typeof createClient>,
  categoryName: string,
): Promise<void> {
  const { data: existing, error: selectError } = await supabase
    .from("expense_categories")
    .select("name")
    .eq("name", categoryName)
    .maybeSingle();

  if (selectError) {
    throw new Error(selectError.message);
  }

  if (existing) {
    return;
  }

  const { error: insertError } = await supabase
    .from("expense_categories")
    .insert({ name: categoryName });

  if (insertError) {
    throw new Error(insertError.message);
  }
}

export default function StaffWelfareFund({
  tenantId,
  initialEntries,
  initialEmployees,
  fetchError,
  activeBusinessUnitId = null,
}: StaffWelfareFundProps) {
  const supabase = createClient();
  const stampBusinessUnit = useStampBusinessUnitId();
  const buReadScope = useBusinessUnitReadScope();
  const [entries, setEntries] = useState(
    initialEntries.map(normalizeStaffWelfareFundEntry),
  );
  const [showDisbursementForm, setShowDisbursementForm] = useState(false);
  const [showContributionForm, setShowContributionForm] = useState(false);
  const [loadingDisbursement, setLoadingDisbursement] = useState(false);
  const [loadingContribution, setLoadingContribution] = useState(false);
  const [error, setError] = useState<string | null>(fetchError);
  const [disbursementForm, setDisbursementForm] = useState({
    entry_date: new Date().toISOString().slice(0, 10),
    amount: "",
    employee_id: "",
    notes: "",
  });
  const [contributionForm, setContributionForm] = useState({
    entry_date: new Date().toISOString().slice(0, 10),
    amount: "",
    notes: "",
  });

  const fundBalance = useMemo(
    () => calculateStaffWelfareFundBalance(entries),
    [entries],
  );

  const employeeOptions = useMemo(
    () =>
      filterActiveEmployees(initialEmployees).sort((left, right) =>
        (left.full_name ?? left.employee_id).localeCompare(
          right.full_name ?? right.employee_id,
        ),
      ),
    [initialEmployees],
  );

  async function refreshEntries() {
    const { data, error: refreshError } = await applyBusinessUnitScope(
      supabase
        .from("staff_welfare_fund_ledger")
        .select(STAFF_WELFARE_LEDGER_SELECT)
        .eq("tenant_id", tenantId)
        .neq("status", "reversed")
        .order("entry_date", { ascending: false })
        .order("created_at", { ascending: false }),
      buReadScope,
    );

    if (refreshError) {
      setError(refreshError.message);
      return;
    }

    setEntries(
      ((data as StaffWelfareFundLedgerEntry[] | null) ?? []).map(
        normalizeStaffWelfareFundEntry,
      ),
    );
    setError(null);
  }

  async function handleDisbursementSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoadingDisbursement(true);
    setError(null);

    const amount = Number(disbursementForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Enter a valid disbursement amount greater than zero.");
      setLoadingDisbursement(false);
      return;
    }

    if (amount > fundBalance) {
      setError(
        `Disbursement (${formatGHS(amount)}) exceeds the current fund balance (${formatGHS(fundBalance)}).`,
      );
      setLoadingDisbursement(false);
      return;
    }

    try {
      const buContext = await loadWriteBusinessUnitContext(supabase);
      if (!buContext.ok) {
        throw new Error(buContext.error);
      }

      const stampResult = resolveWriteBusinessUnitIdForCreate({
        allowedUnits: buContext.allowedUnits,
        stamp: stampBusinessUnit,
      });
      if (!stampResult.ok) {
        throw new Error(stampResult.error);
      }

      const businessUnitId = stampResult.businessUnitId;
      assertCanModifyBusinessUnitRow(buContext.allowedUnits, businessUnitId);

      await ensureExpenseCategory(supabase, STAFF_WELFARE_DISBURSEMENT_CATEGORY);

      const employeeId = disbursementForm.employee_id.trim() || null;
      const counterpartyName = employeeId
        ? (employeeOptions.find((employee) => employee.employee_id === employeeId)
            ?.full_name ?? employeeId)
        : "Staff Welfare Fund";

      const paidAt = new Date().toISOString();

      const { data: ledgerRow, error: ledgerError } = await supabase
        .from("staff_welfare_fund_ledger")
        .insert({
          tenant_id: tenantId,
          business_unit_id: businessUnitId,
          entry_date: disbursementForm.entry_date,
          period_month: null,
          entry_type: "disbursement",
          amount,
          status: "settled",
          source_type: STAFF_WELFARE_FUND_MANUAL_SOURCE_TYPE,
          source_id: null,
          employee_id: employeeId,
          counterparty_name: counterpartyName,
          notes: disbursementForm.notes.trim() || null,
          paid_at: paidAt,
        })
        .select("id")
        .single();

      if (ledgerError) {
        throw new Error(ledgerError.message);
      }

      const receiptNo = buildStaffWelfareDisbursementReceiptNo(
        disbursementForm.entry_date,
        ledgerRow.id as string,
      );

      const { error: expenseError } = await supabase.from("expense_register").insert({
        tenant_id: tenantId,
        business_unit_id: businessUnitId,
        date: disbursementForm.entry_date,
        expense_category: STAFF_WELFARE_DISBURSEMENT_CATEGORY,
        sub_category: "Staff Welfare",
        description: `Staff welfare disbursement${employeeId ? ` — ${counterpartyName}` : ""}`,
        vendor: counterpartyName,
        price: amount,
        quantity: 1,
        amount,
        payment_method: "Bank Transfer",
        approved_by: "System",
        receipt_no: receiptNo,
        payment_status: "Paid",
        notes: disbursementForm.notes.trim() || "Staff welfare fund disbursement",
      });

      if (expenseError) {
        await supabase
          .from("staff_welfare_fund_ledger")
          .delete()
          .eq("id", ledgerRow.id);
        throw new Error(expenseError.message);
      }

      const { error: linkError } = await supabase
        .from("staff_welfare_fund_ledger")
        .update({ expense_receipt_no: receiptNo })
        .eq("id", ledgerRow.id);

      if (linkError) {
        throw new Error(linkError.message);
      }

      setDisbursementForm({
        entry_date: new Date().toISOString().slice(0, 10),
        amount: "",
        employee_id: "",
        notes: "",
      });
      setShowDisbursementForm(false);
      await refreshEntries();
    } catch (submitError) {
      setError(formatBusinessUnitAccessError(submitError));
    } finally {
      setLoadingDisbursement(false);
    }
  }

  async function handleContributionSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoadingContribution(true);
    setError(null);

    const amount = Number(contributionForm.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setError("Enter a valid contribution amount greater than zero.");
      setLoadingContribution(false);
      return;
    }

    try {
      const buContext = await loadWriteBusinessUnitContext(supabase);
      if (!buContext.ok) {
        throw new Error(buContext.error);
      }

      const stampResult = resolveWriteBusinessUnitIdForCreate({
        allowedUnits: buContext.allowedUnits,
        stamp: stampBusinessUnit,
      });
      if (!stampResult.ok) {
        throw new Error(stampResult.error);
      }

      const businessUnitId = stampResult.businessUnitId;
      assertCanModifyBusinessUnitRow(buContext.allowedUnits, businessUnitId);

      await ensureExpenseCategory(supabase, STAFF_WELFARE_CONTRIBUTION_CATEGORY);

      const { data: ledgerRow, error: ledgerError } = await supabase
        .from("staff_welfare_fund_ledger")
        .insert({
          tenant_id: tenantId,
          business_unit_id: businessUnitId,
          entry_date: contributionForm.entry_date,
          period_month: toPeriodMonth(contributionForm.entry_date),
          entry_type: "accrual",
          amount,
          status: "open",
          source_type: STAFF_WELFARE_FUND_MANUAL_SOURCE_TYPE,
          source_id: null,
          employee_id: null,
          counterparty_name: STAFF_WELFARE_COMPANY_CONTRIBUTION_COUNTERPARTY,
          notes: contributionForm.notes.trim() || null,
          paid_at: null,
        })
        .select("id")
        .single();

      if (ledgerError) {
        throw new Error(ledgerError.message);
      }

      const receiptNo = buildStaffWelfareContributionReceiptNo(
        contributionForm.entry_date,
        ledgerRow.id as string,
      );

      const { error: expenseError } = await supabase.from("expense_register").insert({
        tenant_id: tenantId,
        business_unit_id: businessUnitId,
        date: contributionForm.entry_date,
        expense_category: STAFF_WELFARE_CONTRIBUTION_CATEGORY,
        sub_category: "Staff Welfare",
        description: "Company contribution to staff welfare fund",
        vendor: STAFF_WELFARE_COMPANY_CONTRIBUTION_COUNTERPARTY,
        price: amount,
        quantity: 1,
        amount,
        payment_method: "Bank Transfer",
        approved_by: "System",
        receipt_no: receiptNo,
        payment_status: "Paid",
        notes: contributionForm.notes.trim() || "Staff welfare fund company contribution",
      });

      if (expenseError) {
        await supabase
          .from("staff_welfare_fund_ledger")
          .delete()
          .eq("id", ledgerRow.id);
        throw new Error(expenseError.message);
      }

      const { error: linkError } = await supabase
        .from("staff_welfare_fund_ledger")
        .update({ expense_receipt_no: receiptNo })
        .eq("id", ledgerRow.id);

      if (linkError) {
        throw new Error(linkError.message);
      }

      setContributionForm({
        entry_date: new Date().toISOString().slice(0, 10),
        amount: "",
        notes: "",
      });
      setShowContributionForm(false);
      await refreshEntries();
    } catch (submitError) {
      setError(formatBusinessUnitAccessError(submitError));
    } finally {
      setLoadingContribution(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-4 md:grid-cols-2">
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-slate-600">Current fund balance</p>
          <p className="mt-1 text-2xl font-semibold text-[#0f2744]">
            {formatGHS(fundBalance)}
          </p>
          <p className="mt-2 text-xs text-slate-500">
            Open payroll accruals minus recorded disbursements (BU-scoped view).
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <p className="text-sm text-slate-600">Payroll accruals</p>
          <p className="mt-1 text-lg font-semibold text-[#0f2744]">
            Posted automatically when payroll is locked
          </p>
          <p className="mt-2 text-xs text-slate-500">
            Welfare deductions no longer feed DEDSAV Other Income — they build this
            liability instead.
          </p>
        </div>
      </div>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-[#0f2744]">
              Record Disbursement
            </h2>
            <button
              type="button"
              className={primaryButtonClassName}
              onClick={() => {
                setShowDisbursementForm((open) => !open);
                setShowContributionForm(false);
              }}
            >
              {showDisbursementForm ? "Cancel" : "New disbursement"}
            </button>
          </div>

          {showDisbursementForm ? (
            <form
              onSubmit={handleDisbursementSubmit}
              className="grid gap-4 md:grid-cols-2"
            >
              <label className="block text-sm text-slate-700">
                Date
                <input
                  type="date"
                  required
                  value={disbursementForm.entry_date}
                  onChange={(event) =>
                    setDisbursementForm((current) => ({
                      ...current,
                      entry_date: event.target.value,
                    }))
                  }
                  className={`${inputClassName} mt-1`}
                />
              </label>
              <label className="block text-sm text-slate-700">
                Amount (GHS)
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                  value={disbursementForm.amount}
                  onChange={(event) =>
                    setDisbursementForm((current) => ({
                      ...current,
                      amount: event.target.value,
                    }))
                  }
                  className={`${inputClassName} mt-1`}
                />
              </label>
              <label className="block text-sm text-slate-700 md:col-span-2">
                Employee (optional)
                <select
                  value={disbursementForm.employee_id}
                  onChange={(event) =>
                    setDisbursementForm((current) => ({
                      ...current,
                      employee_id: event.target.value,
                    }))
                  }
                  className={`${inputClassName} mt-1`}
                >
                  <option value="">General fund payout</option>
                  {employeeOptions.map((employee) => (
                    <option key={employee.employee_id} value={employee.employee_id}>
                      {employee.full_name ?? employee.employee_id}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm text-slate-700 md:col-span-2">
                Note
                <textarea
                  value={disbursementForm.notes}
                  onChange={(event) =>
                    setDisbursementForm((current) => ({
                      ...current,
                      notes: event.target.value,
                    }))
                  }
                  rows={3}
                  className={`${inputClassName} mt-1`}
                  placeholder="Optional context for this payout"
                />
              </label>
              <div className="md:col-span-2">
                <button
                  type="submit"
                  disabled={loadingDisbursement}
                  className={primaryButtonClassName}
                >
                  {loadingDisbursement ? "Posting…" : "Post disbursement"}
                </button>
              </div>
            </form>
          ) : (
            <p className="text-sm text-slate-500">
              Record a payout from the welfare fund. This posts a{" "}
              <strong>{STAFF_WELFARE_DISBURSEMENT_CATEGORY}</strong> cash expense
              (excluded from P&amp;L) and reduces the fund balance.
            </p>
          )}
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-lg font-semibold text-[#0f2744]">
              Record Company Contribution
            </h2>
            <button
              type="button"
              className={primaryButtonClassName}
              onClick={() => {
                setShowContributionForm((open) => !open);
                setShowDisbursementForm(false);
              }}
            >
              {showContributionForm ? "Cancel" : "New contribution"}
            </button>
          </div>

          {showContributionForm ? (
            <form
              onSubmit={handleContributionSubmit}
              className="grid gap-4 md:grid-cols-2"
            >
              <label className="block text-sm text-slate-700">
                Date
                <input
                  type="date"
                  required
                  value={contributionForm.entry_date}
                  onChange={(event) =>
                    setContributionForm((current) => ({
                      ...current,
                      entry_date: event.target.value,
                    }))
                  }
                  className={`${inputClassName} mt-1`}
                />
              </label>
              <label className="block text-sm text-slate-700">
                Amount (GHS)
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  required
                  value={contributionForm.amount}
                  onChange={(event) =>
                    setContributionForm((current) => ({
                      ...current,
                      amount: event.target.value,
                    }))
                  }
                  className={`${inputClassName} mt-1`}
                />
              </label>
              <label className="block text-sm text-slate-700 md:col-span-2">
                Note
                <textarea
                  value={contributionForm.notes}
                  onChange={(event) =>
                    setContributionForm((current) => ({
                      ...current,
                      notes: event.target.value,
                    }))
                  }
                  rows={3}
                  className={`${inputClassName} mt-1`}
                  placeholder="Optional context for this company top-up"
                />
              </label>
              <div className="md:col-span-2">
                <button
                  type="submit"
                  disabled={loadingContribution}
                  className={primaryButtonClassName}
                >
                  {loadingContribution ? "Posting…" : "Post contribution"}
                </button>
              </div>
            </form>
          ) : (
            <p className="text-sm text-slate-500">
              Add company money to the welfare fund. This posts a{" "}
              <strong>{STAFF_WELFARE_CONTRIBUTION_CATEGORY}</strong> operating
              expense (included in P&amp;L) and increases the fund balance.
            </p>
          )}
        </section>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-200 px-6 py-4">
          <h2 className="text-lg font-semibold text-[#0f2744]">Ledger history</h2>
        </div>
        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={scrollableTableThClassName}>Date</th>
                <th className={scrollableTableThClassName}>Type</th>
                <th className={scrollableTableThClassName}>Employee / Counterparty</th>
                <th className={scrollableTableThClassName}>Amount</th>
                <th className={scrollableTableThClassName}>Status</th>
                <th className={scrollableTableThClassName}>Source</th>
                <th className={scrollableTableThClassName}>Receipt</th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-500">
                    No welfare fund ledger entries yet. Accruals appear after payroll
                    lock.
                  </td>
                </tr>
              ) : (
                entries.map((entry, index) => (
                  <tr
                    key={entry.id}
                    className={index % 2 === 1 ? "bg-slate-50" : undefined}
                  >
                    <td className="px-4 py-3 text-sm">{formatDate(entry.entry_date)}</td>
                    <td className="px-4 py-3 text-sm">
                      {getEntryTypeLabel(entry.entry_type)}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {entry.counterparty_name ??
                        (entry.employee_id
                          ? (employeeOptions.find(
                              (employee) =>
                                employee.employee_id === entry.employee_id,
                            )?.full_name ?? entry.employee_id)
                          : "—")}
                    </td>
                    <td className="px-4 py-3 text-sm font-medium">
                      {entry.entry_type === "disbursement" ? "−" : "+"}
                      {formatGHS(entry.amount)}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {getWelfareFundStatusLabel(entry.status)}
                    </td>
                    <td className="px-4 py-3 text-sm">{entry.source_type}</td>
                    <td className="px-4 py-3 text-sm">
                      {entry.expense_receipt_no ?? "—"}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </ScrollableTable>
      </section>
    </div>
  );
}
