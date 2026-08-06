"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import SalesRepSelect from "@/components/sales-rep-select";
import { getStripedRowClassName } from "@/app/dashboard/finance/register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "@/app/dashboard/scrollable-table";
import type { HrEmployee } from "@/app/dashboard/hr-payroll/employee-utils";
import { SALES_OPPORTUNITY_SELECT } from "../sales-pipeline/sales-pipeline-utils";
import {
  SALES_TARGET_LIST_SELECT,
  normalizeSalesTargetRow,
  type SalesTargetListRow,
} from "@/utils/sales-targets-types";
import {
  buildForecastMonthBuckets,
  defaultForecastRange,
  formatForecastMoney,
  type ForecastInvoiceRow,
  type ForecastOpportunityRow,
  type ForecastProductSaleRow,
} from "@/utils/sales-forecast-utils";

type SalesForecastViewProps = {
  initialEmployees: HrEmployee[];
  defaultEmployeeId?: string;
  fetchError: string | null;
};

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50";

export default function SalesForecastView({
  initialEmployees,
  defaultEmployeeId = "",
  fetchError,
}: SalesForecastViewProps) {
  const supabase = createClient();
  const defaultRange = defaultForecastRange();
  const [employeeId, setEmployeeId] = useState(defaultEmployeeId);
  const [rangeStart, setRangeStart] = useState(defaultRange.start);
  const [rangeEnd, setRangeEnd] = useState(defaultRange.end);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(fetchError);
  const [opportunities, setOpportunities] = useState<ForecastOpportunityRow[]>([]);
  const [productSales, setProductSales] = useState<ForecastProductSaleRow[]>([]);
  const [invoices, setInvoices] = useState<ForecastInvoiceRow[]>([]);
  const [targets, setTargets] = useState<SalesTargetListRow[]>([]);

  async function loadForecastData() {
    if (!employeeId.trim()) {
      setError("Select an employee to view forecast.");
      return;
    }

    setLoading(true);
    setError(null);

    const [
      { data: opportunityRows, error: opportunitiesError },
      { data: productSaleRows, error: productSalesError },
      { data: invoiceRows, error: invoicesError },
      { data: targetRows, error: targetsError },
    ] = await Promise.all([
      supabase
        .from("sales_opportunities")
        .select(`${SALES_OPPORTUNITY_SELECT}`)
        .eq("assigned_to", employeeId.trim())
        .gte("expected_close_date", rangeStart)
        .lte("expected_close_date", rangeEnd),
      supabase
        .from("income_register")
        .select("date, amount, sale_status")
        .eq("entry_type", "product_sale")
        .eq("sales_rep_id", employeeId.trim())
        .gte("date", rangeStart)
        .lte("date", rangeEnd),
      supabase
        .from("client_invoices")
        .select("invoice_date, total_amount_due, status")
        .eq("sales_rep_id", employeeId.trim())
        .gte("invoice_date", rangeStart)
        .lte("invoice_date", rangeEnd),
      supabase
        .from("sales_targets")
        .select(SALES_TARGET_LIST_SELECT)
        .eq("employee_id", employeeId.trim())
        .lte("period_start", rangeEnd)
        .gte("period_end", rangeStart),
    ]);

    const fetchErrorMessage =
      opportunitiesError?.message ??
      productSalesError?.message ??
      invoicesError?.message ??
      targetsError?.message ??
      null;

    if (fetchErrorMessage) {
      setError(fetchErrorMessage);
      setLoading(false);
      return;
    }

    setOpportunities((opportunityRows as ForecastOpportunityRow[] | null) ?? []);
    setProductSales((productSaleRows as ForecastProductSaleRow[] | null) ?? []);
    setInvoices((invoiceRows as ForecastInvoiceRow[] | null) ?? []);
    setTargets(
      ((targetRows as SalesTargetListRow[] | null) ?? []).map(normalizeSalesTargetRow),
    );
    setLoading(false);
  }

  useEffect(() => {
    if (employeeId.trim()) {
      void loadForecastData();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const buckets = useMemo(
    () =>
      buildForecastMonthBuckets({
        opportunities,
        productSales,
        invoices,
        targets,
        rangeStart,
        rangeEnd,
      }),
    [opportunities, productSales, invoices, targets, rangeStart, rangeEnd],
  );

  const totals = useMemo(
    () =>
      buckets.reduce(
        (acc, bucket) => ({
          pipelineWeighted: acc.pipelineWeighted + bucket.pipelineWeighted,
          actualRevenue: acc.actualRevenue + bucket.actualRevenue,
          targetRevenue: acc.targetRevenue + (bucket.targetRevenue ?? 0),
        }),
        { pipelineWeighted: 0, actualRevenue: 0, targetRevenue: 0 },
      ),
    [buckets],
  );

  return (
    <div className="space-y-6">
      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-600">
          Pipeline-weighted forecast uses open opportunities (estimated value ×
          probability). Actual revenue combines product sales and invoiced amounts
          attributed to the selected sales rep.
        </p>
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
              Range Start
            </label>
            <input
              type="date"
              value={rangeStart}
              onChange={(event) => setRangeStart(event.target.value)}
              className={inputClassName}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Range End
            </label>
            <input
              type="date"
              value={rangeEnd}
              onChange={(event) => setRangeEnd(event.target.value)}
              className={inputClassName}
            />
          </div>
          <div className="flex items-end">
            <button
              type="button"
              disabled={loading}
              onClick={() => void loadForecastData()}
              className={primaryButtonClassName}
            >
              {loading ? "Loading…" : "Refresh Forecast"}
            </button>
          </div>
        </div>
      </section>

      <section className="grid gap-4 md:grid-cols-3">
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Pipeline Weighted
          </p>
          <p className="mt-2 text-2xl font-semibold text-[#0f2744]">
            {formatForecastMoney(totals.pipelineWeighted)}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Actual Revenue
          </p>
          <p className="mt-2 text-2xl font-semibold text-[#0f2744]">
            {formatForecastMoney(totals.actualRevenue)}
          </p>
        </div>
        <div className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <p className="text-xs uppercase tracking-wide text-slate-500">
            Target Revenue
          </p>
          <p className="mt-2 text-2xl font-semibold text-[#0f2744]">
            {formatForecastMoney(totals.targetRevenue)}
          </p>
        </div>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={scrollableTableThClassName}>Month</th>
                <th className={scrollableTableThClassName}>Pipeline Weighted</th>
                <th className={scrollableTableThClassName}>Actual Revenue</th>
                <th className={scrollableTableThClassName}>Target</th>
                <th className={scrollableTableThClassName}>Gap vs Target</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {buckets.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-sm text-slate-500">
                    Select an employee and refresh to load forecast data.
                  </td>
                </tr>
              ) : (
                buckets.map((bucket, index) => {
                  const gap =
                    bucket.targetRevenue == null
                      ? null
                      : bucket.actualRevenue - bucket.targetRevenue;

                  return (
                    <tr key={bucket.monthKey} className={getStripedRowClassName(index)}>
                      <td className="px-4 py-3 text-sm">{bucket.monthLabel}</td>
                      <td className="px-4 py-3 text-sm">
                        {formatForecastMoney(bucket.pipelineWeighted)}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {formatForecastMoney(bucket.actualRevenue)}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {bucket.targetRevenue == null
                          ? "—"
                          : formatForecastMoney(bucket.targetRevenue)}
                      </td>
                      <td className="px-4 py-3 text-sm">
                        {gap == null ? "—" : formatForecastMoney(gap)}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </ScrollableTable>
      </section>
    </div>
  );
}
