"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/utils/supabase/client";
import FinishedProductPhoto from "@/components/finished-product-photo";
import { syncProductSaleVfrsTax } from "@/utils/product-sale-tax-sync";
import { requestTenantAdminDirectorNotification } from "@/utils/request-tenant-admin-director-notification";
import { deleteTaxLedgerEntriesForSource } from "../finance/tax-ledger-sync";
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
import {
  RegisterColumnFilterHeader,
  RegisterFilteredTotal,
  collectDistinctColumnValues,
  columnValuePassesFilter,
  type RegisterColumnFilterValue,
} from "../finance/register-column-filter";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableThClassName,
} from "../scrollable-table";
import FilteredListCount, {
  anyRegisterColumnFiltersActive,
} from "../filtered-list-count";
import { resolveIncomeOutstandingBalance } from "../finance/income-register-utils";
import {
  buildVoidProductSaleConfirmMessage,
  calculateOutstanding,
  deriveProductSalePaymentStatus,
  formatDate,
  formatGHS,
  getIncomeCustomerDisplayName,
  getProductSaleProductLabel,
  isProductSaleVoided,
  normalizeProductSaleEntry,
  PRODUCT_SALES_SELECT,
  type ProductSaleEntry,
} from "./product-sales-utils";
import { useStampBusinessUnitId, useBusinessUnitReadScope } from "@/app/dashboard/business-unit-view-context";
import { applyBusinessUnitScope } from "@/utils/business-unit-view";
import ProductSalesBulkImport from "./product-sales-bulk-import";
import RecordProductSalePaymentDialog from "./record-product-sale-payment-dialog";
import {
  buildProductSaleReceiptData,
  ProductSaleReceiptPanel,
  type ProductSaleReceiptData,
} from "./product-sale-receipt";

function productSaleStatusLabel(entry: ProductSaleEntry): string {
  return isProductSaleVoided(entry) ? "Voided" : "Active";
}

type ProductSalesProps = {
  initialEntries: ProductSaleEntry[];
  initialClients: ClientEntry[];
  initialFinishedProducts: FinishedProductRecord[];
  initialPaymentMethods: string[];
  fetchError: string | null;
  /** Create-only stamp; null = All Businesses. */
  activeBusinessUnitId?: string | null;
};

const emptyForm = {
  date: "",
  client_id: "",
  customer_name: "",
  product_id: "",
  sale_quantity: "",
  unit_price: "",
  amount_received: "0",
  due_date: "",
  notes: "",
};

const inputClassName =
  "w-full rounded-md border border-slate-300 px-3 py-2 text-sm text-slate-900 outline-none focus:border-[#0f2744] focus:ring-1 focus:ring-[#0f2744]";

