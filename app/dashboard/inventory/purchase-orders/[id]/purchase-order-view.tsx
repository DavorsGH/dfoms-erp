"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { formatDate } from "../../../finance/income-register-utils";
import { getStripedRowClassName } from "../../../finance/register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../../../scrollable-table";
import {
  formatInventoryMoney,
  formatInventoryQuantity,
} from "../../inventory-utils";
import type { NamedLookup } from "../../../lookup-types";
import {
  formatPurchaseOrderStatus,
  getPurchaseOrderItemLabel,
  getPurchaseOrderItemUnit,
  getPurchaseOrderStatusBadgeClassName,
  getPurchaseOrderSupplierName,
  normalizePurchaseOrderDetail,
  type PurchaseOrderDetailRow,
} from "@/utils/purchase-orders-types";
import ReceivePurchaseModal, {
  type ReceivePurchaseTarget,
} from "./receive-purchase-modal";
import ReceiveRawMaterialModal, {
  type ReceiveRawMaterialTarget,
} from "./receive-raw-material-modal";

type PurchaseOrderView = ReturnType<typeof normalizePurchaseOrderDetail>;

type PurchaseOrderViewProps = {
  initialPurchaseOrder: PurchaseOrderView;
  paymentMethods: NamedLookup[];
  readOnly?: boolean;
};

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButtonClassName =
  "rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50";

const receiveButtonClassName =
  "rounded-md border border-[#0f2744] px-3 py-1.5 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50";

