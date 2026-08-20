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
  formatInvoiceStatus,
  normalizeClientInvoiceListRow,
  resolveSourceContractLink,
  resolveSourceQuotationLink,
  toNumber,
  type ClientInvoiceListRow,
} from "@/utils/client-invoices-types";
import RecordPaymentDialog from "./record-payment-dialog";

type ClientInvoicesListProps = {
  initialInvoices: ClientInvoiceListRow[];
  fetchError: string | null;
  paymentMethods: string[];
};

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButtonClassName =
  "rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

const dangerButtonClassName =
  "rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50";

const traceabilityBadgeClassName =
  "inline-flex items-center rounded-full border border-sky-200 bg-sky-50 px-2.5 py-0.5 text-xs font-medium text-sky-800 hover:bg-sky-100";

const contractTraceabilityBadgeClassName =
  "inline-flex items-center rounded-full border border-violet-200 bg-violet-50 px-2.5 py-0.5 text-xs font-medium text-violet-800 hover:bg-violet-100";

const actionButtonClassName =
  "rounded-md border border-emerald-700 px-3 py-1.5 text-sm font-medium text-emerald-800 transition-colors hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50";

const statusMenuButtonClassName =
  "rounded-md border border-emerald-700 px-3 py-1.5 text-sm font-medium text-emerald-800 transition-colors hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50";

type InvoiceStatusAction = "send" | "mark-paid";

type PendingInvoiceAction = {
  invoiceId: string;
  action: InvoiceStatusAction;
  label: string;
  confirmMessage: string;
};

function getInvoiceStatusActions(
  invoice: ClientInvoiceListRow,
): ListRowStatusActionItem<InvoiceStatusAction>[] {
  if (invoice.status === "draft") {
    return [
      {
        action: "send",
        label: "Send",
        confirmMessage: `Mark ${invoice.invoice_number} as Sent?`,
      },
    ];
  }

  if (invoice.status === "sent") {
    return [
      {
        action: "mark-paid",
        label: "Mark as Paid",
        confirmMessage: `Mark ${invoice.invoice_number} as Paid?`,
      },
    ];
  }

  return [];
}

