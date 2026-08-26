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
import ListRowStatusActionsMenu, {
  type ListRowStatusActionItem,
} from "@/components/list-row-status-actions-menu";
import {
  formatInvoiceDate,
  formatInvoiceMoney,
  formatQuotationDocumentType,
  formatQuotationStatus,
  formatQuotationType,
  normalizeClientQuotationListRow,
  resolveConvertedInvoiceLink,
  resolveRaisedContractLink,
  type ClientQuotationListRow,
} from "@/utils/client-quotations-types";
import type { ActiveServiceContractSummary } from "@/utils/service-contracts-api";

type ClientQuotationsListProps = {
  initialQuotations: ClientQuotationListRow[];
  fetchError: string | null;
  activeContractByClientId?: Record<string, ActiveServiceContractSummary>;
};

type QuotationStatusAction = "send" | "accept" | "decline" | "raise-contract" | "convert";

type PendingQuotationAction = {
  quotationId: string;
  action: QuotationStatusAction;
  label: string;
  confirmMessage: string;
};

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButtonClassName =
  "rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

const actionButtonClassName =
  "rounded-md border border-emerald-700 px-3 py-1.5 text-sm font-medium text-emerald-800 transition-colors hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50";

const statusMenuButtonClassName =
  "rounded-md border border-emerald-700 px-3 py-1.5 text-sm font-medium text-emerald-800 transition-colors hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50";

const traceabilityBadgeClassName =
  "inline-flex items-center rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-0.5 text-xs font-medium text-emerald-800 hover:bg-emerald-100";

const contractTraceabilityBadgeClassName =
  "inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-2.5 py-0.5 text-xs font-medium text-violet-800 hover:bg-violet-100";

const dangerButtonClassName =
  "rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50";

function getQuotationStatusActions(
  quotation: ClientQuotationListRow,
  activeContractByClientId: Record<string, ActiveServiceContractSummary> = {},
): ListRowStatusActionItem<QuotationStatusAction>[] {
  if (quotation.status === "draft") {
    return [
      {
        action: "send",
        label: "Send",
        confirmMessage: `Mark ${quotation.quotation_number} as Sent?`,
      },
    ];
  }

  if (quotation.status === "sent") {
    return [
      {
        action: "accept",
        label: "Accept",
        confirmMessage: `Mark ${quotation.quotation_number} as Accepted?`,
      },
      {
        action: "decline",
        label: "Decline",
        confirmMessage: `Mark ${quotation.quotation_number} as Declined?`,
      },
    ];
  }

  if (quotation.status === "accepted") {
    const actions: ListRowStatusActionItem<QuotationStatusAction>[] = [];

    if (!quotation.contract_id && !activeContractByClientId[quotation.client_id]) {
      actions.push({
        action: "raise-contract",
        label: "Raise Contract",
        confirmMessage: `Raise a service contract from ${quotation.quotation_number}?`,
      });
    }

    if (!quotation.converted_invoice_id) {
      actions.push({
        action: "convert",
        label: "Convert to Invoice",
        confirmMessage: `Convert ${quotation.quotation_number} to a customer invoice?`,
      });
    }

    return actions;
  }

  return [];
}

