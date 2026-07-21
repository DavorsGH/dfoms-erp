"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { formatDate } from "../finance/income-register-utils";
import { inputClassName } from "../employees/employee-record-utils";
import { getStripedRowClassName } from "../finance/register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import {
  formatInventoryMoney,
  formatInventoryQuantity,
} from "./inventory-utils";
import type { NamedLookup } from "../lookup-types";
import {
  calculateProductPurchaseTotal,
  emptyProductPurchaseForm,
  getProductPurchaseProductLabel,
  getProductPurchaseSupplierLabel,
  normalizeProductPurchaseRow,
  validateProductPurchaseBody,
  type ProductPurchaseListRow,
  type PurchasedProductOption,
} from "@/utils/product-purchases-types";
import type { SupplierRow } from "@/utils/suppliers-types";

type ProductPurchasesProps = {
  initialPurchases: ProductPurchaseListRow[];
  initialProducts: PurchasedProductOption[];
  initialSuppliers: SupplierRow[];
  initialPaymentMethods: NamedLookup[];
  fetchError: string | null;
  readOnly?: boolean;
};

type FormState = ReturnType<typeof emptyProductPurchaseForm>;

const primaryButtonClassName =
  "rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50";

const secondaryButtonClassName =
  "rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50";

const deleteButtonClassName =
  "rounded-md border border-red-200 px-3 py-1.5 text-sm font-medium text-red-700 transition-colors hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50";

