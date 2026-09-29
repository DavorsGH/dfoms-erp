"use client";

import Link from "next/link";
import { getStripedRowClassName } from "@/app/dashboard/finance/register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableRegisterDateCellClassName,
  scrollableTableRegisterIdCellClassName,
  scrollableTableThClassName,
} from "@/app/dashboard/scrollable-table";
import FilteredListCount from "@/app/dashboard/filtered-list-count";
import TruncatedCell, {
  registerTruncatedCellHostClassName,
} from "@/app/dashboard/register-truncated-cell";
import {
  formatInvoiceDate,
  formatInvoiceMoney,
  formatSupplierContractStatus,
  isSupplierContractRenewalDue,
  resolveSupplierContractDisplayStatus,
  supplierContractDisplayStatusBadgeClassName,
  type SupplierContractListRow,
} from "@/utils/supplier-contracts-types";

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButtonClassName =
  "rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

const renewalBadgeClassName =
  "ml-2 inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800";

type Props = {
  contracts: SupplierContractListRow[];
  fetchError?: string | null;
};

export default function SupplierContractsList({ contracts, fetchError }: Props) {
  return (
    <div className="space-y-6">
      {fetchError ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {fetchError}
        </p>
      ) : null}

      <div className="flex justify-end">
        <Link
          href="/dashboard/finance/supplier-contracts/new"
          className={primaryButtonClassName}
        >
          New Supplier Contract
        </Link>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <FilteredListCount
          filteredCount={contracts.length}
          totalCount={contracts.length}
          itemSingular="supplier contract"
        />
        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={scrollableTableThClassName}>Contract #</th>
                <th className={scrollableTableThClassName}>Supplier</th>
                <th className={scrollableTableThClassName}>Status</th>
                <th className={scrollableTableThClassName}>Next Billing</th>
                <th className={scrollableTableThClassName}>End Date</th>
                <th className={scrollableTableThClassName}>Amount</th>
                <th className={scrollableTableThClassName}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {contracts.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-4 py-8 text-center text-slate-500">
                    No supplier contracts yet.
                  </td>
                </tr>
              ) : (
                contracts.map((row, index) => {
                  const displayStatus = resolveSupplierContractDisplayStatus({
                    status: row.status,
                    end_date: row.end_date,
                  });
                  const renewalDue = isSupplierContractRenewalDue(row.end_date);

                  return (
                    <tr key={row.id} className={getStripedRowClassName(index)}>
                      <td
                        className={`font-medium text-[#0f2744] ${scrollableTableRegisterIdCellClassName}`}
                      >
                        {row.contract_number}
                      </td>
                      <td
                        className={`px-4 py-3 ${registerTruncatedCellHostClassName}`}
                      >
                        <TruncatedCell>{row.supplier_name}</TruncatedCell>
                      </td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${supplierContractDisplayStatusBadgeClassName(displayStatus)}`}
                        >
                          {displayStatus === "Renewal Due"
                            ? displayStatus
                            : formatSupplierContractStatus(row.status)}
                        </span>
                      </td>
                      <td className={scrollableTableRegisterDateCellClassName}>
                        {row.next_billing_date
                          ? formatInvoiceDate(row.next_billing_date)
                          : "—"}
                      </td>
                      <td className={scrollableTableRegisterDateCellClassName}>
                        {formatInvoiceDate(row.end_date)}
                        {renewalDue ? (
                          <span className={renewalBadgeClassName}>Renewal due</span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        {row.current_monthly_amount == null
                          ? "—"
                          : formatInvoiceMoney(row.current_monthly_amount)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="inline-flex flex-nowrap items-center gap-2">
                          <Link
                            href={`/dashboard/finance/supplier-contracts/${row.id}`}
                            className={secondaryButtonClassName}
                          >
                            View
                          </Link>
                          <Link
                            href={`/dashboard/finance/supplier-contracts/${row.id}#supplier-contract-edit`}
                            className={secondaryButtonClassName}
                          >
                            Edit
                          </Link>
                        </div>
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
