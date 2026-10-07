"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";
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
import FilteredListCount from "../filtered-list-count";
import { getEmployeeDisplayName, type HrEmployee } from "./employee-utils";
import type { LoanRegisterEntry } from "./loan-register-utils";
import {
  calculateLoanOutstanding,
  formatDate,
  formatGHS,
  getLoanStatus,
  inputClassName,
} from "./hr-register-utils";
import { allocateLoanId } from "./hr-ids-api";
import OvertimeEmployeeMultiSelect from "./overtime-employee-multi-select";
import type { Approver } from "../lookup-types";
import {
  formatSalaryAdvanceSaveError,
  formatSalaryAdvanceStatus,
  normalizePayrollMonthStart,
  payrollMonthStartFromDate,
  type SalaryAdvanceRegisterEntry,
} from "./salary-advance-register-utils";
import { fetchLoansAndAdvancesForRegister } from "./loans-advances-register-fetch";
import { resolveBusinessUnitReadScope } from "@/utils/business-unit-view";
import {
  formatPaymentAccountSummary,
  type PaymentAccountRow,
} from "@/utils/payment-accounts-types";

type LoansHrEmployee = HrEmployee & {
  business_unit_id?: string | null;
};

type RegisterRecordType = "all" | "loan" | "advance";

type LoansAndAdvancesRegisterProps = {
  tenantId: string;
  initialLoans: LoanRegisterEntry[];
  initialAdvances: SalaryAdvanceRegisterEntry[];
  initialEmployees: LoansHrEmployee[];
  initialPaymentAccounts: PaymentAccountRow[];
  initialApprovers: Approver[];
  activeBusinessUnitId: string | null;
  viewAllBusinessUnits: boolean;
  fetchError: string | null;
  paymentAccountsWarning: string | null;
};

const emptyLoanForm = {
  employee_id: "",
  loan_amount: "",
  date_issued: "",
  repayment_period_months: "",
  monthly_deduction: "",
  total_repaid_to_date: "",
};

const emptyAdvanceForm = {
  employee_ids: [] as string[],
  amount: "",
  date_issued: "",
  deduct_payroll_month: "",
  payment_account_id: "",
  approved_by: "",
  perEmployeeAmounts: {} as Record<string, string>,
};

