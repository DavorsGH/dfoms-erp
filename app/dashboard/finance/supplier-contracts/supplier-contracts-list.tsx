"use client";

import Link from "next/link";
import {
  formatInvoiceDate,
  formatSupplierContractStatus,
  isSupplierContractRenewalDue,
  supplierContractStatusBadgeClassName,
  type SupplierContractListRow,
} from "@/utils/supplier-contracts-types";

const primaryBtn =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white hover:bg-[#1a3a5c] disabled:opacity-50";

type Props = {
  contracts: SupplierContractListRow[];
  fetchError?: string | null;
};

export default function SupplierContractsList({ contracts, fetchError }: Props) {
  return (
    <div className="space-y-4">
      {fetchError ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {fetchError}
        </p>
      ) : null}
      <div className="flex justify-end">
        <Link href="/dashboard/finance/supplier-contracts/new" className={primaryBtn}>
          New supplier contract
        </Link>
      </div>
      <div className="overflow-x-auto rounded-lg border border-slate-200">
        <table className="min-w-full text-sm">
          <thead className="bg-slate-50 text-left">
            <tr>
              <th className="px-4 py-2">Contract</th>
              <th className="px-4 py-2">Supplier</th>
              <th className="px-4 py-2">Status</th>
              <th className="px-4 py-2">Next billing</th>
            </tr>
          </thead>
          <tbody>
            {contracts.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-8 text-center text-slate-500">
                  No supplier contracts yet.
                </td>
              </tr>
            ) : (
              contracts.map((row) => (
                <tr key={row.id} className="border-t border-slate-100">
                  <td className="px-4 py-2">
                    <Link
                      href={`/dashboard/finance/supplier-contracts/${row.id}`}
                      className="font-medium text-[#0f2744] hover:underline"
                    >
                      {row.contract_number}
                    </Link>
                  </td>
                  <td className="px-4 py-2">{row.supplier_name}</td>
                  <td className="px-4 py-2">
                    <span
                      className={`inline-flex rounded-full border px-2 py-0.5 text-xs ${supplierContractStatusBadgeClassName(row.status)}`}
                    >
                      {formatSupplierContractStatus(row.status)}
                    </span>
                    {isSupplierContractRenewalDue(row.end_date) ? (
                      <span className="ml-2 rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs text-amber-800">
                        Renewal Due
                      </span>
                    ) : null}
                  </td>
                  <td className="px-4 py-2">
                    {row.next_billing_date
                      ? formatInvoiceDate(row.next_billing_date)
                      : "—"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