export default function ClientQuotationsList({
  initialQuotations,
  fetchError,
  activeContractByClientId = {},
}: ClientQuotationsListProps) {
  const router = useRouter();
  const [quotations, setQuotations] = useState(
    initialQuotations.map(normalizeClientQuotationListRow),
  );
  const [error, setError] = useState<string | null>(fetchError);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmingDeleteId, setConfirmingDeleteId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingQuotationAction | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);

  function updateQuotationInList(next: ClientQuotationListRow) {
    setQuotations((current) =>
      current.map((entry) =>
        entry.id === next.id ? normalizeClientQuotationListRow(next) : entry,
      ),
    );
  }

  async function handleDelete(quotation: ClientQuotationListRow) {
    setConfirmingDeleteId(null);
    setDeletingId(quotation.id);
    setError(null);

    try {
      const response = await fetch(`/api/client-quotations/${quotation.id}`, {
        method: "DELETE",
      });

      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;

      if (!response.ok) {
        setError(payload?.error ?? "Unable to delete quotation.");
        return;
      }

      setQuotations((current) =>
        current.filter((entry) => entry.id !== quotation.id),
      );
      router.refresh();
    } catch {
      setError("Unable to delete quotation. Check your connection and try again.");
    } finally {
      setDeletingId(null);
    }
  }

  async function executePendingAction() {
    if (!pendingAction) {
      return;
    }

    const { quotationId, action } = pendingAction;
    setActingId(quotationId);
    setError(null);

    try {
      if (action === "raise-contract") {
        const response = await fetch(
          `/api/client-quotations/${quotationId}/raise-contract`,
          { method: "POST" },
        );
        const payload = (await response.json().catch(() => null)) as
          | { service_contract?: { id: string }; error?: string }
          | null;

        if (!response.ok || !payload?.service_contract?.id) {
          setError(payload?.error ?? "Unable to raise contract.");
          return;
        }

        setPendingAction(null);
        router.push(
          `/dashboard/finance/service-contracts/${payload.service_contract.id}/edit`,
        );
        router.refresh();
        return;
      }

      if (action === "convert") {
        const response = await fetch(`/api/client-quotations/${quotationId}/convert`, {
          method: "POST",
        });
        const payload = (await response.json().catch(() => null)) as
          | { client_invoice?: ClientQuotationListRow & { id: string }; error?: string }
          | null;

        if (!response.ok || !payload?.client_invoice?.id) {
          setError(payload?.error ?? "Unable to convert quotation.");
          return;
        }

        setPendingAction(null);
        router.push(`/dashboard/finance/client-invoices/${payload.client_invoice.id}`);
        router.refresh();
        return;
      }

      const statusMap = {
        send: "sent",
        accept: "accepted",
        decline: "declined",
      } as const;

      const response = await fetch(`/api/client-quotations/${quotationId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: statusMap[action] }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { client_quotation?: ClientQuotationListRow; error?: string }
        | null;

      if (!response.ok || !payload?.client_quotation) {
        setError(payload?.error ?? "Unable to update quotation status.");
        return;
      }

      updateQuotationInList(payload.client_quotation);
      setPendingAction(null);
      router.refresh();
    } catch {
      setError("Unable to complete action. Check your connection and try again.");
    } finally {
      setActingId(null);
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
          href="/dashboard/sales-crm/quotations/new"
          className={primaryButtonClassName}
        >
          New Quotation
        </Link>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <FilteredListCount
          filteredCount={quotations.length}
          totalCount={quotations.length}
          itemSingular="quotation"
          className="mb-4"
        />

        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={scrollableTableThClassName}>Quotation #</th>
                <th className={scrollableTableThClassName}>Document Type</th>
                <th className={scrollableTableThClassName}>Quotation Type</th>
                <th className={scrollableTableThClassName}>Customer</th>
                <th className={scrollableTableThClassName}>Issue Date</th>
                <th className={scrollableTableThClassName}>Valid Until</th>
                <th className={scrollableTableThClassName}>Total Due</th>
                <th className={scrollableTableThClassName}>Status</th>
                <th className={scrollableTableThClassName}>Links</th>
                <th className={scrollableTableThClassName}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {quotations.length === 0 ? (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-sm text-slate-500">
                    No quotations yet.
                  </td>
                </tr>
              ) : (
                quotations.map((quotation, index) => {
                  const clientName = Array.isArray(quotation.client)
                    ? quotation.client[0]?.client_name
                    : quotation.client?.client_name;
                  const isConverted = Boolean(quotation.converted_invoice_id);
                  const convertedInvoice = resolveConvertedInvoiceLink(quotation);
                  const raisedContract = resolveRaisedContractLink(quotation);
                  const customerActiveContract = activeContractByClientId[quotation.client_id];
                  const raiseContractBlocked =
                    quotation.status === "accepted" &&
                    !quotation.contract_id &&
                    Boolean(customerActiveContract);

                  return (
                    <tr key={quotation.id} className={getStripedRowClassName(index)}>
                      <td className="px-4 py-3 font-medium text-[#0f2744]">
                        {quotation.quotation_number}
                      </td>
                      <td className="px-4 py-3">
                        {formatQuotationDocumentType(quotation.document_type)}
                      </td>
                      <td className="px-4 py-3">
                        {formatQuotationType(quotation.quotation_type)}
                      </td>
                      <td className="px-4 py-3">{clientName ?? quotation.client_id}</td>
                      <td className="px-4 py-3">
                        {formatInvoiceDate(quotation.issue_date)}
                      </td>
                      <td className="px-4 py-3">
                        {formatInvoiceDate(quotation.valid_until)}
                      </td>
                      <td className="px-4 py-3">
                        {formatInvoiceMoney(quotation.total_amount_due)}
                      </td>
                      <td className="px-4 py-3">
                        {formatQuotationStatus(quotation.status)}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          {raisedContract ? (
                            <Link
                              href={`/dashboard/finance/service-contracts/${raisedContract.id}`}
                              className={contractTraceabilityBadgeClassName}
                            >
                              Contract Raised → {raisedContract.contract_number}
                            </Link>
                          ) : null}
                          {convertedInvoice ? (
                            <Link
                              href={`/dashboard/finance/client-invoices/${convertedInvoice.id}`}
                              className={traceabilityBadgeClassName}
                            >
                              Converted → {convertedInvoice.invoice_number}
                            </Link>
                          ) : null}
                          {raiseContractBlocked && customerActiveContract ? (
                            <span
                              className="text-xs text-amber-800"
                              title={`This customer already has active contract ${customerActiveContract.contract_number}. Raise Contract is disabled to prevent duplicate billing.`}
                            >
                              Active contract {customerActiveContract.contract_number} — Raise
                              Contract disabled
                            </span>
                          ) : null}
                          {!raisedContract && !convertedInvoice && !raiseContractBlocked ? (
                            <span className="text-sm text-slate-500">—</span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="inline-flex flex-nowrap items-center gap-2">
                          <Link
                            href={`/dashboard/sales-crm/quotations/${quotation.id}`}
                            className={secondaryButtonClassName}
                          >
                            View
                          </Link>
                          {!isConverted ? (
                            <Link
                              href={`/dashboard/sales-crm/quotations/${quotation.id}/edit`}
                              className={secondaryButtonClassName}
                            >
                              Edit
                            </Link>
                          ) : null}
                          {!isConverted ? (
                            confirmingDeleteId === quotation.id ? (
                              <span className="inline-flex flex-nowrap items-center gap-2 whitespace-nowrap">
                                <span className="text-sm text-red-700">
                                  Delete {quotation.quotation_number}?
                                </span>
                                <button
                                  type="button"
                                  onClick={() => void handleDelete(quotation)}
                                  className={dangerButtonClassName}
                                >
                                  Yes, delete
                                </button>
                                <button
                                  type="button"
                                  onClick={() => setConfirmingDeleteId(null)}
                                  className={secondaryButtonClassName}
                                >
                                  Cancel
                                </button>
                              </span>
                            ) : (
                              <button
                                type="button"
                                onClick={() => {
                                  setError(null);
                                  setPendingAction(null);
                                  setConfirmingDeleteId(quotation.id);
                                }}
                                disabled={deletingId === quotation.id}
                                className={dangerButtonClassName}
                              >
                                {deletingId === quotation.id ? "Deleting…" : "Delete"}
                              </button>
                            )
                          ) : null}
                          {pendingAction?.quotationId === quotation.id ? (
                            <span className="inline-flex flex-nowrap items-center gap-2 whitespace-nowrap">
                              <span className="text-sm text-slate-700">
                                {pendingAction.confirmMessage}
                              </span>
                              <button
                                type="button"
                                onClick={() => void executePendingAction()}
                                disabled={actingId === quotation.id}
                                className={actionButtonClassName}
                              >
                                {actingId === quotation.id ? "Working…" : "Confirm"}
                              </button>
                              <button
                                type="button"
                                onClick={() => setPendingAction(null)}
                                disabled={actingId === quotation.id}
                                className={secondaryButtonClassName}
                              >
                                Cancel
                              </button>
                            </span>
                          ) : (
                            <ListRowStatusActionsMenu
                              items={getQuotationStatusActions(
                                quotation,
                                activeContractByClientId,
                              )}
                              disabled={actingId === quotation.id}
                              buttonClassName={statusMenuButtonClassName}
                              onSelect={(item) => {
                                setError(null);
                                setConfirmingDeleteId(null);
                                setPendingAction({
                                  quotationId: quotation.id,
                                  action: item.action,
                                  label: item.label,
                                  confirmMessage: item.confirmMessage,
                                });
                              }}
                            />
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