export default function ClientInvoicesList({
  initialInvoices,
  fetchError,
  paymentMethods,
}: ClientInvoicesListProps) {
  const router = useRouter();
  const [invoices, setInvoices] = useState(
    initialInvoices.map(normalizeClientInvoiceListRow),
  );
  const [error, setError] = useState<string | null>(fetchError);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingInvoiceAction | null>(null);
  const [actingId, setActingId] = useState<string | null>(null);
  const [recordingInvoice, setRecordingInvoice] = useState<ClientInvoiceListRow | null>(
    null,
  );

  function updateInvoiceInList(next: ClientInvoiceListRow) {
    setInvoices((current) =>
      current.map((entry) =>
        entry.id === next.id ? normalizeClientInvoiceListRow(next) : entry,
      ),
    );
  }

  async function executePendingAction() {
    if (!pendingAction) {
      return;
    }

    const { invoiceId, action } = pendingAction;
    setActingId(invoiceId);
    setError(null);

    try {
      const response = await fetch(`/api/client-invoices/${invoiceId}/status`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: action === "send" ? "sent" : "paid",
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { client_invoice?: ClientInvoiceListRow; error?: string }
        | null;

      if (!response.ok || !payload?.client_invoice) {
        setError(payload?.error ?? "Unable to update invoice status.");
        return;
      }

      updateInvoiceInList(payload.client_invoice);
      setPendingAction(null);
      router.refresh();
    } catch {
      setError("Unable to complete action. Check your connection and try again.");
    } finally {
      setActingId(null);
    }
  }

  async function handleDelete(invoice: ClientInvoiceListRow) {
    setConfirmingId(null);
    setDeletingId(invoice.id);
    setError(null);

    try {
      const response = await fetch(`/api/client-invoices/${invoice.id}`, {
        method: "DELETE",
      });

      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;

      if (!response.ok) {
        setError(payload?.error ?? "Unable to delete invoice.");
        return;
      }

      setInvoices((current) =>
        current.filter((entry) => entry.id !== invoice.id),
      );
      router.refresh();
    } catch {
      setError("Unable to delete invoice. Check your connection and try again.");
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
        <Link href="/dashboard/finance/client-invoices/new" className={primaryButtonClassName}>
          New Customer Invoice
        </Link>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <FilteredListCount
          filteredCount={invoices.length}
          totalCount={invoices.length}
          itemSingular="invoice"
          className="mb-4"
        />

        <ScrollableTable>
          <table className={scrollableTableClassName}>
            <thead className={scrollableTableHeadClassName}>
              <tr>
                <th className={scrollableTableThClassName}>Invoice #</th>
                <th className={scrollableTableThClassName}>Customer</th>
                <th className={scrollableTableThClassName}>Bill To</th>
                <th className={scrollableTableThClassName}>Date</th>
                <th className={scrollableTableThClassName}>Due</th>
                <th className={scrollableTableThClassName}>Total Due</th>
                <th className={scrollableTableThClassName}>Status</th>
                <th className={scrollableTableThClassName}>Source</th>
                <th className={scrollableTableThClassName}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-200">
              {invoices.length === 0 ? (
                <tr>
                  <td colSpan={9} className="px-4 py-8 text-center text-sm text-slate-500">
                    No customer invoices yet.
                  </td>
                </tr>
              ) : (
                invoices.map((invoice, index) => {
                  const clientName = Array.isArray(invoice.client)
                    ? invoice.client[0]?.client_name
                    : invoice.client?.client_name;
                  const sourceQuotation = resolveSourceQuotationLink(invoice);
                  const sourceContract = resolveSourceContractLink(invoice);

                  return (
                    <tr key={invoice.id} className={getStripedRowClassName(index)}>
                      <td className="px-4 py-3 font-medium text-[#0f2744]">
                        {invoice.invoice_number}
                      </td>
                      <td className="px-4 py-3">{clientName ?? invoice.client_id}</td>
                      <td className="px-4 py-3">{invoice.bill_to_name}</td>
                      <td className="px-4 py-3">{formatInvoiceDate(invoice.invoice_date)}</td>
                      <td className="px-4 py-3">{formatInvoiceDate(invoice.due_date)}</td>
                      <td className="px-4 py-3">
                        {formatInvoiceMoney(invoice.total_amount_due)}
                      </td>
                      <td className="px-4 py-3">{formatInvoiceStatus(invoice.status)}</td>
                      <td className="px-4 py-3">
                        <div className="flex flex-col gap-1">
                          {sourceQuotation ? (
                            <Link
                              href={`/dashboard/sales-crm/quotations/${sourceQuotation.id}`}
                              className={traceabilityBadgeClassName}
                            >
                              From Quotation {sourceQuotation.quotation_number}
                            </Link>
                          ) : null}
                          {sourceContract ? (
                            <Link
                              href={`/dashboard/finance/service-contracts/${sourceContract.id}`}
                              className={contractTraceabilityBadgeClassName}
                            >
                              From Contract {sourceContract.contract_number}
                            </Link>
                          ) : null}
                          {!sourceQuotation && !sourceContract ? (
                            <span className="text-sm text-slate-500">—</span>
                          ) : null}
                        </div>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <div className="inline-flex flex-nowrap items-center gap-2">
                          <Link
                            href={`/dashboard/finance/client-invoices/${invoice.id}`}
                            className={secondaryButtonClassName}
                          >
                            View
                          </Link>
                          <Link
                            href={`/dashboard/finance/client-invoices/${invoice.id}/edit`}
                            className={secondaryButtonClassName}
                          >
                            Edit
                          </Link>
                          {invoice.status !== "draft" && invoice.status !== "paid" ? (
                            <button
                              type="button"
                              onClick={() => setRecordingInvoice(invoice)}
                              className={secondaryButtonClassName}
                            >
                              Record Payment
                            </button>
                          ) : null}
                          {confirmingId === invoice.id ? (
                            <span className="inline-flex flex-nowrap items-center gap-2 whitespace-nowrap">
                              <span className="text-sm text-red-700">
                                Delete {invoice.invoice_number}?
                              </span>
                              <button
                                type="button"
                                onClick={() => void handleDelete(invoice)}
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
                              onClick={() => {
                                setError(null);
                                setPendingAction(null);
                                setConfirmingId(invoice.id);
                              }}
                              disabled={deletingId === invoice.id}
                              className={dangerButtonClassName}
                            >
                              {deletingId === invoice.id ? "Deleting…" : "Delete"}
                            </button>
                          )}
                          {pendingAction?.invoiceId === invoice.id ? (
                            <span className="inline-flex flex-nowrap items-center gap-2 whitespace-nowrap">
                              <span className="text-sm text-slate-700">
                                {pendingAction.confirmMessage}
                              </span>
                              <button
                                type="button"
                                onClick={() => void executePendingAction()}
                                disabled={actingId === invoice.id}
                                className={actionButtonClassName}
                              >
                                {actingId === invoice.id ? "Working…" : "Confirm"}
                              </button>
                              <button
                                type="button"
                                onClick={() => setPendingAction(null)}
                                disabled={actingId === invoice.id}
                                className={secondaryButtonClassName}
                              >
                                Cancel
                              </button>
                            </span>
                          ) : (
                            <ListRowStatusActionsMenu
                              items={getInvoiceStatusActions(invoice)}
                              disabled={actingId === invoice.id}
                              buttonClassName={statusMenuButtonClassName}
                              onSelect={(item) => {
                                setError(null);
                                setConfirmingId(null);
                                setPendingAction({
                                  invoiceId: invoice.id,
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

      {recordingInvoice ? (
        <RecordPaymentDialog
          invoiceId={recordingInvoice.id}
          invoiceNumber={recordingInvoice.invoice_number}
          totalDue={toNumber(recordingInvoice.total_amount_due)}
          amountReceived={toNumber(recordingInvoice.amount_received ?? 0)}
          paymentMethods={paymentMethods}
          onClose={() => setRecordingInvoice(null)}
          onSuccess={() => {
            setRecordingInvoice(null);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}