function LoanStatusBadge({ outstandingBalance }: { outstandingBalance: number }) {
  const status = getLoanStatus(outstandingBalance);
  const isFullyRepaid = status === "Fully Repaid";
  return (
    <span
      className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${
        isFullyRepaid
          ? "bg-emerald-100 text-emerald-800"
          : "bg-blue-100 text-blue-800"
      }`}
    >
      {status}
    </span>
  );
}

export default function LoansAndAdvancesRegister({
  tenantId,
  initialLoans,
  initialAdvances,
  initialEmployees,
  initialPaymentAccounts,
  initialApprovers,
  activeBusinessUnitId,
  viewAllBusinessUnits,
  fetchError,
  paymentAccountsWarning,
}: LoansAndAdvancesRegisterProps) {
  const supabase = createClient();
  const [loans, setLoans] = useState(initialLoans);
  const [advances, setAdvances] = useState(initialAdvances);
  const [showForm, setShowForm] = useState(false);
  const [formKind, setFormKind] = useState<"loan" | "advance">("loan");
  const [typeFilter, setTypeFilter] = useState<RegisterRecordType>("all");
  const [editingLoanId, setEditingLoanId] = useState<string | null>(null);
  const [editingAdvanceId, setEditingAdvanceId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [loanForm, setLoanForm] = useState(emptyLoanForm);
  const [advanceForm, setAdvanceForm] = useState(emptyAdvanceForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(fetchError);
  const [advanceFormError, setAdvanceFormError] = useState<string | null>(null);

  useEffect(() => {
    setLoans(initialLoans);
  }, [initialLoans]);

  useEffect(() => {
    setAdvances(initialAdvances);
  }, [initialAdvances]);

  const previewLoanOutstanding = calculateLoanOutstanding(
    Number(loanForm.loan_amount) || 0,
    Number(loanForm.total_repaid_to_date) || 0,
  );

  const advanceBulkCount = advanceForm.employee_ids.length;
  const advanceUnitAmount = Number(advanceForm.amount) || 0;
  const advanceLiveTotal = useMemo(() => {
    if (editingAdvanceId) {
      return advanceUnitAmount;
    }
    return advanceForm.employee_ids.reduce((sum, employeeId) => {
      const lineAmount =
        Number(advanceForm.perEmployeeAmounts[employeeId]) ||
        advanceUnitAmount ||
        0;
      return sum + lineAmount;
    }, 0);
  }, [
    advanceForm.employee_ids,
    advanceForm.perEmployeeAmounts,
    advanceUnitAmount,
    editingAdvanceId,
  ]);

  async function refreshData() {
    const buScope = resolveBusinessUnitReadScope({
      viewAllBusinessUnits,
      activeBusinessUnitId,
    });
    const result = await fetchLoansAndAdvancesForRegister(
      supabase,
      tenantId,
      buScope,
    );
    if (result.error) {
      setError(result.error);
      return;
    }
    setLoans(result.loans);
    setAdvances(result.advances);
    setError(null);
  }

  function openAddForm(kind: "loan" | "advance") {
    setFormKind(kind);
    setEditingLoanId(null);
    setEditingAdvanceId(null);
    setLoanForm(emptyLoanForm);
    setAdvanceForm(emptyAdvanceForm);
    setAdvanceFormError(null);
    setShowForm(true);
  }

  function closeForm() {
    setShowForm(false);
    setEditingLoanId(null);
    setEditingAdvanceId(null);
    setLoanForm(emptyLoanForm);
    setAdvanceForm(emptyAdvanceForm);
    setAdvanceFormError(null);
  }

  function syncAdvanceEmployeeSelection(ids: string[]) {
    setAdvanceForm((current) => {
      const nextAmounts = { ...current.perEmployeeAmounts };
      for (const id of ids) {
        if (nextAmounts[id] === undefined || nextAmounts[id] === "") {
          nextAmounts[id] = current.amount;
        }
      }
      for (const key of Object.keys(nextAmounts)) {
        if (!ids.includes(key)) {
          delete nextAmounts[key];
        }
      }
      return { ...current, employee_ids: ids, perEmployeeAmounts: nextAmounts };
    });
  }

  const combinedRows = useMemo(() => {
    const loanRows = loans.map((entry) => ({
      kind: "loan" as const,
      key: entry.loan_id,
      date: entry.date_issued,
      employee_id: entry.employee_id,
      entry,
    }));
    const advanceRows = advances.map((entry) => ({
      kind: "advance" as const,
      key: entry.advance_id,
      date: entry.date_issued,
      employee_id: entry.employee_id,
      entry,
    }));
    return [...loanRows, ...advanceRows].sort((a, b) =>
      b.date.localeCompare(a.date),
    );
  }, [loans, advances]);

  const filteredRows = combinedRows.filter((row) => {
    if (typeFilter === "all") {
      return true;
    }
    return row.kind === typeFilter;
  });

  async function handleDeleteLoan(loanId: string) {
    if (!(await confirmDeleteEntry())) {
      return;
    }
    setDeletingId(loanId);
    const { error: deleteError } = await supabase
      .from("loan_register")
      .delete()
      .eq("loan_id", loanId);
    if (deleteError) {
      setError(deleteError.message);
      setDeletingId(null);
      return;
    }
    await refreshData();
    setDeletingId(null);
  }

  async function handleDeleteAdvance(advanceId: string) {
    if (!(await confirmDeleteEntry())) {
      return;
    }
    setDeletingId(advanceId);
    setError(null);
    const { error: rpcError } = await supabase.rpc("delete_salary_advance", {
      p_payload: { tenant_id: tenantId, advance_id: advanceId },
    });
    if (rpcError) {
      setError(rpcError.message);
      setDeletingId(null);
      return;
    }
    await refreshData();
    setDeletingId(null);
  }

  async function handleLoanSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const loanAmount = Number(loanForm.loan_amount) || 0;
    const totalRepaid = Number(loanForm.total_repaid_to_date) || 0;
    const payload = {
      employee_id: loanForm.employee_id,
      loan_amount: loanAmount,
      date_issued: loanForm.date_issued,
      repayment_period_months: Number(loanForm.repayment_period_months) || 0,
      monthly_deduction: Number(loanForm.monthly_deduction) || 0,
      total_repaid_to_date: totalRepaid,
      outstanding_balance: calculateLoanOutstanding(loanAmount, totalRepaid),
    };
    if (editingLoanId) {
      const { error: saveError } = await supabase
        .from("loan_register")
        .update(payload)
        .eq("loan_id", editingLoanId);
      if (saveError) {
        setError(saveError.message);
        setLoading(false);
        return;
      }
    } else {
      const allocated = await allocateLoanId(supabase);
      if (allocated.error || !allocated.loanId) {
        setError(allocated.error ?? "Unable to allocate loan ID.");
        setLoading(false);
        return;
      }
      const { error: saveError } = await supabase
        .from("loan_register")
        .insert({ loan_id: allocated.loanId, ...payload });
      if (saveError) {
        setError(saveError.message);
        setLoading(false);
        return;
      }
    }
    closeForm();
    await refreshData();
    setLoading(false);
  }

  const employeeById = useMemo(() => {
    const map = new Map<string, LoansHrEmployee>();
    for (const employee of initialEmployees) {
      map.set(employee.employee_id, employee);
    }
    return map;
  }, [initialEmployees]);

  function resolveAdvanceBusinessUnitId(employeeId: string): string | null {
    const employee = employeeById.get(employeeId);
    const fromEmployee = employee?.business_unit_id?.trim() || null;
    if (fromEmployee) {
      return fromEmployee;
    }
    const fromSwitcher = activeBusinessUnitId?.trim() || null;
    if (fromSwitcher) {
      return fromSwitcher;
    }
    return null;
  }

  function validateAdvanceBusinessUnits(employeeIds: string[]): string | null {
    for (const employeeId of employeeIds) {
      if (resolveAdvanceBusinessUnitId(employeeId)) {
        continue;
      }
      if (viewAllBusinessUnits) {
        return "Choose a business before saving.";
      }
    }
    return null;
  }

  async function handleAdvanceSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setAdvanceFormError(null);
    const issued = advanceForm.date_issued;
    const deductMonth = normalizePayrollMonthStart(
      advanceForm.deduct_payroll_month.trim() ||
        payrollMonthStartFromDate(issued),
    );
    const items = editingAdvanceId
      ? [
          {
            employee_id: advanceForm.employee_ids[0] ?? "",
            amount: Number(advanceForm.amount) || 0,
            date_issued: issued,
            deduct_payroll_month: deductMonth,
            payment_account_id: advanceForm.payment_account_id,
            approved_by: advanceForm.approved_by,
            advance_id: editingAdvanceId,
          },
        ]
      : advanceForm.employee_ids.map((employeeId) => ({
          employee_id: employeeId,
          amount:
            Number(advanceForm.perEmployeeAmounts[employeeId]) ||
            Number(advanceForm.amount) ||
            0,
          date_issued: issued,
          deduct_payroll_month: deductMonth,
          payment_account_id: advanceForm.payment_account_id,
          approved_by: advanceForm.approved_by,
        }));

    const buValidation = validateAdvanceBusinessUnits(
      items.map((item) => item.employee_id),
    );
    if (buValidation) {
      setAdvanceFormError(buValidation);
      setLoading(false);
      return;
    }

    const switcherBusinessUnitId = viewAllBusinessUnits
      ? null
      : activeBusinessUnitId;

    if (editingAdvanceId) {
      const { error: rpcError } = await supabase.rpc("update_salary_advance", {
        p_payload: {
          tenant_id: tenantId,
          advance_id: editingAdvanceId,
          amount: items[0]?.amount,
          date_issued: issued,
          deduct_payroll_month: deductMonth,
          payment_account_id: advanceForm.payment_account_id,
          approved_by: advanceForm.approved_by,
        },
      });
      if (rpcError) {
        setAdvanceFormError(formatSalaryAdvanceSaveError(rpcError.message));
        setLoading(false);
        return;
      }
    } else {
      const { error: rpcError } = await supabase.rpc("save_salary_advances_bulk", {
        p_payload: {
          tenant_id: tenantId,
          business_unit_id: switcherBusinessUnitId,
          advances: items,
        },
      });
      if (rpcError) {
        setAdvanceFormError(formatSalaryAdvanceSaveError(rpcError.message));
        setLoading(false);
        return;
      }
    }
    closeForm();
    await refreshData();
    setLoading(false);
  }

  function openEditAdvance(entry: SalaryAdvanceRegisterEntry) {
    setFormKind("advance");
    setEditingAdvanceId(entry.advance_id);
    setEditingLoanId(null);
    setAdvanceForm({
      employee_ids: [entry.employee_id],
      amount: String(entry.amount),
      date_issued: toDateInputValue(entry.date_issued),
      deduct_payroll_month: toDateInputValue(entry.deduct_payroll_month).slice(0, 7),
      payment_account_id: entry.payment_account_id,
      approved_by: entry.approved_by,
      perEmployeeAmounts: { [entry.employee_id]: String(entry.amount) },
    });
    setAdvanceFormError(null);
    setShowForm(true);
  }

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          Track staff loans and salary advances. Advances post cash out and a staff
          receivable until payroll deducts them.
        </p>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => (showForm ? closeForm() : openAddForm("loan"))}
            className="rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50"
          >
            {showForm && formKind === "loan" ? "Cancel" : "Add Loan"}
          </button>
          <button
            type="button"
            onClick={() => (showForm ? closeForm() : openAddForm("advance"))}
            className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c]"
          >
            {showForm && formKind === "advance" ? "Cancel" : "Add Salary Advance"}
          </button>
        </div>
      </div>

      {paymentAccountsWarning ? (
        <p className="rounded-md border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          {paymentAccountsWarning}
        </p>
      ) : null}

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {showForm && formKind === "loan" ? (
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-lg font-semibold text-[#0f2744]">
            {editingLoanId ? "Edit Loan" : "New Loan"}
          </h3>
          <form onSubmit={handleLoanSubmit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Employee
                </label>
                <select
                  required
                  value={loanForm.employee_id}
                  onChange={(e) =>
                    setLoanForm((c) => ({ ...c, employee_id: e.target.value }))
                  }
                  className={inputClassName}
                >
                  <option value="">Select employee</option>
                  {initialEmployees.map((employee) => (
                    <option key={employee.employee_id} value={employee.employee_id}>
                      {employee.full_name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Loan Amount
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={loanForm.loan_amount}
                  onChange={(e) =>
                    setLoanForm((c) => ({ ...c, loan_amount: e.target.value }))
                  }
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Date Issued
                </label>
                <input
                  type="date"
                  required
                  value={loanForm.date_issued}
                  onChange={(e) =>
                    setLoanForm((c) => ({ ...c, date_issued: e.target.value }))
                  }
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Repayment Period (Months)
                </label>
                <input
                  type="number"
                  min="1"
                  step="1"
                  required
                  value={loanForm.repayment_period_months}
                  onChange={(e) =>
                    setLoanForm((c) => ({
                      ...c,
                      repayment_period_months: e.target.value,
                    }))
                  }
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Monthly Deduction
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={loanForm.monthly_deduction}
                  onChange={(e) =>
                    setLoanForm((c) => ({ ...c, monthly_deduction: e.target.value }))
                  }
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Total Repaid to Date
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={loanForm.total_repaid_to_date}
                  onChange={(e) =>
                    setLoanForm((c) => ({
                      ...c,
                      total_repaid_to_date: e.target.value,
                    }))
                  }
                  className={inputClassName}
                />
              </div>
            </div>
            <p className="text-sm text-slate-600">
              Outstanding Balance:{" "}
              <span className="font-medium text-[#0f2744]">
                {formatGHS(previewLoanOutstanding)}
              </span>
            </p>
            <button
              type="submit"
              disabled={loading}
              className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {loading ? "Saving…" : editingLoanId ? "Save Changes" : "Save Loan"}
            </button>
          </form>
        </section>
      ) : null}

      {showForm && formKind === "advance" ? (
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-lg font-semibold text-[#0f2744]">
            {editingAdvanceId ? "Edit Salary Advance" : "New Salary Advance"}
          </h3>
          <form onSubmit={handleAdvanceSubmit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {!editingAdvanceId ? (
                <div className="md:col-span-2 xl:col-span-3">
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Employees
                  </label>
                  <OvertimeEmployeeMultiSelect
                    employees={initialEmployees}
                    selectedIds={advanceForm.employee_ids}
                    onChange={syncAdvanceEmployeeSelection}
                    disabled={loading}
                  />
                </div>
              ) : null}
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Amount (per employee)
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={advanceForm.amount}
                  onChange={(e) => {
                    const value = e.target.value;
                    setAdvanceForm((c) => {
                      const nextAmounts = { ...c.perEmployeeAmounts };
                      for (const id of c.employee_ids) {
                        nextAmounts[id] = value;
                      }
                      return {
                        ...c,
                        amount: value,
                        perEmployeeAmounts: nextAmounts,
                      };
                    });
                  }}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Date Issued
                </label>
                <input
                  type="date"
                  required
                  value={advanceForm.date_issued}
                  onChange={(e) => {
                    const value = e.target.value;
                    setAdvanceForm((c) => ({
                      ...c,
                      date_issued: value,
                      deduct_payroll_month: c.deduct_payroll_month || value.slice(0, 7),
                    }));
                  }}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Deduct in Payroll Month
                </label>
                <input
                  type="month"
                  required
                  value={advanceForm.deduct_payroll_month}
                  onChange={(e) =>
                    setAdvanceForm((c) => ({
                      ...c,
                      deduct_payroll_month: e.target.value,
                    }))
                  }
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Paid From
                </label>
                <select
                  required
                  value={advanceForm.payment_account_id}
                  onChange={(e) =>
                    setAdvanceForm((c) => ({
                      ...c,
                      payment_account_id: e.target.value,
                    }))
                  }
                  className={inputClassName}
                >
                  <option value="">Select account</option>
                  {initialPaymentAccounts.map((account) => {
                    const summary = formatPaymentAccountSummary(account);
                    return (
                      <option key={account.id} value={account.id}>
                        {account.account_name}
                        {summary ? ` (${summary})` : ""}
                      </option>
                    );
                  })}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Approved By
                </label>
                <select
                  required
                  value={advanceForm.approved_by}
                  onChange={(e) =>
                    setAdvanceForm((c) => ({ ...c, approved_by: e.target.value }))
                  }
                  className={inputClassName}
                >
                  <option value="">Select approver</option>
                  {initialApprovers.map((approver) => (
                    <option key={approver.employee_id} value={approver.full_name}>
                      {approver.full_name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
            {advanceFormError ? (
              <p
                className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
                role="alert"
              >
                {advanceFormError}
              </p>
            ) : null}
            {!editingAdvanceId && advanceBulkCount > 0 ? (
              <div className="rounded-md border border-slate-200 bg-slate-50 p-4">
                <h4 className="mb-3 text-sm font-semibold text-[#0f2744]">
                  Review amounts
                </h4>
                <ul className="space-y-2">
                  {advanceForm.employee_ids.map((employeeId) => (
                    <li
                      key={employeeId}
                      className="flex flex-wrap items-center justify-between gap-3"
                    >
                      <span className="text-sm text-slate-700">
                        {getEmployeeDisplayName(initialEmployees, employeeId)}
                      </span>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        required
                        aria-label={`Advance amount for ${getEmployeeDisplayName(initialEmployees, employeeId)}`}
                        value={
                          advanceForm.perEmployeeAmounts[employeeId] ??
                          advanceForm.amount
                        }
                        onChange={(e) =>
                          setAdvanceForm((c) => ({
                            ...c,
                            perEmployeeAmounts: {
                              ...c.perEmployeeAmounts,
                              [employeeId]: e.target.value,
                            },
                          }))
                        }
                        className={`${inputClassName} w-36`}
                      />
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-sm text-slate-600">
                  Total:{" "}
                  <span className="font-medium text-[#0f2744]">
                    {formatGHS(advanceLiveTotal)}
                  </span>
                </p>
              </div>
            ) : null}
            <button
              type="submit"
              disabled={loading}
              className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white disabled:opacity-50"
            >
              {loading ? "Saving…" : editingAdvanceId ? "Save Changes" : "Save Advances"}
            </button>
          </form>
        </section>
      ) : null}

      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm font-medium text-slate-700">Type</label>
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value as RegisterRecordType)}
          className={inputClassName}
        >
          <option value="all">All</option>
          <option value="loan">Loan</option>
          <option value="advance">Salary Advance</option>
        </select>
        <FilteredListCount
          filteredCount={filteredRows.length}
          totalCount={combinedRows.length}
          itemSingular="entry"
          hasActiveFilters={typeFilter !== "all"}
        />
      </div>

      <ScrollableTable>
        <table className={scrollableTableClassName}>
          <thead className={scrollableTableHeadClassName}>
            <tr>
              <th className={scrollableTableThClassName}>Type</th>
              <th className={scrollableTableThClassName}>Date Issued</th>
              <th className={scrollableTableThClassName}>Employee</th>
              <th className={scrollableTableThClassName}>Reference</th>
              <th className={scrollableTableThClassName}>Amount</th>
              <th className={scrollableTableThClassName}>Deduct Month</th>
              <th className={scrollableTableThClassName}>Status</th>
              <th className={scrollableTableThClassName}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {filteredRows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                  No entries yet.
                </td>
              </tr>
            ) : (
              filteredRows.map((row, index) => {
                if (row.kind === "loan") {
                  const entry = row.entry;
                  const outstanding =
                    entry.outstanding_balance ??
                    calculateLoanOutstanding(
                      entry.loan_amount,
                      entry.total_repaid_to_date ?? 0,
                    );
                  return (
                    <tr key={row.key} className={getStripedRowClassName(index)}>
                      <td className="px-4 py-3">Loan</td>
                      <td className="px-4 py-3">{formatDate(entry.date_issued)}</td>
                      <td className="px-4 py-3">
                        {getEmployeeDisplayName(initialEmployees, entry.employee_id)}
                      </td>
                      <td className="px-4 py-3">{entry.loan_id}</td>
                      <td className="px-4 py-3">{formatGHS(entry.loan_amount)}</td>
                      <td className="px-4 py-3">—</td>
                      <td className="px-4 py-3">
                        <LoanStatusBadge outstandingBalance={outstanding} />
                      </td>
                      <RegisterRowActions
                        onEdit={() => {
                          setFormKind("loan");
                          setEditingLoanId(entry.loan_id);
                          setLoanForm({
                            employee_id: entry.employee_id,
                            loan_amount: String(entry.loan_amount),
                            date_issued: toDateInputValue(entry.date_issued),
                            repayment_period_months: String(entry.repayment_period_months),
                            monthly_deduction: String(entry.monthly_deduction),
                            total_repaid_to_date:
                              entry.total_repaid_to_date === null
                                ? ""
                                : String(entry.total_repaid_to_date),
                          });
                          setShowForm(true);
                        }}
                        onDelete={() => handleDeleteLoan(entry.loan_id)}
                        deleting={deletingId === entry.loan_id}
                      />
                    </tr>
                  );
                }

                const entry = row.entry;
                const blocked = entry.status === "deducted";
                const blockReason =
                  "This advance was already deducted on payroll and cannot be changed.";
                return (
                  <tr key={row.key} className={getStripedRowClassName(index)}>
                    <td className="px-4 py-3">Salary Advance</td>
                    <td className="px-4 py-3">{formatDate(entry.date_issued)}</td>
                    <td className="px-4 py-3">
                      {getEmployeeDisplayName(initialEmployees, entry.employee_id)}
                    </td>
                    <td className="px-4 py-3">{entry.advance_id}</td>
                    <td className="px-4 py-3">{formatGHS(entry.amount)}</td>
                    <td className="px-4 py-3">
                      {formatDate(entry.deduct_payroll_month)}
                    </td>
                    <td className="px-4 py-3">
                      {formatSalaryAdvanceStatus(entry.status)}
                    </td>
                    <RegisterRowActions
                      onEdit={() => openEditAdvance(entry)}
                      onDelete={() => handleDeleteAdvance(entry.advance_id)}
                      deleting={deletingId === entry.advance_id}
                      disableEdit={blocked}
                      disableDelete={blocked}
                      editDisabledTitle={blockReason}
                      deleteDisabledTitle={blockReason}
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
