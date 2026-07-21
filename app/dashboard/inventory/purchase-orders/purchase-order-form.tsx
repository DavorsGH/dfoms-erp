"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { inputClassName } from "../../employees/employee-record-utils";
import { formatInventoryMoney } from "../inventory-utils";
import {
  calculatePurchaseOrderTotal,
  validatePurchaseOrderBody,
  type PurchaseOrderFinishedProductOption,
  type PurchaseOrderItemType,
  type PurchaseOrderRawMaterialOption,
} from "@/utils/purchase-orders-types";
import type { SupplierRow } from "@/utils/suppliers-types";

type PurchaseOrderFormProps = {
  initialSuppliers: SupplierRow[];
  initialRawMaterials: PurchaseOrderRawMaterialOption[];
  initialFinishedProducts: PurchaseOrderFinishedProductOption[];
  fetchError: string | null;
};

type FormLineItem = {
  key: string;
  item_type: PurchaseOrderItemType;
  raw_material_id: string;
  finished_product_id: string;
  quantity_ordered: string;
  unit_cost: string;
};

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButtonClassName =
  "rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

const removeButtonClassName =
  "rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50";

function emptyLineItem(): FormLineItem {
  return {
    key: crypto.randomUUID(),
    item_type: "raw_material",
    raw_material_id: "",
    finished_product_id: "",
    quantity_ordered: "",
    unit_cost: "",
  };
}