export default function ProductSales({
  initialEntries,
  initialClients,
  initialFinishedProducts,
  initialPaymentMethods,
  fetchError,
  activeBusinessUnitId = null,
}: ProductSalesProps) {
  const supabase = createClient();
  const stampBusinessUnit = useStampBusinessUnitId();
  const buReadScope = useBusinessUnitReadScope();
  const [entries, setEntries] = useState(
    initialEntries.map(normalizeProductSaleEntry),
  );
  const [customerFilter, setCustomerFilter] =
    useState<RegisterColumnFilterValue>(null);
  const [productFilter, setProductFilter] =
    useState<RegisterColumnFilterValue>(null);
  const [paymentStatusFilter, setPaymentStatusFilter] =
    useState<RegisterColumnFilterValue>(null);
  const [statusFilter, setStatusFilter] =
    useState<RegisterColumnFilterValue>(null);
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
  const [recordPaymentEntry, setRecordPaymentEntry] =
    useState<ProductSaleEntry | null>(null);
  const [recordingPaymentId, setRecordingPaymentId] = useState<string | null>(
    null,
  );

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

  const previewPaymentStatus = deriveProductSalePaymentStatus(
    calculatedAmount,
    Number(form.amount_received) || 0,
  );

  const dueDateRequired = previewOutstanding > 0;

  const customerOptions = useMemo(
    () =>
      collectDistinctColumnValues(
        entries
          .filter(
            (entry) =>
              columnValuePassesFilter(
                getProductSaleProductLabel(entry),
                productFilter,
              ) &&
              columnValuePassesFilter(
                entry.payment_status,
                paymentStatusFilter,
              ) &&
              columnValuePassesFilter(
                productSaleStatusLabel(entry),
                statusFilter,
              ),
          )
          .map((entry) =>
            getIncomeCustomerDisplayName(entry, initialClients),
          ),
      ),
    [
      entries,
      productFilter,
      paymentStatusFilter,
      statusFilter,
      initialClients,
    ],
  );

  const productOptions = useMemo(
    () =>
      collectDistinctColumnValues(
        entries
          .filter(
            (entry) =>
              columnValuePassesFilter(
                getIncomeCustomerDisplayName(entry, initialClients),
                customerFilter,
              ) &&
              columnValuePassesFilter(
                entry.payment_status,
                paymentStatusFilter,
              ) &&
              columnValuePassesFilter(
                productSaleStatusLabel(entry),
                statusFilter,
              ),
          )
          .map((entry) => getProductSaleProductLabel(entry)),
      ),
    [
      entries,
      customerFilter,
      paymentStatusFilter,
      statusFilter,
      initialClients,
    ],
  );

  const paymentStatusOptions = useMemo(
    () =>
      collectDistinctColumnValues(
        entries
          .filter(
            (entry) =>
              columnValuePassesFilter(
                getIncomeCustomerDisplayName(entry, initialClients),
                customerFilter,
              ) &&
              columnValuePassesFilter(
                getProductSaleProductLabel(entry),
                productFilter,
              ) &&
              columnValuePassesFilter(
                productSaleStatusLabel(entry),
                statusFilter,
              ),
          )
          .map((entry) => entry.payment_status),
      ),
    [entries, customerFilter, productFilter, statusFilter, initialClients],
  );

  const statusOptions = useMemo(
    () =>
      collectDistinctColumnValues(
        entries
          .filter(
            (entry) =>
              columnValuePassesFilter(
                getIncomeCustomerDisplayName(entry, initialClients),
                customerFilter,
              ) &&
              columnValuePassesFilter(
                getProductSaleProductLabel(entry),
                productFilter,
              ) &&
              columnValuePassesFilter(
                entry.payment_status,
                paymentStatusFilter,
              ),
          )
          .map((entry) => productSaleStatusLabel(entry)),
      ),
    [
      entries,
      customerFilter,
      productFilter,
      paymentStatusFilter,
      initialClients,
    ],
  );

  const visibleEntries = useMemo(
    () =>
      entries.filter(
        (entry) =>
          columnValuePassesFilter(
            getIncomeCustomerDisplayName(entry, initialClients),
            customerFilter,
          ) &&
          columnValuePassesFilter(
            getProductSaleProductLabel(entry),
            productFilter,
          ) &&
          columnValuePassesFilter(
            entry.payment_status,
            paymentStatusFilter,
          ) &&
          columnValuePassesFilter(
            productSaleStatusLabel(entry),
            statusFilter,
          ),
      ),
    [
      entries,
      customerFilter,
      productFilter,
      paymentStatusFilter,
      statusFilter,
      initialClients,
    ],
  );

  const visibleAmountTotal = useMemo(() => {
    let total = 0;
    for (const entry of visibleEntries) {
      total += Number(entry.amount) || 0;
    }
    return Math.round(total * 100) / 100;
  }, [visibleEntries]);

  useEffect(() => {
    if (!showForm) {
      return;
    }

    const client = createClient();

    async function loadProducts() {
      const { data, error: productError } = await client
        .from("finished_products")
        .select(FINISHED_PRODUCT_SELECT)
        .eq("is_archived", false)
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
    const { data, error: refreshError } = await applyBusinessUnitScope(
      supabase
        .from("income_register")
        .select(PRODUCT_SALES_SELECT)
        .eq("entry_type", "product_sale"),
      buReadScope,
    ).order("date", { ascending: false });

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

    if (!stampBusinessUnit.ok) {
      setError(stampBusinessUnit.error);
      setLoading(false);
      return;
    }

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

    const amount = Math.round(quantity * unitPrice * 100) / 100;

    if (Number.isNaN(amountReceived) || amountReceived < 0) {
      setError("Amount paid now must be zero or greater.");
      setLoading(false);
      return;
    }

    if (amountReceived > amount) {
      setError(
        `Amount paid now (${formatGHS(amountReceived)}) cannot exceed the sale total (${formatGHS(amount)}).`,
      );
      setLoading(false);
      return;
    }

    const outstanding = calculateOutstanding(amount, amountReceived);
    if (outstanding > 0 && !form.due_date.trim()) {
      setError("Enter a due date for the remaining balance.");
      setLoading(false);
      return;
    }

    const paymentStatus = deriveProductSalePaymentStatus(amount, amountReceived);

    const product = finishedProducts.find((item) => item.id === form.product_id);
    if (product && product.current_stock < quantity) {
      setError(
        `Only ${formatInventoryQuantity(product.current_stock)} ${product.unit_of_measure} of ${product.product_name} in stock, cannot sell ${formatInventoryQuantity(quantity)}.`,
      );
      setLoading(false);
      return;
    }

    const { data: createdIncomeId, error: rpcError } = await supabase.rpc(
      "create_product_sale",
      {
        p_date: form.date,
        // Blank → create_product_sale allocates via generate_next_code(..., 'PSI', 4).
        p_invoice_no: null,
        p_client_id: clientId,
        p_customer_name: clientId ? null : otherPayerName,
        p_product_id: form.product_id,
        p_quantity: quantity,
        p_unit_price: unitPrice,
        p_amount_received: amountReceived,
        p_payment_status: paymentStatus,
        p_due_date: outstanding > 0 ? form.due_date : form.due_date || form.date,
        p_description: null,
        p_notes: form.notes || null,
        p_business_unit_id: stampBusinessUnit.businessUnitId,
      },
    );

    if (rpcError) {
      setError(rpcError.message);
      setLoading(false);
      return;
    }

    requestTenantAdminDirectorNotification({
      title: "Large product sale recorded",
      detail: formatGHS(amount),
      thresholdAmount: amount,
      actionUrl: "/dashboard/crm/product-sales",
    });

    // VFRS output tax + tax ledger for the new sale. Non-fatal: the sale is
    // already posted, so a tax sync problem is surfaced as a warning.
    const { error: taxError } = await syncProductSaleVfrsTax(
      supabase,
      typeof createdIncomeId === "string" ? [createdIncomeId] : [],
    );

    closeForm();
    await refreshEntries();

    if (taxError) {
      setError(
        `Sale recorded, but the VFRS tax ledger could not be updated: ${taxError}`,
      );
    }

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

  const selectedProduct = useMemo(
    () => finishedProducts.find((product) => product.id === form.product_id) ?? null,
    [finishedProducts, form.product_id],
  );

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

    // A voided sale owes no output tax, so drop its tax ledger legs.
    const { error: ledgerError } = await deleteTaxLedgerEntriesForSource(
      supabase,
      "income_register",
      entry.id,
    );

    await refreshEntries();

    if (ledgerError) {
      setError(
        `Sale voided, but its tax ledger entries could not be removed: ${ledgerError}`,
      );
    }

    setVoidingId(null);
  }

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          Record product sales with full or partial payment, stock movements, and
          auto-posted COGS. Remaining balances use the due date for reminders.
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

      {recordPaymentEntry ? (
        <RecordProductSalePaymentDialog
          incomeId={recordPaymentEntry.id}
          invoiceNo={recordPaymentEntry.invoice_no}
          outstanding={resolveIncomeOutstandingBalance({
            amount: Number(recordPaymentEntry.amount) || 0,
            amount_received: Number(recordPaymentEntry.amount_received) || 0,
            outstanding_balance: recordPaymentEntry.outstanding_balance,
          })}
          paymentMethods={initialPaymentMethods}
          onClose={() => setRecordPaymentEntry(null)}
          onSuccess={() => {
            setRecordingPaymentId(recordPaymentEntry.id);
            void refreshEntries().finally(() => setRecordingPaymentId(null));
          }}
        />
      ) : null}

      {showBulkImport ? (
        <ProductSalesBulkImport
          clients={initialClients}
          finishedProducts={finishedProducts}
          activeBusinessUnitId={activeBusinessUnitId}
          onClose={closeBulkImport}
          onImported={refreshEntries}
        />
      ) : null}

      {showForm && (
        <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 text-lg font-semibold text-[#0f2744]">
            New Product Sale
          </h2>
          <p className="mb-4 text-sm text-slate-600">
            Enter quantity and unit price for the total. Pay in full now, or enter
            a partial amount paid and a due date for the balance.
          </p>
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
                <div className="flex flex-wrap items-center gap-3">
                  <FinishedProductPhoto
                    photoUrl={selectedProduct?.photo_url}
                    productName={selectedProduct?.product_name}
                    size="md"
                  />
                  <select
                    required
                    value={form.product_id}
                    onChange={(e) => handleProductChange(e.target.value)}
                    className={`${inputClassName} min-w-[min(100%,280px)] flex-1`}
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
                  Total Amount
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
                  Amount Paid Now
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
                <p className="mt-1 text-xs text-slate-500">
                  Enter 0 for unpaid, less than total for a partial payment, or the
                  full total to mark paid.
                </p>
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Payment Status
                </label>
                <input
                  type="text"
                  readOnly
                  value={previewPaymentStatus}
                  className={`${inputClassName} bg-slate-50 text-slate-700`}
                />
              </div>
              <div>
                <label className="mb-1 block text-sm font-medium text-slate-700">
                  Due Date{dueDateRequired ? "" : " (optional)"}
                </label>
                <input
                  type="date"
                  required={dueDateRequired}
                  value={form.due_date}
                  onChange={(e) => updateField("due_date", e.target.value)}
                  className={inputClassName}
                />
                {dueDateRequired ? (
                  <p className="mt-1 text-xs text-slate-500">
                    Required for the remaining balance. Reminders fire ~3 days
                    before and when overdue.
                  </p>
                ) : null}
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
              Remaining Balance:{" "}
              <span className="font-medium text-[#0f2744]">
                {formatGHS(previewOutstanding)}
              </span>
              {previewOutstanding > 0 ? (
                <span className="text-slate-500">
                  {" "}
                  (total − amount paid now)
                </span>
              ) : null}
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

      <FilteredListCount
        filteredCount={visibleEntries.length}
        totalCount={entries.length}
        itemSingular="sale"
        hasActiveFilters={anyRegisterColumnFiltersActive(
          customerFilter,
          productFilter,
          paymentStatusFilter,
          statusFilter,
        )}
      />

      <ScrollableTable>
        <table className={scrollableTableClassName}>
          <thead className={scrollableTableHeadClassName}>
            <tr>
              <th className={scrollableTableThClassName}>Date</th>
              <th className={scrollableTableThClassName}>Invoice No.</th>
              <th className={scrollableTableThClassName}>
                <RegisterColumnFilterHeader
                  label="Customer"
                  options={customerOptions}
                  applied={customerFilter}
                  onApply={setCustomerFilter}
                />
              </th>
              <th className={scrollableTableThClassName}>
                <RegisterColumnFilterHeader
                  label="Product"
                  options={productOptions}
                  applied={productFilter}
                  onApply={setProductFilter}
                />
              </th>
              <th className={scrollableTableThClassName}>Quantity</th>
              <th className={scrollableTableThClassName}>Unit Price</th>
              <th className={scrollableTableThClassName}>Amount</th>
              <th className={scrollableTableThClassName}>Amount Received</th>
              <th className={scrollableTableThClassName}>Outstanding</th>
              <th className={scrollableTableThClassName}>
                <RegisterColumnFilterHeader
                  label="Payment Status"
                  options={paymentStatusOptions}
                  applied={paymentStatusFilter}
                  onApply={setPaymentStatusFilter}
                />
              </th>
              <th className={scrollableTableThClassName}>
                <RegisterColumnFilterHeader
                  label="Status"
                  options={statusOptions}
                  applied={statusFilter}
                  onApply={setStatusFilter}
                />
              </th>
              <th className={scrollableTableThClassName}>Due Date</th>
              <th className={scrollableTableThClassName}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {entries.length === 0 ? (
              <tr>
                <td
                  colSpan={13}
                  className="px-4 py-8 text-center text-slate-500"
                >
                  No product sales recorded yet.
                </td>
              </tr>
            ) : visibleEntries.length === 0 ? (
              <tr>
                <td
                  colSpan={13}
                  className="px-4 py-8 text-center text-slate-500"
                >
                  No entries match the current filters.
                </td>
              </tr>
            ) : (
              visibleEntries.map((entry, index) => {
                const voided = isProductSaleVoided(entry);
                const outstanding = resolveIncomeOutstandingBalance({
                  amount: Number(entry.amount) || 0,
                  amount_received: Number(entry.amount_received) || 0,
                  outstanding_balance: entry.outstanding_balance,
                });
                const canRecordPayment = !voided && outstanding > 0;

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
                  <td className="px-4 py-3">{formatGHS(outstanding)}</td>
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
                    onPrint={() =>
                      setReceipt(
                        buildProductSaleReceiptData(entry, initialClients),
                      )
                    }
                    onRecordPayment={
                      canRecordPayment
                        ? () => setRecordPaymentEntry(entry)
                        : undefined
                    }
                    onVoid={() => void handleVoidSale(entry)}
                    disableVoid={voided}
                    voiding={voidingId === entry.id}
                    recordingPayment={recordingPaymentId === entry.id}
                  />
                </tr>
                );
              })
            )}
          </tbody>
        </table>
      </ScrollableTable>

      <RegisterFilteredTotal
        label="Amount total"
        total={visibleAmountTotal}
        visibleCount={visibleEntries.length}
        totalCount={entries.length}
      />
    </div>
  );
}
