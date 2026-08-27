"use client";

import { getStripedRowClassName } from "@/app/dashboard/finance/register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "@/app/dashboard/scrollable-table";
import {
  formatInvoiceMoney,
  type ServiceContractLineItemRow,
} from "@/utils/service-contracts-types";

type ServiceContractRateCardProps = {
  lineItems: ServiceContractLineItemRow[];
  subtotal: number;
  totalAmountDue: number;
  className?: string;
};

export default function ServiceContractRateCard({
  lineItems,
  subtotal,
  totalAmountDue,
  className = "space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm",
}: ServiceContractRateCardProps) {
  return (
    <section className={className}>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-sm font-medium text-slate-700">Rate Card</h3>
          <p className="mt-1 text-xs text-slate-500">
            Contract pricing summary for recurring billing.
          </p>
        </div>
        <div className="text-right text-sm text-slate-600">
          <p>Subtotal: {formatInvoiceMoney(subtotal)}</p>
          <p className="font-semibold text-[#0f2744]">
            Total per cycle: {formatInvoiceMoney(totalAmountDue)}
          </p>
        </div>
      </div>

      {lineItems.length === 0 ? (
        <p className="text-sm text-slate-500">No rate card lines defined.</p>
      ) : (
        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={scrollableTableThClassName}>Category</th>
                <th className={scrollableTableThClassName}>Description</th>
                <th className={scrollableTableThClassName}>Service</th>
                <th className={scrollableTableThClassName}>Material</th>
                <th className={scrollableTableThClassName}>Discount</th>
                <th className={scrollableTableThClassName}>Taxed</th>
                <th className={scrollableTableThClassName}>Line Total</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200 bg-white text-slate-900">
              {lineItems.map((line, index) => (
                <tr key={line.id} className={getStripedRowClassName(index)}>
                  <td className="px-4 py-3">{line.category_label?.trim() || "General"}</td>
                  <td className="px-4 py-3">{line.description}</td>
                  <td className="px-4 py-3">{formatInvoiceMoney(line.labour_amount)}</td>
                  <td className="px-4 py-3">{formatInvoiceMoney(line.material_amount)}</td>
                  <td className="px-4 py-3">{formatInvoiceMoney(line.discount_amount)}</td>
                  <td className="px-4 py-3">{line.taxed ? "Yes" : "No"}</td>
                  <td className="px-4 py-3 font-medium">{formatInvoiceMoney(line.total_cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </ScrollableTable>
      )}
    </section>
  );
}
