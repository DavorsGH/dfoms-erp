"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import {
  FINISHED_PRODUCT_SELECT,
  normalizeFinishedProduct,
  type FinishedProductRecord,
} from "../inventory/finished-products-utils";
import { formatInventoryQuantity } from "../inventory/inventory-utils";
import type { ClientEntry } from "../operations/clients-utils";
import RegisterRowActions, {
  getStripedRowClassName,
} from "../finance/register-row-actions";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import {
  buildVoidProductSaleConfirmMessage,
  calculateOutstanding,
  formatDate,
  formatGHS,
  getIncomeCustomerDisplayName,
  getProductSaleProductLabel,
  isProductSaleVoided,
  normalizeProductSaleEntry,
  PRODUCT_SALES_SELECT,
  type ProductSaleEntry,
} from "./product-sales-utils";
import ProductSalesBulkImport from "./product-sales-bulk-import";
import {
  buildProductSaleReceiptData,
  ProductSaleReceiptPanel,
  type ProductSaleReceiptData,
} from "./product-sale-receipt";

type ProductSalesProps = {
  initialEntries: ProductSaleEntry[];
  initialClients: ClientEntry[];
  initialFinishedProducts: FinishedProductRecord[];
  fetchError: string | null;
};

const emptyForm = {
  date: "",
  client_id: "",
  customer_name: "",
  product_id: "",
  sale_quantity: "",
  unit_price: "",
  amount_received: "",
  payment_status: "",
  due_date: "",
  notes: "",
};

const PAYMENT_STATUS_OPTIONS = ["Pending", "Partial", "Paid", "Overdue"];

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

