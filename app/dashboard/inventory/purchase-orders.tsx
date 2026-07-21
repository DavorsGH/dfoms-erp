"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { formatDate } from "../finance/income-register-utils";
import { getStripedRowClassName } from "../finance/register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import { formatInventoryMoney } from "./inventory-utils";
import {
  formatPurchaseOrderStatus,
  getPurchaseOrderStatusBadgeClassName,
  getPurchaseOrderSupplierName,
  type NormalizedPurchaseOrderListRow,
} from "@/utils/purchase-orders-types";

type PurchaseOrdersProps = {
  initialPurchaseOrders: NormalizedPurchaseOrderListRow[];
  fetchError: string | null;
  readOnly?: boolean;
};

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50";

const viewButtonClassName =
  "rounded-md border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50";

const dangerButtonClassName =
  "rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50";

export default function PurchaseOrders({
  initialPurchaseOrders,
  fetchError,
  readOnly = false,
}: PurchaseOrdersProps) {
  const router = useRouter();
  const [purchaseOrders, setPurchaseOrders] = useState(initialPurchaseOrders);
  const [error, setError] = useState<string | null>(fetchError);
  const [success, setSuccess] = useState<string | null>(null);
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [blockedMessage, setBlockedMessage] = useState<{
    id: string;
    text: string;
  } | null>(null);

  async function previewDelete(po: NormalizedPurchaseOrderListRow) {
    setCheckingId(po.id);
    setConfirmingId(null);
    setBlockedMessage(null);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(`/api/purchase-orders/${po.id}`, {
        method: "DELETE",
      });
      const payload = (await response.json().catch(() => null)) as
        | {
            can_delete?: boolean;
            error?: string;
            requires_confirmation?: boolean;
          }
        | null;

      if (response.status === 409 || payload?.can_delete === false) {
        setBlockedMessage({
          id: po.id,
          text:
            payload?.error ??
            "This purchase order has received purchases and can't be deleted.",
        });
        return;
      }

      if (
        !response.ok ||
        payload?.can_delete !== true ||
        !payload.requires_confirmation
      ) {
        setError(payload?.error ?? "Unable to preview purchase order delete.");
        return;
      }

      setConfirmingId(po.id);
    } catch {
      setError("Unable to preview purchase order delete. Try again.");
    } finally {
      setCheckingId(null);
    }
  }

  async function confirmDelete(po: NormalizedPurchaseOrderListRow) {
    setDeletingId(po.id);
    setError(null);

    try {
      const response = await fetch(`/api/purchase-orders/${po.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmed: true }),
      });
      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;

      if (!response.ok) {
        setError(payload?.error ?? "Unable to delete purchase order.");
        return;
      }

      setPurchaseOrders((current) =>
        current.filter((purchaseOrder) => purchaseOrder.id !== po.id),
      );
      setConfirmingId(null);
      setBlockedMessage(null);
      setSuccess(`${po.po_number} deleted.`);
      router.refresh();
    } catch {
      setError("Unable to delete purchase order. Try again.");
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

      {success ? (
        <p className="rounded-md border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">
          {success}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-slate-600">
          Create purchase orders for suppliers, mark them as sent, and track
          receiving. Orders are marked received automatically when all items
          are recorded as purchased against the PO.
        </p>
        {!readOnly ? (
          <Link
            href="/dashboard/inventory/purchase-orders/new"
            className={primaryButtonClassName}
          >
            New Purchase Order
          </Link>
        ) : null}
      </div>

      <ScrollableTable>
        <table className={scrollableTableClassName}>
          <thead className={scrollableTableHeadClassName}>
            <tr>
              <th className={scrollableTableThClassName}>PO Number</th>
              <th className={scrollableTableThClassName}>Supplier</th>
              <th className={scrollableTableThClassName}>Order Date</th>
              <th className={scrollableTableThClassName}>Expected Date</th>
              <th className={scrollableTableThClassName}>Status</th>
              <th className={scrollableTableThClassName}>Total</th>
              <th className={scrollableTableThClassName}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {purchaseOrders.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-6 text-center text-sm text-slate-500"
                >
                  No purchase orders yet.
                </td>
              </tr>
            ) : (
              purchaseOrders.map((po, index) => (
                <tr key={po.id} className={getStripedRowClassName(index)}>
                  <td className="px-4 py-3 font-medium text-[#0f2744]">
                    {po.po_number}
                  </td>
                  <td className="px-4 py-3">
                    {getPurchaseOrderSupplierName(po.supplier)}
                  </td>
                  <td className="px-4 py-3">{formatDate(po.order_date)}</td>
                  <td className="px-4 py-3">
                    {po.expected_date ? formatDate(po.expected_date) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span className={getPurchaseOrderStatusBadgeClassName(po.status)}>
                      {formatPurchaseOrderStatus(po.status)}
                    </span>
                  </td>
                  <td className="px-4 py-3">{formatInventoryMoney(po.total)}</td>
                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-2">
                      <Link
                        href={`/dashboard/inventory/purchase-orders/${po.id}`}
                        className={viewButtonClassName}
                      >
                        View
                      </Link>
                      {!readOnly ? (
                        confirmingId === po.id ? (
                          <>
                            <span className="whitespace-normal text-sm text-red-700">
                              Delete {po.po_number}? This cannot be undone.
                            </span>
                            <button
                              type="button"
                              onClick={() => void confirmDelete(po)}
                              disabled={deletingId === po.id}
                              className={dangerButtonClassName}
                            >
                              {deletingId === po.id
                                ? "Deleting…"
                                : "Yes, delete"}
                            </button>
                            <button
                              type="button"
                              onClick={() => setConfirmingId(null)}
                              disabled={deletingId === po.id}
                              className={viewButtonClassName}
                            >
                              Cancel
                            </button>
                          </>
                        ) : blockedMessage?.id === po.id ? (
                          <>
                            <span className="max-w-md whitespace-normal text-sm text-red-700">
                              {blockedMessage.text}
                            </span>
                            <button
                              type="button"
                              onClick={() => setBlockedMessage(null)}
                              className={viewButtonClassName}
                            >
                              Dismiss
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            onClick={() => void previewDelete(po)}
                            disabled={checkingId === po.id}
                            className={dangerButtonClassName}
                          >
                            {checkingId === po.id ? "Checking…" : "Delete"}
                          </button>
                        )
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </ScrollableTable>
    </div>
  );
}
