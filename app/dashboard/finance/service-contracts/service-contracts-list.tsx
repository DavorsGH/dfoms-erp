"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { getStripedRowClassName } from "@/app/dashboard/finance/register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "@/app/dashboard/scrollable-table";
import FilteredListCount from "@/app/dashboard/filtered-list-count";
import {
  formatBillingFrequencyLabel,
  formatInvoiceDate,
  formatInvoiceMoney,
  formatServiceContractStatus,
  isContractExpiringWithinDays,
  normalizeServiceContractListRow,
  serviceContractStatusBadgeClassName,
  type ServiceContractListRow,
} from "@/utils/service-contracts-types";

type ServiceContractsListProps = {
  initialContracts: ServiceContractListRow[];
  fetchError: string | null;
};

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButtonClassName =
  "rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

const dangerButtonClassName =
  "rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50";

const expiryBadgeClassName =
  "ml-2 inline-flex items-center rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800";

export default function ServiceContractsList({
  initialContracts,
  fetchError,
}: ServiceContractsListProps) {
  const router = useRouter();
  const [contracts, setContracts] = useState(
    initialContracts.map(normalizeServiceContractListRow),
  );
  const [error, setError] = useState<string | null>(fetchError);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  async function handleDelete(contract: ServiceContractListRow) {
    setConfirmingId(null);
    setDeletingId(contract.id);
    setError(null);

    try {
      const response = await fetch(`/api/service-contracts/${contract.id}`, {
        method: "DELETE",
      });

      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;

      if (!response.ok) {
        setError(payload?.error ?? "Unable to delete service contract.");
        return;
      }

      setContracts((current) => current.filter((entry) => entry.id !== contract.id));
      router.refresh();
    } catch {
      setError("Unable to delete service contract. Check your connection and try again.");
    } finally {
      setDeletingId(null);
    }
  }

  return (
    <div className="space-y-6">
      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <div className="flex justify-end">
        <Link
          href="/dashboard/finance/service-contracts/new"
          className={primaryButtonClassName}
        >
          New Service Contract
        </Link>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <FilteredListCount
          filteredCount={contracts.length}
          totalCount={contracts.length}
          itemSingular="service contract"
        />
        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={scrollableTableThClassName}>Contract #</th>
                <th className={scrollableTableThClassName}>Customer</th>
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
                    No service contracts yet.
                  </td>
                </tr>
              ) : (
                contracts.map((contract, index) => {
                  const clientName = Array.isArray(contract.client)
                    ? contract.client[0]?.client_name
                    : contract.client?.client_name;
                  const expiringSoon = isContractExpiringWithinDays(contract.end_date);

                  return (
                    <tr key={contract.id} className={getStripedRowClassName(index)}>
                      <td className="px-4 py-3 font-medium text-[#0f2744]">
                        {contract.contract_number}
                      </td>
                      <td className="px-4 py-3">{clientName ?? contract.client_id}</td>
                      <td className="px-4 py-3">
                        <span
                          className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${serviceContractStatusBadgeClassName(contract.status)}`}
                        >
                          {formatServiceContractStatus(contract.status)}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        {formatInvoiceDate(contract.next_billing_date)}
                      </td>
                      <td className="px-4 py-3">
                        {formatInvoiceDate(contract.end_date)}
                        {expiringSoon ? (
                          <span className={expiryBadgeClassName}>Expiring soon</span>
                        ) : null}
                      </td>
                      <td className="px-4 py-3">
                        {formatInvoiceMoney(contract.total_amount_due)}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="inline-flex flex-nowrap items-center gap-2">
                          <Link
                            href={`/dashboard/finance/service-contracts/${contract.id}`}
                            className={secondaryButtonClassName}
                          >
                            View
                          </Link>
                          <Link
                            href={`/dashboard/finance/service-contracts/${contract.id}/edit`}
                            className={secondaryButtonClassName}
                          >
                            Edit
                          </Link>
                          {confirmingId === contract.id ? (
                            <span className="inline-flex flex-nowrap items-center gap-2 whitespace-nowrap">
                              <span className="text-sm text-red-700">
                                Delete {contract.contract_number}?
                              </span>
                              <button
                                type="button"
                                onClick={() => void handleDelete(contract)}
                                disabled={deletingId === contract.id}
                                className={dangerButtonClassName}
                              >
                                Yes, delete
                              </button>
                              <button
                                type="button"
                                onClick={() => setConfirmingId(null)}
                                className={secondaryButtonClassName}
                              >
                                Cancel
                              </button>
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => setConfirmingId(contract.id)}
                              disabled={deletingId === contract.id}
                              className={dangerButtonClassName}
                            >
                              Delete
                            </button>
                          )}
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