export default function ProductSales({
  initialEntries,
  initialClients,
  initialFinishedProducts,
  fetchError,
}: ProductSalesProps) {
  const supabase = createClient();
  const [entries, setEntries] = useState(
    initialEntries.map(normalizeProductSaleEntry),
  );
  const [finishedProducts, setFinishedProducts] = useState(
    initialFinishedProducts.map(normalizeFinishedProduct),
  );
  const [showForm, setShowForm] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [form, setForm] = useState(emptyForm);
  const [loading, setLoading] = useState(false);
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(fetchError);
  const [receipt, setReceipt] = useState<ProductSaleReceiptData | null>(null);

  const calculatedAmount = useMemo(() => {
    const quantity = Number.parseFloat(form.sale_quantity);
    const unitPrice = Number.parseFloat(form.unit_price);
    if (Number.isNaN(quantity) || Number.isNaN(unitPrice)) {
      return 0;
    }

    return Math.round(quantity * unitPrice * 100) / 100;
  }, [form.sale_quantity, form.unit_price]);

  const previewOutstanding = calculateOutstanding(
    calculatedAmount,
    Number(form.amount_received) || 0,
  );

  useEffect(() => {
    if (!showForm) {
      return;
    }

    const client = createClient();

    async function loadProducts() {
      const { data, error: productError } = await client
        .from("finished_products")
        .select(FINISHED_PRODUCT_SELECT)
        .order("product_name", { ascending: true });

      if (productError) {
        setError(productError.message);
        return;
      }

      setFinishedProducts(
        ((data as FinishedProductRecord[] | null) ?? []).map((row) =>
          normalizeFinishedProduct(row),
        ),
      );
    }

    loadProducts();
  }, [showForm]);

  async function refreshEntries() {
    const { data, error: refreshError } = await supabase
      .from("income_register")
      .select(PRODUCT_SALES_SELECT)
      .eq("entry_type", "product_sale")
      .order("date", { ascending: false });

    if (refreshError) {
      setError(refreshError.message);
      return;
    }

    setEntries(
      ((data as ProductSaleEntry[] | null) ?? []).map((entry) =>
        normalizeProductSaleEntry(entry),
      ),
    );
    setError(null);
  }

  function openAddForm() {
    setShowBulkImport(false);
    setForm(emptyForm);
    setShowForm(true);
  }

  function closeForm() {
    setForm(emptyForm);
    setShowForm(false);
  }

  function openBulkImport() {
    setShowForm(false);
    setForm(emptyForm);
    setShowBulkImport(true);
  }

  function closeBulkImport() {
    setShowBulkImport(false);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);

    const amountReceived = Number(form.amount_received);
    const clientId = form.client_id.trim() || null;
    const otherPayerName = form.customer_name.trim() || null;

    if (!clientId && !otherPayerName) {
      setError("Select a contract client or enter an other payer name.");
      setLoading(false);
      return;
    }

    const quantity = Number.parseFloat(form.sale_quantity);
    const unitPrice = Number.parseFloat(form.unit_price);

    if (!form.product_id) {
      setError("Select a finished product.");
      setLoading(false);
      return;
    }

    if (Number.isNaN(quantity) || quantity <= 0) {
      setError("Quantity must be greater than zero.");
      setLoading(false);
      return;
    }

    if (Number.isNaN(unitPrice) || unitPrice < 0) {
      setError("Unit price must be zero or greater.");
      setLoading(false);
      return;
    }

    const product = finishedProducts.find((item) => item.id === form.product_id);
    if (product && product.current_stock < quantity) {
      setError(
        `Only ${formatInventoryQuantity(product.current_stock)} ${product.unit_of_measure} of ${product.product_name} in stock, cannot sell ${formatInventoryQuantity(quantity)}.`,
      );
      setLoading(false);
      return;
    }

    const { error: rpcError } = await supabase.rpc("create_product_sale", {
      p_date: form.date,
      // Blank → create_product_sale allocates via generate_next_code(..., 'PSI', 4).
      p_invoice_no: null,
      p_client_id: clientId,
      p_customer_name: clientId ? null : otherPayerName,
      p_product_id: form.product_id,
      p_quantity: quantity,
      p_unit_price: unitPrice,
      p_amount_received: amountReceived,
      p_payment_status: form.payment_status,
      p_due_date: form.due_date,
      p_description: null,
      p_notes: form.notes || null,
    });

    if (rpcError) {
      setError(rpcError.message);
      setLoading(false);
      return;
    }

    closeForm();
    await refreshEntries();
    setLoading(false);
  }

  function updateField(field: keyof typeof emptyForm, value: string) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function handleProductChange(productId: string) {
    const product = finishedProducts.find((item) => item.id === productId);
    setForm((current) => ({
      ...current,
      product_id: productId,
      unit_price:
        product?.standard_selling_price == null
          ? ""
          : String(product.standard_selling_price),
    }));
  }

  async function handleVoidSale(entry: ProductSaleEntry) {
    if (isProductSaleVoided(entry)) {
      return;
    }

    if (!window.confirm(buildVoidProductSaleConfirmMessage(entry))) {
      return;
    }

    setVoidingId(entry.id);
    setError(null);

    const { error: voidError } = await supabase.rpc("void_product_sale", {
      p_income_id: entry.id,
    });

    if (voidError) {
      setError(voidError.message);
      setVoidingId(null);
      return;
    }

    await refreshEntries();
    setVoidingId(null);
  }

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          Record external product sales, stock movements, and auto-posted COGS.
        </p>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => (showBulkImport ? closeBulkImport() : openBulkImport())}
            className="rounded-md border border-[#0f2744] px-4 py-2 text-sm font-medium text-[#0f2744] transition-colors hover:bg-slate-50"
          >
            {showBulkImport ? "Cancel Import" : "Bulk Import"}
          </button>
          <button
            type="button"
            onClick={() => (showForm ? closeForm() : openAddForm())}
            className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c]"
          >
            {showForm ? "Cancel" : "Add Sale"}
          </button>
        </div>
      </div>

      {error && (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      )}

      {receipt ? (
        <ProductSaleReceiptPanel
          receipt={receipt}
          onPrint={() => window.print()}
          onClose={() => setReceipt(null)}
        />
      ) : null}

      {showBulkImport ? (
        <ProductSalesBulkImport
          clients={initialClients}
          finishedProducts={finishedProducts}
          onClose={closeBulkImport}
          onImported={refreshEntries}
        />
      ) : null}

      {showForm && (
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-[#0f2744]">
            New Product Sale
          </h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Date
                </label>
                <input
                  type="date"
                  required
                  value={form.date}
                  onChange={(e) => updateField("date", e.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Invoice No.
                </label>
                <p className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
                  Assigned automatically on save
                </p>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Contract Customer
                </label>
                <select
                  value={form.client_id}
                  onChange={(e) => updateField("client_id", e.target.value)}
                  className={inputClassName}
                >
                  <option value="">Select contract client</option>
                  {initialClients.map((client) => (
                    <option key={client.client_id} value={client.client_id}>
                      {client.client_name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Other Payer Name
                </label>
                <input
                  type="text"
                  value={form.customer_name}
                  onChange={(e) => updateField("customer_name", e.target.value)}
                  placeholder="Optional — for one-off payers not in clients list"
                  disabled={Boolean(form.client_id)}
                  className={`${inputClassName}${form.client_id ? " bg-slate-50 text-slate-600" : ""}`}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Finished Product
                </label>
                <select
                  required
                  value={form.product_id}
                  onChange={(e) => handleProductChange(e.target.value)}
                  className={inputClassName}
                >
                  <option value="">Select product</option>
                  {finishedProducts.map((product) => (
                    <option key={product.id} value={product.id}>
                      {product.product_code} — {product.product_name} (
                      {formatInventoryQuantity(product.current_stock)}{" "}
                      {product.unit_of_measure} in stock)
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Quantity
                </label>
                <input
                  type="number"
                  min={0.0001}
                  step="0.0001"
                  required
                  value={form.sale_quantity}
                  onChange={(e) => updateField("sale_quantity", e.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Unit Price
                </label>
                <input
                  type="number"
                  min={0}
                  step="0.01"
                  required
                  value={form.unit_price}
                  onChange={(e) => updateField("unit_price", e.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Amount
                </label>
                <input
                  type="text"
                  readOnly
                  value={formatGHS(calculatedAmount)}
                  className={`${inputClassName} bg-slate-50 text-slate-700`}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Amount Received
                </label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  required
                  value={form.amount_received}
                  onChange={(e) => updateField("amount_received", e.target.value)}
                  className={inputClassName}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Payment Status
                </label>
                <select
                  required
                  value={form.payment_status}
                  onChange={(e) => updateField("payment_status", e.target.value)}
                  className={inputClassName}
                >
                  <option value="">Select status</option>
                  {PAYMENT_STATUS_OPTIONS.map((status) => (
                    <option key={status} value={status}>
                      {status}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Due Date
                </label>
                <input
                  type="date"
                  required
                  value={form.due_date}
                  onChange={(e) => updateField("due_date", e.target.value)}
                  className={inputClassName}
                />
              </div>
              <div className="md:col-span-2 xl:col-span-3">
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Notes
                </label>
                <textarea
                  rows={3}
                  value={form.notes}
                  onChange={(e) => updateField("notes", e.target.value)}
                  className={inputClassName}
                />
              </div>
            </div>

            <p className="text-sm text-slate-600">
              Outstanding Balance:{" "}
              <span className="font-medium text-[#0f2744]">
                {formatGHS(previewOutstanding)}
              </span>
            </p>

            <div className="flex gap-3">
              <button
                type="submit"
                disabled={loading}
                className="rounded-md bg-[#0f2744] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#1a3a5c] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {loading ? "Saving…" : "Save Sale"}
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
      )}

      <ScrollableTable>
        <table className={scrollableTableClassName}>
          <thead className={scrollableTableHeadClassName}>
            <tr>
              <th className={scrollableTableThClassName}>Date</th>
              <th className={scrollableTableThClassName}>Invoice No.</th>
              <th className={scrollableTableThClassName}>Customer</th>
              <th className={scrollableTableThClassName}>Product</th>
              <th className={scrollableTableThClassName}>Quantity</th>
              <th className={scrollableTableThClassName}>Unit Price</th>
              <th className={scrollableTableThClassName}>Amount</th>
              <th className={scrollableTableThClassName}>Amount Received</th>
              <th className={scrollableTableThClassName}>Payment Status</th>
              <th className={scrollableTableThClassName}>Status</th>
              <th className={scrollableTableThClassName}>Due Date</th>
              <th className={scrollableTableThClassName}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {entries.length === 0 ? (
              <tr>
                <td
                  colSpan={12}
                  className="px-4 py-8 text-center text-slate-500"
                >
                  No product sales recorded yet.
                </td>
              </tr>
            ) : (
              entries.map((entry, index) => {
                const voided = isProductSaleVoided(entry);

                return (
                <tr
                  key={entry.id}
                  className={`${getStripedRowClassName(index)}${voided ? " opacity-60" : ""}`}
                >
                  <td className="px-4 py-3">{formatDate(entry.date)}</td>
                  <td className="px-4 py-3">{entry.invoice_no}</td>
                  <td className="px-4 py-3">
                    {getIncomeCustomerDisplayName(entry, initialClients)}
                  </td>
                  <td className="px-4 py-3">{getProductSaleProductLabel(entry)}</td>
                  <td className="px-4 py-3">
                    {entry.sale_quantity?.toLocaleString("en-GB", {
                      minimumFractionDigits: 0,
                      maximumFractionDigits: 4,
                    }) ?? "—"}
                    {entry.product?.unit_of_measure
                      ? ` ${entry.product.unit_of_measure}`
                      : ""}
                  </td>
                  <td className="px-4 py-3">
                    {entry.unit_price == null ? "—" : formatGHS(entry.unit_price)}
                  </td>
                  <td className="px-4 py-3">{formatGHS(entry.amount)}</td>
                  <td className="px-4 py-3">
                    {formatGHS(entry.amount_received)}
                  </td>
                  <td className="px-4 py-3">{entry.payment_status}</td>
                  <td className="px-4 py-3">
                    {voided ? (
                      <span className="inline-flex rounded-full bg-slate-200 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                        Voided
                      </span>
                    ) : (
                      "Active"
                    )}
                  </td>
                  <td className="px-4 py-3">{formatDate(entry.due_date)}</td>
                  <RegisterRowActions
                    onEdit={() =>
                      setError(
                        "Product sales cannot be edited after posting. Void the sale instead if it was recorded in error.",
                      )
                    }
                    onPrint={() =>
                      setReceipt(
                        buildProductSaleReceiptData(entry, initialClients),
                      )
                    }
                    onVoid={() => void handleVoidSale(entry)}
                    disableEdit={
                      voided ||
                      entry.payment_status.trim().toLowerCase() === "paid"
                    }
                    disableVoid={voided}
                    voiding={voidingId === entry.id}
                  />
                </tr>
                );
              })
            )}
          </tbody>
        </table>
      </ScrollableTable>
    </div>
  );
}