export default function PurchaseOrderForm({
  initialSuppliers,
  initialRawMaterials,
  initialFinishedProducts,
  fetchError,
}: PurchaseOrderFormProps) {
  const router = useRouter();
  const [supplierId, setSupplierId] = useState("");
  const [orderDate, setOrderDate] = useState(
    () => new Date().toISOString().slice(0, 10),
  );
  const [expectedDate, setExpectedDate] = useState("");
  const [notes, setNotes] = useState("");
  const [lineItems, setLineItems] = useState<FormLineItem[]>(() => [
    emptyLineItem(),
  ]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(fetchError);

  const total = useMemo(
    () => calculatePurchaseOrderTotal(lineItems),
    [lineItems],
  );

  function updateLineItem(key: string, patch: Partial<FormLineItem>) {
    setLineItems((current) =>
      current.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  }

  function addLine() {
    setLineItems((current) => [...current, emptyLineItem()]);
  }

  function removeLine(key: string) {
    setLineItems((current) =>
      current.length > 1 ? current.filter((line) => line.key !== key) : current,
    );
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);

    const body = {
      supplier_id: supplierId,
      order_date: orderDate,
      expected_date: expectedDate || null,
      notes: notes || null,
      items: lineItems.map((line) => ({
        item_type: line.item_type,
        raw_material_id: line.raw_material_id || null,
        finished_product_id: line.finished_product_id || null,
        quantity_ordered: line.quantity_ordered,
        unit_cost: line.unit_cost,
      })),
    };

    const validationError = validatePurchaseOrderBody(body);
    if (validationError) {
      setError(validationError);
      setSaving(false);
      return;
    }

    const response = await fetch("/api/purchase-orders", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    const payload = (await response.json().catch(() => null)) as
      | { purchase_order?: { id: string }; error?: string }
      | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to create purchase order.");
      setSaving(false);
      return;
    }

    if (payload?.purchase_order?.id) {
      router.push(`/dashboard/inventory/purchase-orders/${payload.purchase_order.id}`);
    } else {
      router.push("/dashboard/inventory/purchase-orders");
    }
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-sm font-medium text-slate-700">Order Details</h3>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="md:col-span-2">
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Supplier *
            </label>
            <select
              required
              value={supplierId}
              onChange={(event) => setSupplierId(event.target.value)}
              className={inputClassName}
            >
              <option value="">Select active supplier</option>
              {initialSuppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Order Date *
            </label>
            <input
              type="date"
              required
              value={orderDate}
              onChange={(event) => setOrderDate(event.target.value)}
              className={inputClassName}
            />
          </div>
          <div>
            <label className="mb-1 block text-sm font-medium text-slate-700">
              Expected Date
            </label>
            <input
              type="date"
              value={expectedDate}
              onChange={(event) => setExpectedDate(event.target.value)}
              className={inputClassName}
            />
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
        </div>
      </section>

      <section className="space-y-4 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <h3 className="text-sm font-medium text-slate-700">Line Items</h3>
          <button
            type="button"
            onClick={addLine}
            className={secondaryButtonClassName}
          >
            Add Line
          </button>
        </div>

        <div className="space-y-4">
          {lineItems.map((line, index) => (
            <div
              key={line.key}
              className="space-y-4 rounded-md border border-slate-200 p-4"
            >
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex items-center gap-4">
                  <span className="text-sm font-medium text-slate-700">
                    Line {index + 1}
                  </span>
                  <div className="flex gap-3">
                    <label className="flex items-center gap-1.5 text-sm text-slate-700">
                      <input
                        type="radio"
                        name={`item-type-${line.key}`}
                        checked={line.item_type === "raw_material"}
                        onChange={() =>
                          updateLineItem(line.key, {
                            item_type: "raw_material",
                            finished_product_id: "",
                          })
                        }
                        className="h-4 w-4 border-slate-300 text-[#0f2744]"
                      />
                      Raw Material
                    </label>
                    <label className="flex items-center gap-1.5 text-sm text-slate-700">
                      <input
                        type="radio"
                        name={`item-type-${line.key}`}
                        checked={line.item_type === "finished_product"}
                        onChange={() =>
                          updateLineItem(line.key, {
                            item_type: "finished_product",
                            raw_material_id: "",
                          })
                        }
                        className="h-4 w-4 border-slate-300 text-[#0f2744]"
                      />
                      Finished Product
                    </label>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => removeLine(line.key)}
                  disabled={lineItems.length <= 1}
                  className={removeButtonClassName}
                >
                  Remove
                </button>
              </div>

              <div className="grid gap-4 md:grid-cols-3">
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    {line.item_type === "raw_material"
                      ? "Raw Material *"
                      : "Finished Product *"}
                  </label>
                  {line.item_type === "raw_material" ? (
                    <select
                      required
                      value={line.raw_material_id}
                      onChange={(event) =>
                        updateLineItem(line.key, {
                          raw_material_id: event.target.value,
                        })
                      }
                      className={inputClassName}
                    >
                      <option value="">Select raw material</option>
                      {initialRawMaterials.map((material) => (
                        <option key={material.id} value={material.id}>
                          {material.material_code} — {material.material_name}
                        </option>
                      ))}
                    </select>
                  ) : (
                    <select
                      required
                      value={line.finished_product_id}
                      onChange={(event) =>
                        updateLineItem(line.key, {
                          finished_product_id: event.target.value,
                        })
                      }
                      className={inputClassName}
                    >
                      <option value="">Select purchased product</option>
                      {initialFinishedProducts.map((product) => (
                        <option key={product.id} value={product.id}>
                          {product.product_code} — {product.product_name}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Quantity Ordered *
                  </label>
                  <input
                    type="number"
                    min={0.0001}
                    step="any"
                    required
                    value={line.quantity_ordered}
                    onChange={(event) =>
                      updateLineItem(line.key, {
                        quantity_ordered: event.target.value,
                      })
                    }
                    className={inputClassName}
                  />
                </div>
                <div>
                  <label className="mb-1 block text-sm font-medium text-slate-700">
                    Unit Cost *
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="any"
                    required
                    value={line.unit_cost}
                    onChange={(event) =>
                      updateLineItem(line.key, {
                        unit_cost: event.target.value,
                      })
                    }
                    className={inputClassName}
                  />
                </div>
              </div>
            </div>
          ))}
        </div>

        <div className="rounded-md border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-700">
          <span className="font-medium text-slate-900">Order total:</span>{" "}
          {formatInventoryMoney(total)}
        </div>
      </section>

      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={saving} className={primaryButtonClassName}>
          {saving ? "Saving…" : "Create Purchase Order"}
        </button>
        <Link
          href="/dashboard/inventory/purchase-orders"
          className={secondaryButtonClassName}
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
