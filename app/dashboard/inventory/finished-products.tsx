"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import { inputClassName } from "../employees/employee-record-utils";
import RegisterRowActions, {
  getStripedRowClassName,
} from "../finance/register-row-actions";
import {
  buildFinishedProductDeleteMessage,
  confirmCascadeDelete,
  normalizeFinishedProductDeletePreview,
} from "./inventory-delete-utils";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import {
  formatInventoryMoney,
  formatInventoryQuantity,
  generateNextInventoryCode,
} from "./inventory-utils";
import {
  buildFinishedProductSavePayload,
  DEFAULT_FINISHED_PRODUCT_SOURCING_TYPE,
  FINISHED_PRODUCT_SELECT,
  FINISHED_PRODUCT_SOURCING_OPTIONS,
  finishedProductToForm,
  normalizeFinishedProduct,
  type FinishedProductRecord,
  type FinishedProductSourcingType,
} from "./finished-products-utils";
import type { SupplierRow } from "@/utils/suppliers-types";

type FinishedProductsProps = {
  initialProducts: FinishedProductRecord[];
  initialSuppliers: SupplierRow[];
  fetchError: string | null;
  readOnly?: boolean;
};

const emptyForm = {
  product_code: "",
  product_name: "",
  unit_of_measure: "",
  standard_selling_price: "",
  sourcing_type: DEFAULT_FINISHED_PRODUCT_SOURCING_TYPE,
  supplier_id: "",
};

