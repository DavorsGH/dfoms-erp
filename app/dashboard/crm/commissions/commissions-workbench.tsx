"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import SalesRepSelect from "@/components/sales-rep-select";
import { getStripedRowClassName } from "@/app/dashboard/finance/register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "@/app/dashboard/scrollable-table";
import type { HrEmployee } from "@/app/dashboard/hr-payroll/employee-utils";
import {
  COMMISSION_CALCULATION_LIST_SELECT,
  commissionStatusBadgeClassName,
  formatCommissionEmployee,
  formatCommissionMoney,
  formatCommissionPeriod,
  formatCommissionRate,
  formatCommissionStatus,
  normalizeCommissionCalculationRow,
  type CommissionCalculationRow,
  type CommissionStatus,
} from "@/utils/commission-types";

type CommissionsWorkbenchProps = {
  initialEmployees: HrEmployee[];
  defaultEmployeeId?: string;
  initialCalculations: CommissionCalculationRow[];
  fetchError: string | null;
};

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButtonClassName =
  "rounded-md border border-[#0f2744] px-3 py-1.5 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

function monthStartIsoDate(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), 1).toISOString().slice(0, 10);
}

function monthEndIsoDate(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth() + 1, 0).toISOString().slice(0, 10);
}

export default function CommissionsWorkbench({
  initialEmployees,
  defaultEmployeeId = "",
  initialCalculations,
  fetchError,
}: CommissionsWorkbenchProps) {
  const supabase = createClient();
  const [employeeId, setEmployeeId] = useState(defaultEmployeeId);
  const [periodStart, setPeriodStart] = useState(monthStartIsoDate());
  const [periodEnd, setPeriodEnd] = useState(monthEndIsoDate());
  const [calculations, setCalculations] = useState(
    initialCalculations.map(normalizeCommissionCalculationRow),
  );
  const [selectedCalculation, setSelectedCalculation] =
    useState<CommissionCalculationRow | null>(null);
  const [error, setError] = useState<string | null>(fetchError);
  const [loading, setLoading] = useState(false);
  const [statusUpdatingId, setStatusUpdatingId] = useState<string | null>(null);

  useEffect(() => {
    setCalculations(initialCalculations.map(normalizeCommissionCalculationRow));
  }, [initialCalculations]);

  async function refreshCalculations() {
    const { data, error: listError } = await supabase
      .from("commission_calculations")
      .select(COMMISSION_CALCULATION_LIST_SELECT)
      .order("calculated_at", { ascending: false });

    if (listError) {
      setError(listError.message);
      return;
    }

    setCalculations(
      ((data as CommissionCalculationRow[] | null) ?? []).map(
        normalizeCommissionCalculationRow,
      ),
    );
  }

  async function handleCalculate() {
    if (!employeeId.trim()) {
      setError("Select an employee.");
      return;
    }

    if (!periodStart.trim() || !periodEnd.trim()) {
      setError("Period start and end are required.");
      return;
    }

    setLoading(true);
    setError(null);

    const { data, error: rpcError } = await supabase.rpc("calculate_commission", {
      p_employee_id: employeeId.trim(),
      p_period_start: periodStart,
      p_period_end: periodEnd,
    });

    if (rpcError) {
      setError(rpcError.message);
      setLoading(false);
      return;
    }

    const calcId = typeof data === "string" ? data : null;
    await refreshCalculations();

    if (calcId) {
      const { data: calcRow } = await supabase
        .from("commission_calculations")
        .select(COMMISSION_CALCULATION_LIST_SELECT)
        .eq("id", calcId)
        .maybeSingle();

      if (calcRow) {
        setSelectedCalculation(normalizeCommissionCalculationRow(calcRow as CommissionCalculationRow));
      }
    }

    setLoading(false);
  }

  async function handleStatusChange(calcId: string, newStatus: CommissionStatus) {
    setStatusUpdatingId(calcId);
    setError(null);

    const { error: rpcError } = await supabase.rpc("set_commission_status", {
      p_calc_id: calcId,
      p_new_status: newStatus,
    });

    if (rpcError) {
      setError(rpcError.message);
      setStatusUpdatingId(null);
      return;
    }

    await refreshCalculations();

    if (selectedCalculation?.id === calcId) {
      const { data: calcRow } = await supabase
        .from("commission_calculations")
        .select(COMMISSION_CALCULATION_LIST_SELECT)
        .eq("id", calcId)
        .maybeSingle();

      if (calcRow) {
        setSelectedCalculation(normalizeCommissionCalculationRow(calcRow as CommissionCalculationRow));
      }
    }

    setStatusUpdatingId(null);
  }

  return (
    <div className="space-y-6">
      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-sm font-medium text-slate-700">Calculate Commission</h3>
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <SalesRepSelect
            employees={initialEmployees}
            value={employeeId}
            onChange={setEmployeeId}
            allowEmpty={false}
            emptyLabel="Select employee"
            className={inputClassName}
          />
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Period Start
            </label>
            <input
              type="date"
              value={periodStart}
              onChange={(event) => setPeriodStart(event.target.value)}
              className={inputClassName}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Period End
            </label>
            <input
              type="date"
              value={periodEnd}
              onChange={(event) => setPeriodEnd(event.target.value)}
              className={inputClassName}
            />
          </div>
          <div className="flex items-end">
            <button
              type="button"
              onClick={() => void handleCalculate()}
              disabled={loading}
              className={primaryButtonClassName}
            >
              {loading ? "Calculating…" : "Calculate"}
            </button>
          </div>
        </div>
      </section>

      {selectedCalculation ? (
        <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="text-sm font-medium text-slate-700">Latest Calculation Result</h3>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Employee</p>
              <p className="text-sm font-medium text-slate-900">
                {formatCommissionEmployee(initialEmployees, selectedCalculation)}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Period</p>
              <p className="text-sm font-medium text-slate-900">
                {formatCommissionPeriod(
                  selectedCalculation.period_start,
                  selectedCalculation.period_end,
                )}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Sales Revenue</p>
              <p className="text-sm font-medium text-slate-900">
                {formatCommissionMoney(selectedCalculation.total_sales_revenue)}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Rate Used</p>
              <p className="text-sm font-medium text-slate-900">
                {formatCommissionRate(selectedCalculation.commission_rate_used)}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Commission</p>
              <p className="text-sm font-medium text-slate-900">
                {formatCommissionMoney(selectedCalculation.commission_amount)}
              </p>
            </div>
            <div>
              <p className="text-xs uppercase tracking-wide text-slate-500">Status</p>
              <span
                className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${commissionStatusBadgeClassName(selectedCalculation.status)}`}
              >
                {formatCommissionStatus(selectedCalculation.status)}
              </span>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            {selectedCalculation.status === "pending" ? (
              <button
                type="button"
                disabled={statusUpdatingId === selectedCalculation.id}
                onClick={() =>
                  void handleStatusChange(selectedCalculation.id, "approved")
                }
                className={secondaryButtonClassName}
              >
                Approve
              </button>
            ) : null}
            {selectedCalculation.status === "approved" ? (
              <button
                type="button"
                disabled={statusUpdatingId === selectedCalculation.id}
                onClick={() => void handleStatusChange(selectedCalculation.id, "paid")}
                className={secondaryButtonClassName}
              >
                Mark Paid
              </button>
            ) : null}
          </div>
        </section>
      ) : null}

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="mb-4 text-sm font-medium text-slate-700">Previous Calculations</h3>
        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={scrollableTableThClassName}>Employee</th>
                <th className={scrollableTableThClassName}>Period</th>
                <th className={scrollableTableThClassName}>Revenue</th>
                <th className={scrollableTableThClassName}>Rate</th>
                <th className={scrollableTableThClassName}>Commission</th>
                <th className={scrollableTableThClassName}>Status</th>
                <th className={scrollableTableThClassName}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {calculations.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-sm text-slate-500">
                    No commission calculations yet.
                  </td>
                </tr>
              ) : (
                calculations.map((row, index) => (
                  <tr key={row.id} className={getStripedRowClassName(index)}>
                    <td className="px-4 py-3 text-sm">
                      {formatCommissionEmployee(initialEmployees, row)}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {formatCommissionPeriod(row.period_start, row.period_end)}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {formatCommissionMoney(row.total_sales_revenue)}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {formatCommissionRate(row.commission_rate_used)}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      {formatCommissionMoney(row.commission_amount)}
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <span
                        className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${commissionStatusBadgeClassName(row.status)}`}
                      >
                        {formatCommissionStatus(row.status)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-sm">
                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => setSelectedCalculation(row)}
                          className={secondaryButtonClassName}
                        >
                          View
                        </button>
                        {row.status === "pending" ? (
                          <button
                            type="button"
                            disabled={statusUpdatingId === row.id}
                            onClick={() => void handleStatusChange(row.id, "approved")}
                            className={secondaryButtonClassName}
                          >
                            Approve
                          </button>
                        ) : null}
                        {row.status === "approved" ? (
                          <button
                            type="button"
                            disabled={statusUpdatingId === row.id}
                            onClick={() => void handleStatusChange(row.id, "paid")}
                            className={secondaryButtonClassName}
                          >
                            Mark Paid
                          </button>
                        ) : null}
                      </div>
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