export default function PurchaseOrderDetailView({
  initialPurchaseOrder,
  paymentMethods,
  readOnly = false,
}: PurchaseOrderViewProps) {
  const router = useRouter();
  const [prevInitial, setPrevInitial] = useState(initialPurchaseOrder);
  const [override, setOverride] = useState<PurchaseOrderView | null>(null);
  const [marking, setMarking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [receiveTarget, setReceiveTarget] = useState<ReceivePurchaseTarget | null>(
    null,
  );
  const [rawReceiveTarget, setRawReceiveTarget] =
    useState<ReceiveRawMaterialTarget | null>(null);

  // Server refresh (router.refresh) delivers a new initialPurchaseOrder;
  // drop any local override so the freshest data wins.
  if (prevInitial !== initialPurchaseOrder) {
    setPrevInitial(initialPurchaseOrder);
    setOverride(null);
  }

  const purchaseOrder = override ?? initialPurchaseOrder;

  async function handleMarkAsSent() {
    setMarking(true);
    setError(null);
    setSuccess(null);

    const response = await fetch(`/api/purchase-orders/${purchaseOrder.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "sent" }),
    });

    const payload = (await response.json().catch(() => null)) as
      | { purchase_order?: PurchaseOrderDetailRow; error?: string }
      | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to mark purchase order as sent.");
      setMarking(false);
      return;
    }

    if (payload?.purchase_order) {
      setOverride(normalizePurchaseOrderDetail(payload.purchase_order));
    }

    setSuccess("Purchase order marked as sent.");
    setMarking(false);
    router.refresh();
  }

  const items = purchaseOrder.items ?? [];

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

      <div className="flex flex-wrap items-center gap-3">
        {!readOnly && purchaseOrder.status === "draft" ? (
          <button
            type="button"
            onClick={() => void handleMarkAsSent()}
            disabled={marking}
            className={primaryButtonClassName}
          >
            {marking ? "Marking…" : "Mark as Sent"}
          </button>
        ) : null}
        <Link
          href="/dashboard/inventory/purchase-orders"
          className={secondaryButtonClassName}
        >
          Back to list
        </Link>
      </div>

      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h3 className="text-lg font-semibold text-[#0f2744]">
              {purchaseOrder.po_number}
            </h3>
            <p className="mt-1 text-sm text-slate-600">
              Supplier: {getPurchaseOrderSupplierName(purchaseOrder.supplier)}
            </p>
          </div>
          <span
            className={getPurchaseOrderStatusBadgeClassName(purchaseOrder.status)}
          >
            {formatPurchaseOrderStatus(purchaseOrder.status)}
          </span>
        </div>

        <dl className="mt-4 grid gap-4 text-sm md:grid-cols-3">
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">
              Order Date
            </dt>
            <dd className="mt-1 text-slate-900">
              {formatDate(purchaseOrder.order_date)}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">
              Expected Date
            </dt>
            <dd className="mt-1 text-slate-900">
              {purchaseOrder.expected_date
                ? formatDate(purchaseOrder.expected_date)
                : "—"}
            </dd>
          </div>
          <div>
            <dt className="text-xs uppercase tracking-wide text-slate-500">
              Total
            </dt>
            <dd className="mt-1 font-semibold text-[#0f2744]">
              {formatInventoryMoney(purchaseOrder.total)}
            </dd>
          </div>
        </dl>

        {purchaseOrder.notes?.trim() ? (
          <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            <span className="font-medium text-slate-900">Notes:</span>{" "}
            {purchaseOrder.notes.trim()}
          </div>
        ) : null}
      </section>

      <ScrollableTable>
        <table className={scrollableTableClassName}>
          <thead className={scrollableTableHeadClassName}>
            <tr>
              <th className={scrollableTableThClassName}>Item</th>
              <th className={scrollableTableThClassName}>Type</th>
              <th className={scrollableTableThClassName}>Quantity Ordered</th>
              <th className={scrollableTableThClassName}>Quantity Received</th>
              <th className={scrollableTableThClassName}>Unit Cost</th>
              <th className={scrollableTableThClassName}>Line Total</th>
              {!readOnly ? (
                <th className={scrollableTableThClassName}>Actions</th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr>
                <td
                  colSpan={readOnly ? 6 : 7}
                  className="px-4 py-6 text-center text-sm text-slate-500"
                >
                  No line items.
                </td>
              </tr>
            ) : (
              items.map((item, index) => {
                const unit = getPurchaseOrderItemUnit(item);
                const unitSuffix = unit ? ` ${unit}` : "";
                const remaining =
                  Math.round(
                    (item.quantity_ordered - item.quantity_received) * 10000,
                  ) / 10000;
                const canReceive =
                  !readOnly &&
                  item.item_type === "finished_product" &&
                  item.finished_product_id !== null &&
                  purchaseOrder.supplier_id !== null &&
                  remaining > 0;
                const canReceiveRawMaterial =
                  !readOnly &&
                  item.item_type === "raw_material" &&
                  item.raw_material_id !== null &&
                  remaining > 0;

                return (
                  <tr key={item.id} className={getStripedRowClassName(index)}>
                    <td className="px-4 py-3">
                      {getPurchaseOrderItemLabel(item)}
                    </td>
                    <td className="px-4 py-3">
                      {item.item_type === "raw_material"
                        ? "Raw Material"
                        : "Finished Product"}
                    </td>
                    <td className="px-4 py-3">
                      {formatInventoryQuantity(item.quantity_ordered)}
                      {unitSuffix}
                    </td>
                    <td className="px-4 py-3">
                      {formatInventoryQuantity(item.quantity_received)}
                      {unitSuffix}
                    </td>
                    <td className="px-4 py-3">
                      {formatInventoryMoney(item.unit_cost)}
                    </td>
                    <td className="px-4 py-3 font-medium text-[#0f2744]">
                      {formatInventoryMoney(
                        Math.round(
                          item.quantity_ordered * item.unit_cost * 100,
                        ) / 100,
                      )}
                    </td>
                    {!readOnly ? (
                      <td className="px-4 py-3">
                        {canReceive ? (
                          <button
                            type="button"
                            onClick={() => {
                              setError(null);
                              setSuccess(null);
                              setReceiveTarget({
                                po_id: purchaseOrder.id,
                                po_item_id: item.id,
                                product_id: item.finished_product_id as string,
                                product_label: getPurchaseOrderItemLabel(item),
                                unit_of_measure: unit,
                                supplier_id: purchaseOrder.supplier_id as string,
                                supplier_name: getPurchaseOrderSupplierName(
                                  purchaseOrder.supplier,
                                ),
                                remaining_quantity: remaining,
                                po_unit_cost: item.unit_cost,
                              });
                            }}
                            className={receiveButtonClassName}
                          >
                            Receive
                          </button>
                        ) : canReceiveRawMaterial ? (
                          <button
                            type="button"
                            onClick={() => {
                              setError(null);
                              setSuccess(null);
                              const supplierName = getPurchaseOrderSupplierName(
                                purchaseOrder.supplier,
                              );
                              setRawReceiveTarget({
                                po_id: purchaseOrder.id,
                                po_item_id: item.id,
                                material_id: item.raw_material_id as string,
                                material_label: getPurchaseOrderItemLabel(item),
                                unit_of_measure: unit,
                                supplier_name:
                                  supplierName === "—" ? "" : supplierName,
                                remaining_quantity: remaining,
                                po_unit_cost: item.unit_cost,
                              });
                            }}
                            className={receiveButtonClassName}
                          >
                            Receive
                          </button>
                        ) : (
                          <span className="text-sm text-slate-400">
                            {remaining <= 0 ? "Fully received" : "—"}
                          </span>
                        )}
                      </td>
                    ) : null}
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </ScrollableTable>

      {receiveTarget ? (
        <ReceivePurchaseModal
          target={receiveTarget}
          paymentMethods={paymentMethods}
          onClose={() => setReceiveTarget(null)}
          onReceived={() => {
            setReceiveTarget(null);
            setSuccess("Receipt recorded against this purchase order.");
            router.refresh();
          }}
        />
      ) : null}

      {rawReceiveTarget ? (
        <ReceiveRawMaterialModal
          target={rawReceiveTarget}
          paymentMethods={paymentMethods}
          onClose={() => setRawReceiveTarget(null)}
          onReceived={() => {
            setRawReceiveTarget(null);
            setSuccess("Receipt recorded against this purchase order.");
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}