export default function FinishedProducts({
  initialProducts,
  initialSuppliers,
  fetchError,
  readOnly = false,
}: FinishedProductsProps) {
  const supabase = createClient();
  const [products, setProducts] = useState(
    initialProducts.map(normalizeFinishedProduct),
  );
  const [showForm, setShowForm] = useState(false);
  const [editingProductId, setEditingProductId] = useState<string | null>(null);
  const [deletingProductId, setDeletingProductId] = useState<string | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(fetchError);

  useEffect(() => {
    setProducts(initialProducts.map(normalizeFinishedProduct));
  }, [initialProducts]);

  async function refreshData() {
    const { data, error: refreshError } = await supabase
      .from("finished_products")
      .select(FINISHED_PRODUCT_SELECT)
      .order("product_name", { ascending: true });

    if (refreshError) {
      setError(refreshError.message);
      return;
    }

    setProducts(
      ((data as FinishedProductRecord[] | null) ?? []).map((row) =>
        normalizeFinishedProduct(row),
      ),
    );
    setError(null);
  }

  function openAddForm() {
    setEditingProductId(null);
    setForm({
      ...emptyForm,
      product_code: generateNextInventoryCode(
        "FP-",
        3,
        products.map((product) => product.product_code),
      ),
    });
    setShowForm(true);
  }

  function openEditForm(product: FinishedProductRecord) {
    setEditingProductId(product.id);
    setForm(finishedProductToForm(product));
    setShowForm(true);
  }

  function closeForm() {
    setEditingProductId(null);
    setForm(emptyForm);
    setShowForm(false);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    const payload = buildFinishedProductSavePayload(form);

    const { error: saveError } = editingProductId
      ? await supabase
          .from("finished_products")
          .update({
            product_name: payload.product_name,
            unit_of_measure: payload.unit_of_measure,
            standard_selling_price: payload.standard_selling_price,
            sourcing_type: payload.sourcing_type,
            supplier_id: payload.supplier_id,
            updated_at: new Date().toISOString(),
          })
          .eq("id", editingProductId)
      : await supabase.from("finished_products").insert(payload);

    if (saveError) {
      setError(saveError.message);
      setLoading(false);
      return;
    }

    closeForm();
    await refreshData();
    setLoading(false);
  }

  async function handleDelete(productId: string) {
    setDeletingProductId(productId);
    setError(null);

    const { data: previewData, error: previewError } = await supabase.rpc(
      "preview_finished_product_delete",
      { p_product_id: productId },
    );

    if (previewError) {
      setError(previewError.message);
      setDeletingProductId(null);
      return;
    }

    const preview = normalizeFinishedProductDeletePreview(previewData);
    if (!confirmCascadeDelete(buildFinishedProductDeleteMessage(preview))) {
      setDeletingProductId(null);
      return;
    }

    const { error: deleteError } = await supabase.rpc(
      "delete_finished_product_cascade",
      { p_product_id: productId },
    );

    if (deleteError) {
      setError(deleteError.message);
      setDeletingProductId(null);
      return;
    }

    if (editingProductId === productId) {
      closeForm();
    }

    await refreshData();
    setDeletingProductId(null);
  }

  return (
    <div className="space-y-6">
      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-slate-600">
          Finished product master data. Unit cost is derived per production batch,
          not stored here.
        </p>
        {!readOnly ? (
        <button
          type="button"
          onClick={() => (showForm ? closeForm() : openAddForm())}
          className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c]"
        >
          {showForm ? "Cancel" : "Add Finished Product"}
        </button>
        ) : null}
      </div>

      {showForm && !readOnly ? (
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h3 className="mb-4 text-lg font-semibold text-[#0f2744]">
            {editingProductId ? "Edit Finished Product" : "New Finished Product"}
          </h3>
          <form onSubmit={handleSubmit} className="grid gap-4 md:grid-cols-2">
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Product Code
              </label>
              <input
                type="text"
                required
                readOnly
                value={form.product_code}
                className={`${inputClassName} bg-slate-50 text-slate-600`}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Product Name
              </label>
              <input
                type="text"
                required
                value={form.product_name}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    product_name: event.target.value,
                  }))
                }
                className={inputClassName}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Unit of Measure
              </label>
              <input
                type="text"
                required
                placeholder="e.g. litres, bottles"
                value={form.unit_of_measure}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    unit_of_measure: event.target.value,
                  }))
                }
                className={inputClassName}
              />
            </div>
            <div>
              <label className="mb-1 block text-sm font-medium text-slate-700">
                Standard Selling Price
              </label>
              <input
                type="number"
                min={0}
                step="0.01"
                value={form.standard_selling_price}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    standard_selling_price: event.target.value,
                  }))
                }
                className={inputClassName}
              />
            </div>
            <div className="md:col-span-2">
              <fieldset>
                <legend className="mb-2 block text-sm font-medium text-slate-700">
                  Sourcing
                </legend>
                <div className="flex flex-wrap gap-4">
                  {FINISHED_PRODUCT_SOURCING_OPTIONS.map((option) => (
                    <label
                      key={option.value}
                      className="flex items-center gap-2 text-sm text-slate-700"
                    >
                      <input
                        type="radio"
                        name="sourcing_type"
                        required
                        value={option.value}
                        checked={form.sourcing_type === option.value}
                        onChange={() =>
                          setForm((current) => ({
                            ...current,
                            sourcing_type: option.value as FinishedProductSourcingType,
                            supplier_id:
                              option.value === "purchased"
                                ? current.supplier_id
                                : "",
                          }))
                        }
                        className="h-4 w-4 border-slate-300 text-[#0f2744] focus:ring-[#0f2744]"
                      />
                      {option.label}
                      <span className="text-xs text-slate-500">
                        {option.value === "manufactured"
                          ? "(produced in-house)"
                          : "(bought from a supplier for resale)"}
                      </span>
                    </label>
                  ))}
                </div>
              </fieldset>
            </div>
            {form.sourcing_type === "purchased" ? (
              <div className="md:col-span-2">
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Primary Supplier{" "}
                  <span className="font-normal text-slate-500">(optional)</span>
                </label>
                <select
                  value={form.supplier_id}
                  onChange={(event) =>
                    setForm((current) => ({
                      ...current,
                      supplier_id: event.target.value,
                    }))
                  }
                  className={inputClassName}
                >
                  <option value="">No default supplier</option>
                  {initialSuppliers.map((supplier) => (
                    <option key={supplier.id} value={supplier.id}>
                      {supplier.name}
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-slate-500">
                  Per-purchase supplier is recorded on the Purchases screen. This
                  field is only a default reference.
                </p>
              </div>
            ) : null}
            <div className="md:col-span-2 flex gap-3">
              <button
                type="submit"
                disabled={loading}
                className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "Saving…" : editingProductId ? "Save Changes" : "Add Product"}
              </button>
              <button
                type="button"
                onClick={closeForm}
                disabled={loading}
                className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Cancel
              </button>
            </div>
          </form>
        </section>
      ) : null}

      <ScrollableTable>
        <table className={scrollableTableClassName}>
          <thead className={scrollableTableHeadClassName}>
            <tr>
              <th className={scrollableTableThClassName}>Code</th>
              <th className={scrollableTableThClassName}>Product</th>
              <th className={scrollableTableThClassName}>Unit</th>
              <th className={scrollableTableThClassName}>Current Stock</th>
              <th className={scrollableTableThClassName}>Selling Price</th>
              {!readOnly ? (
                <th className={scrollableTableThClassName}>Actions</th>
              ) : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {products.length === 0 ? (
              <tr>
                <td
                  colSpan={readOnly ? 5 : 6}
                  className="px-4 py-8 text-center text-sm text-slate-500"
                >
                  No finished products yet.
                </td>
              </tr>
            ) : (
              products.map((product, index) => (
                <tr key={product.id} className={getStripedRowClassName(index)}>
                  <td className="px-4 py-3">{product.product_code}</td>
                  <td className="px-4 py-3 font-medium text-[#0f2744]">
                    {product.product_name}
                  </td>
                  <td className="px-4 py-3">{product.unit_of_measure}</td>
                  <td className="px-4 py-3">
                    {formatInventoryQuantity(product.current_stock)}
                  </td>
                  <td className="px-4 py-3">
                    {formatInventoryMoney(product.standard_selling_price)}
                  </td>
                  {!readOnly ? (
                  <RegisterRowActions
                    onEdit={() => openEditForm(product)}
                    onDelete={() => handleDelete(product.id)}
                    deleting={deletingProductId === product.id}
                  />
                  ) : null}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </ScrollableTable>
    </div>
  );
}
