"use client";

import { getStripedRowClassName } from "../../finance/register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../../scrollable-table";
import {
  formatSaleAmount,
  formatSaleDate,
  type CrmSaleEntry,
} from "./sales-utils";

type SalesProps = {
  initialSales: CrmSaleEntry[];
  fetchError: string | null;
};

export default function Sales({ initialSales, fetchError }: SalesProps) {
  return (
    <div className="min-w-0 space-y-6">
      <p className="text-sm text-slate-600">
        Sales are recorded automatically via payment webhooks. This view is
        read-only.
      </p>

      {fetchError ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {fetchError}
        </p>
      ) : null}

      <ScrollableTable>
        <table className={scrollableTableClassName}>
          <thead className={scrollableTableHeadClassName}>
            <tr>
              <th className={scrollableTableThClassName}>Sale Date</th>
              <th className={scrollableTableThClassName}>Customer</th>
              <th className={scrollableTableThClassName}>Product</th>
              <th className={scrollableTableThClassName}>Amount</th>
              <th className={scrollableTableThClassName}>Payment Status</th>
              <th className={scrollableTableThClassName}>Payment Method</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {initialSales.length === 0 ? (
              <tr>
                <td
                  colSpan={6}
                  className="px-4 py-8 text-center text-sm text-slate-500"
                >
                  No sales recorded yet.
                </td>
              </tr>
            ) : (
              initialSales.map((sale, index) => (
                <tr key={sale.id} className={getStripedRowClassName(index)}>
                  <td className="px-4 py-3">{formatSaleDate(sale.sale_date)}</td>
                  <td className="px-4 py-3 font-medium text-[#0f2744]">
                    {sale.customer_name}
                  </td>
                  <td className="px-4 py-3">{sale.product_name}</td>
                  <td className="px-4 py-3">{formatSaleAmount(sale.amount)}</td>
                  <td className="px-4 py-3">{sale.payment_status ?? "—"}</td>
                  <td className="px-4 py-3">{sale.payment_method ?? "—"}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </ScrollableTable>
    </div>
  );
}