export default function ProductPurchases({
  initialPurchases,
  initialProducts,
  initialSuppliers,
  initialPaymentMethods,
  fetchError,
  readOnly = false,
}: ProductPurchasesProps) {
  const router = useRouter();
  const [purchases, setPurchases] = useState(initialPurchases);
  const [products] = useState(initialProducts);
  const [suppliers] = useState(initialSuppliers);
  const [paymentMethods] = useState(initialPaymentMethods);
  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<FormState>(() => emptyProductPurchaseForm());
  const [loading, setLoading] = useState(false);
  const [deletingPurchaseId, setDeletingPurchaseId] = useState<string | null>(null);
  const [confirmingPurchaseId, setConfirmingPurchaseId] = useState<string | null>(
    null,
  );
  const [error, setError] = useState<string | null>(fetchError);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    setPurchases(initialPurchases);
  }, [initialPurchases]);

  const calculatedTotal = useMemo(
    () => calculateProductPurchaseTotal(form.quantity, form.cost_per_unit),
    [form.quantity, form.cost_per_unit],
  );

  const selectedProduct = useMemo(
    () => products.find((product) => product.id === form.product_id) ?? null,
    [form.product_id, products],
  );

  async function refreshPurchases() {
    const response = await fetch("/api/product-purchases");
    const payload = (await response.json().catch(() => null)) as
      | { product_purchases?: ProductPurchaseListRow[]; error?: string }
      | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to refresh purchases.");
      return;
    }

    setPurchases(
      (payload?.product_purchases ?? []).map((row) =>
        normalizeProductPurchaseRow(row),
      ),
    );
    setError(null);
  }

  function openModal() {
    setForm(emptyProductPurchaseForm());
    setModalOpen(true);
    setError(null);
    setSuccess(null);
  }

  function closeModal() {
    setModalOpen(false);
    setForm(emptyProductPurchaseForm());
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setSuccess(null);

    const validationError = validateProductPurchaseBody(form);
    if (validationError) {
      setError(validationError);
      setLoading(false);
      return;
    }

    const response = await fetch("/api/product-purchases", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });

    const payload = (await response.json().catch(() => null)) as
      | { product_purchase?: ProductPurchaseListRow; error?: string }
      | null;

    if (!response.ok) {
      setError(payload?.error ?? "Unable to record purchase.");
      setLoading(false);
      return;
    }

    if (payload?.product_purchase) {
      const normalized = normalizeProductPurchaseRow(payload.product_purchase);
      setPurchases((current) => [normalized, ...current]);
    } else {
      await refreshPurchases();
    }

    setSuccess("Purchase recorded.");
    closeModal();
    setLoading(false);
    router.refresh();
  }

  async function handleDelete(purchase: ProductPurchaseListRow) {
    setDeletingPurchaseId(purchase.id);
    setConfirmingPurchaseId(null);
    setError(null);
    setSuccess(null);

    try {
      const response = await fetch(`/api/product-purchases/${purchase.id}`, {
        method: "DELETE",
      });

      const payload = (await response.json().catch(() => null)) as
        | { error?: string }
        | null;

      if (!response.ok) {
        setError(payload?.error ?? "Unable to delete purchase.");
        return;
      }

      setPurchases((current) =>
        current.filter((row) => row.id !== purchase.id),
      );
      setSuccess("Purchase deleted.");
      router.refresh();
    } catch {
      setError("Unable to delete purchase. Try again.");
    } finally {
      setDeletingPurchaseId(null);
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
          Record purchases of finished products sourced for resale. Posted
          purchases update stock and linked financial entries. Delete reverses
          stock and the linked payable when nothing has been sold or paid yet.
        </p>
        {!readOnly ? (
          <button
            type="button"
            onClick={openModal}
            className={primaryButtonClassName}
          >
            Record Purchase
          </button>
        ) : null}
      </div>

      <ScrollableTable>
        <table className={scrollableTableClassName}>
          <thead className={scrollableTableHeadClassName}>
            <tr>
              <th className={scrollableTableThClassName}>Date</th>
              <th className={scrollableTableThClassName}>Product</th>
              <th className={scrollableTableThClassName}>Supplier</th>
              <th className={scrollableTableThClassName}>Quantity</th>
              <th className={scrollableTableThClassName}>Cost/Unit</th>
              <th className={scrollableTableThClassName}>Total Cost</th>
              <th className={scrollableTableThClassName}>Payment Method</th>
              {!readOnly ? (
                <th className={scrollableTableThClassName}>Actions</th>
              ) : null}
            </tr>
          </thead>
          <tbody>
            {purchases.length === 0 ? (
              <tr>
                <td
                  colSpan={readOnly ? 7 : 8}
                  className="px-4 py-6 text-center text-sm text-slate-500"
                >
                  No product purchases recorded yet.
                </td>
              </tr>
            ) : (
              purchases.map((purchase, index) => (
                <tr key={purchase.id} className={getStripedRowClassName(index)}>
                  <td className="px-4 py-3">{formatDate(purchase.purchase_date)}</td>
                  <td className="px-4 py-3">
                    {getProductPurchaseProductLabel(purchase)}
                  </td>
                  <td className="px-4 py-3">
                    {getProductPurchaseSupplierLabel(purchase)}
                  </td>
                  <td className="px-4 py-3">
                    {formatInventoryQuantity(purchase.quantity)}
                    {purchase.product?.unit_of_measure
                      ? ` ${purchase.product.unit_of_measure}`
                      : ""}
                  </td>
                  <td className="px-4 py-3">
                    {formatInventoryMoney(purchase.cost_per_unit)}
                  </td>
                  <td className="px-4 py-3">
                    {formatInventoryMoney(purchase.total_cost)}
                  </td>
                  <td className="px-4 py-3">{purchase.payment_method}</td>
                  {!readOnly ? (
                    <td className="px-4 py-3">
                      {confirmingPurchaseId === purchase.id ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="whitespace-normal text-sm text-red-700">
                            Delete this purchase? This cannot be undone.
                          </span>
                          <button
                            type="button"
                            onClick={() => void handleDelete(purchase)}
                            disabled={deletingPurchaseId === purchase.id}
                            className={deleteButtonClassName}
                          >
                            {deletingPurchaseId === purchase.id
                              ? "Deleting…"
                              : "Yes, delete"}
                          </button>
                          <button
                            type="button"
                            onClick={() => setConfirmingPurchaseId(null)}
                            disabled={deletingPurchaseId === purchase.id}
                            className={secondaryButtonClassName}
                          >
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setError(null);
                            setSuccess(null);
                            setConfirmingPurchaseId(purchase.id);
                          }}
                          disabled={deletingPurchaseId === purchase.id}
                          className={deleteButtonClassName}
                        >
                          {deletingPurchaseId === purchase.id
                            ? "Deleting…"
                            : "Delete"}
                        </button>
                      )}
                    </td>
                  ) : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </ScrollableTable>

      {modalOpen && !readOnly ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="product-purchase-form-title"
            className="max-h-[85vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-slate-200 bg-white p-6 shadow-xl"
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h3
                  id="product-purchase-form-title"
                  className="text-lg font-semibold text-[#0f2744]"
                >
                  Record Purchase
                </h3>
                <p className="mt-1 text-sm text-slate-600">
                  Creates stock, payable/cash postings, and a purchase history
                  row via the database RPC.
                </p>
              </div>
              <button
                type="button"
                onClick={closeModal}
                className="rounded-md px-2 py-1 text-sm text-slate-600 hover:bg-slate-100"
              >
                Close
              </button>
            </div>

            <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2">
              <div className="md:col-span-2">
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Product
                </label>
                <select
                  required
                  value={form.product_id}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      product_id: event.target.value,
                    }))
                  }
                  className={inputClassName}
                >
                  <option value="">Select purchased product</option>
                  {products.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.product_code} — {product.product_name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="md:col-span-2">
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Supplier
                </label>
                <select
                  required
                  value={form.supplier_id}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      supplier_id: event.target.value,
                    }))
                  }
                  className={inputClassName}
                >
                  <option value="">Select active supplier</option>
                  {suppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Purchase Date
                </label>
                <input
                  type="date"
                  required
                  value={form.purchase_date}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      purchase_date: event.target.value,
                    }))
                  }
                  className={inputClassName}
                />
              </div>

              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Payment Method
                </label>
                <select
                  required
                  value={form.payment_method}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      payment_method: event.target.value,
                    }))
                  }
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
                  {selectedProduct ? ` (${selectedProduct.unit_of_measure})` : ""}
                </label>
                <input
                  type="number"
                  min={0.0001}
                  step="any"
                  required
                  value={form.quantity}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      quantity: event.target.value,
                    }))
                  }
                  className={inputClassName}
                />
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
                  value={form.cost_per_unit}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      cost_per_unit: event.target.value,
                    }))
                  }
                  className={inputClassName}
                />
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
                  value={form.notes}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      notes: event.target.value,
                    }))
                  }
                  className={inputClassName}
                />
              </div>

              <div className="flex gap-3 md:col-span-2">
                <button
                  type="submit"
                  disabled={loading}
                  className={primaryButtonClassName}
                >
                  {loading ? "Saving…" : "Record Purchase"}
                </button>
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={loading}
                  className={secondaryButtonClassName}
                >
                  Cancel
                </button>
              </div>
            </form>
          </div>
        </div>
      ) : null}
    </div>
  );
}
