"use client";

import { useMemo, useState } from "react";
import { inputClassName } from "../../../employees/employee-record-utils";
import { formatInventoryMoney } from "../../inventory-utils";
import type { NamedLookup } from "../../../lookup-types";
import {
  calculateProductPurchaseTotal,
  type ProductPurchaseListRow,
} from "@/utils/product-purchases-types";

export type ReceivePurchaseTarget = {
  po_id: string;
  po_item_id: string;
  product_id: string;
  product_label: string;
  unit_of_measure: string;
  supplier_id: string;
  supplier_name: string;
  remaining_quantity: number;
  po_unit_cost: number;
};

type ReceivePurchaseModalProps = {
  target: ReceivePurchaseTarget;
  paymentMethods: NamedLookup[];
  onClose: () => void;
  onReceived: () => void;
};

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButtonClassName =
  "rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

const lockedFieldClassName =
  "w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700";

export default function ReceivePurchaseModal({
  target,
  paymentMethods,
  onClose,
  onReceived,
}: ReceivePurchaseModalProps) {
  const [purchaseDate, setPurchaseDate] = useState(
    () => new Date().toISOString().slice(0, 10),
  );
  const [quantity, setQuantity] = useState(String(target.remaining_quantity));
  const [costPerUnit, setCostPerUnit] = useState(String(target.po_unit_cost));
  const [paymentMethod, setPaymentMethod] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const calculatedTotal = useMemo(
    () => calculateProductPurchaseTotal(quantity, costPerUnit),
    [quantity, costPerUnit],
  );

  const varianceWarning = useMemo(() => {
    const cost = Number(costPerUnit);
    if (!Number.isFinite(cost) || cost === target.po_unit_cost) {
      return null;
    }

    if (target.po_unit_cost === 0) {
      return `This differs from the PO price of ${formatInventoryMoney(0)}.`;
    }

    const pct =
      Math.round(
        Math.abs((cost - target.po_unit_cost) / target.po_unit_cost) * 1000,
      ) / 10;
    const direction = cost > target.po_unit_cost ? "higher" : "lower";

    return `This is ${pct}% ${direction} than the PO price of ${formatInventoryMoney(target.po_unit_cost)}.`;
  }, [costPerUnit, target.po_unit_cost]);

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/product-purchases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          product_id: target.product_id,
          supplier_id: target.supplier_id,
          purchase_date: purchaseDate,
          quantity,
          cost_per_unit: costPerUnit,
          payment_method: paymentMethod,
          notes,
          po_id: target.po_id,
          po_item_id: target.po_item_id,
        }),
      });

      const payload = (await response.json().catch(() => null)) as
        | { product_purchase?: ProductPurchaseListRow; error?: string }
        | null;

      if (!response.ok) {
        setError(payload?.error ?? "Unable to record receipt.");
        return;
      }

      onReceived();
    } catch {
      setError("Unable to record receipt. Check your connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="receive-purchase-form-title"
        className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-slate-200 bg-white p-6 shadow-xl"
      >
        <div className="mb-4 flex items-start justify-between gap-4">
          <div>
            <h3
              id="receive-purchase-form-title"
              className="text-lg font-semibold text-[#0f2744]"
            >
              Receive Against Purchase Order
            </h3>
            <p className="mt-1 text-sm text-slate-600">
              Records a purchase linked to this PO line. Stock, payable/cash
              postings, and PO received quantities update automatically.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm text-slate-600 hover:bg-slate-100"
          >
            Close
          </button>
        </div>

        {error ? (
          <p className="mb-4 rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            {error}
          </p>
        ) : null}

        <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Product
            </label>
            <p className={lockedFieldClassName}>{target.product_label}</p>
          </div>

          <div className="md:col-span-2">
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Supplier
            </label>
            <p className={lockedFieldClassName}>{target.supplier_name}</p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Purchase Date
            </label>
            <input
              type="date"
              required
              value={purchaseDate}
              onChange={(event) => setPurchaseDate(event.target.value)}
              className={inputClassName}
            />
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Payment Method
            </label>
            <select
              required
              value={paymentMethod}
              onChange={(event) => setPaymentMethod(event.target.value)}
              className={inputClassName}
            >
              <option value="">Select payment method</option>
              {paymentMethods.map((method) => (
                <option key={method.name} value={method.name}>
                  {method.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Quantity
              {target.unit_of_measure ? ` (${target.unit_of_measure})` : ""}
            </label>
            <input
              type="number"
              min={0.0001}
              step="any"
              required
              value={quantity}
              onChange={(event) => setQuantity(event.target.value)}
              className={inputClassName}
            />
            <p className="mt-1 text-xs text-slate-500">
              Remaining on this line: {target.remaining_quantity}
              {target.unit_of_measure ? ` ${target.unit_of_measure}` : ""}
            </p>
          </div>

          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Cost per Unit
            </label>
            <input
              type="number"
              min={0}
              step="any"
              required
              value={costPerUnit}
              onChange={(event) => setCostPerUnit(event.target.value)}
              className={inputClassName}
            />
            {varianceWarning ? (
              <p className="mt-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-800">
                {varianceWarning}
              </p>
            ) : null}
          </div>

          <div className="md:col-span-2 rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
            <span className="font-medium text-slate-900">Total cost:</span>{" "}
            {formatInventoryMoney(calculatedTotal)}
          </div>

          <div className="md:col-span-2">
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Notes
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
              className={inputClassName}
            />
          </div>

          <div className="flex gap-3 md:col-span-2">
            <button
              type="submit"
              disabled={saving}
              className={primaryButtonClassName}
            >
              {saving ? "Saving…" : "Record Receipt"}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={saving}
              className={secondaryButtonClassName}
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
