"use client";

import { confirmDialog } from "@/components/feedback/app-dialogs";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import DashboardButton from "@/components/dashboard-button";
import FinishedProductPhoto from "@/components/finished-product-photo";
import { syncProductSaleVfrsTax } from "@/utils/product-sale-tax-sync";
import { requestTenantAdminDirectorNotification } from "@/utils/request-tenant-admin-director-notification";
import { deleteTaxLedgerEntriesForSource } from "../finance/tax-ledger-sync";
import {
  FINISHED_PRODUCT_SELECT,
  normalizeFinishedProduct,
  type FinishedProductRecord,
} from "../inventory/finished-products-utils";
import {
  fetchScopedFinishedProductStock,
  mergeScopedStockOntoProducts,
  scopedFinishedProductsQuery,
} from "../inventory/finished-product-bu-stock-utils";
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
import {
  formatProductSaleStatusForDisplay,
  resolveIncomeOutstandingBalance,
} from "../finance/income-register-utils";
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
import SalesRepSelect from "@/components/sales-rep-select";
import type { HrEmployee } from "@/app/dashboard/hr-payroll/employee-utils";
import { useStampBusinessUnitId, useBusinessUnitReadScope } from "@/app/dashboard/business-unit-view-context";
import { applyBusinessUnitScope } from "@/utils/business-unit-view";
import {
  assertCanModifyBusinessUnitRow,
  formatBusinessUnitAccessError,
  loadWriteBusinessUnitContext,
  resolveWriteBusinessUnitIdForCreate,
} from "@/utils/business-unit-access";
import ProductSalesBulkImport from "./product-sales-bulk-import";
import RecordProductSalePaymentDialog from "./record-product-sale-payment-dialog";
import {
  buildProductSaleReceiptData,
  ProductSaleReceiptPanel,
  type ProductSaleReceiptData,
} from "./product-sale-receipt";
import ProductReturnModal from "./product-return-modal";
import { ProductSaleReturnBadge } from "./product-return-badge";
import {
  formatVoidProductSaleRpcError,
  getCreditNoteNumberFromEntry,
  isProductSaleReturn,
  isSaleLineFullyReturned,
  resolveProductSaleCancelBlockReason,
} from "./product-return-utils";
import { buildReturnedQtyByIncomeId } from "./sales/sales-register-utils";

function productSaleStatusLabel(entry: ProductSaleEntry): string {
  if (isProductSaleReturn(entry)) {
    return "Return";
  }
  return formatProductSaleStatusForDisplay(entry.sale_status);
}

type ProductSalesProps = {
  initialEntries: ProductSaleEntry[];
  initialClients: ClientEntry[];
  initialFinishedProducts: FinishedProductRecord[];
  initialPaymentMethods: string[];
  initialEmployees: HrEmployee[];
  defaultSalesRepId?: string;
  fetchError: string | null;
  /** Create-only stamp; null = All Businesses. */
  activeBusinessUnitId?: string | null;
  /** Workspace id for BU-scoped finished-product stock overlay. */
  tenantId?: string | null;
  /** When true, only forms/modals — list lives in Sales register. */
  embeddedInSalesRegister?: boolean;
  controlledShowForm?: boolean;
  onControlledShowFormChange?: (open: boolean) => void;
  controlledShowBulkImport?: boolean;
  onControlledShowBulkImportChange?: (open: boolean) => void;
  controlledEntries?: ProductSaleEntry[];
  onControlledEntriesChange?: (entries: ProductSaleEntry[]) => void;
  controlledReturnInvoiceNo?: string | null;
  onControlledReturnInvoiceNoChange?: (invoiceNo: string | null) => void;
  controlledRecordPaymentEntry?: ProductSaleEntry | null;
  onControlledRecordPaymentEntryChange?: (entry: ProductSaleEntry | null) => void;
  onRefreshEntriesReady?: (refresh: () => Promise<void>) => void;
  onRegisterMutationComplete?: () => void;
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
  initialEmployees,
  defaultSalesRepId = "",
  fetchError,
  activeBusinessUnitId = null,
  tenantId = null,
  embeddedInSalesRegister = false,
  controlledShowForm,
  onControlledShowFormChange,
  controlledShowBulkImport,
  onControlledShowBulkImportChange,
  controlledEntries,
  onControlledEntriesChange,
  controlledReturnInvoiceNo,
  onControlledReturnInvoiceNoChange,
  controlledRecordPaymentEntry,
  onControlledRecordPaymentEntryChange,
  onRefreshEntriesReady,
  onRegisterMutationComplete,
}: ProductSalesProps) {
  const supabase = createClient();
  const router = useRouter();
  const stampBusinessUnit = useStampBusinessUnitId();
  const buReadScope = useBusinessUnitReadScope();
  const skipFirstStockScopeRefresh = useRef(true);
  const [internalEntries, setInternalEntries] = useState(
    initialEntries.map(normalizeProductSaleEntry),
  );
  const entries = controlledEntries ?? internalEntries;
  const setEntries = onControlledEntriesChange ?? setInternalEntries;
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
  const [internalShowForm, setInternalShowForm] = useState(false);
  const [internalShowBulkImport, setInternalShowBulkImport] = useState(false);
  const showForm = controlledShowForm ?? internalShowForm;
  const setShowForm = onControlledShowFormChange ?? setInternalShowForm;
  const showBulkImport = controlledShowBulkImport ?? internalShowBulkImport;
  const setShowBulkImport =
    onControlledShowBulkImportChange ?? setInternalShowBulkImport;
  const [form, setForm] = useState(emptyForm);
  const [salesRepId, setSalesRepId] = useState(defaultSalesRepId);
  const [loading, setLoading] = useState(false);
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [internalReturnInvoiceNo, setInternalReturnInvoiceNo] = useState<
    string | null
  >(null);
  const returnInvoiceNo = controlledReturnInvoiceNo ?? internalReturnInvoiceNo;
  const setReturnInvoiceNo =
    onControlledReturnInvoiceNoChange ?? setInternalReturnInvoiceNo;
  const [returnedQtyByIncomeId, setReturnedQtyByIncomeId] = useState<
    Map<string, number>
  >(() => new Map());
  const [error, setError] = useState<string | null>(fetchError);
  const [receipt, setReceipt] = useState<ProductSaleReceiptData | null>(null);
  const [internalRecordPaymentEntry, setInternalRecordPaymentEntry] =
    useState<ProductSaleEntry | null>(null);
  const recordPaymentEntry =
    controlledRecordPaymentEntry ?? internalRecordPaymentEntry;
  const setRecordPaymentEntry =
    onControlledRecordPaymentEntryChange ?? setInternalRecordPaymentEntry;
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

  async function refreshFinishedProducts() {
    if (!tenantId) {
      setError("Unable to resolve your workspace.");
      return;
    }

    const { data, error: productError } = await scopedFinishedProductsQuery(
      supabase,
      buReadScope,
      FINISHED_PRODUCT_SELECT,
    )
      .eq("is_archived", false)
      .order("product_name", { ascending: true });

    if (productError) {
      setError(productError.message);
      return;
    }

    const { stockMap, error: stockScopeError } =
      await fetchScopedFinishedProductStock(supabase, tenantId, buReadScope);
    if (stockScopeError) {
      setError(stockScopeError);
      return;
    }

    setFinishedProducts(
      mergeScopedStockOntoProducts(
        ((data as FinishedProductRecord[] | null) ?? []).map((row) =>
          normalizeFinishedProduct(row),
        ),
        stockMap,
        buReadScope.mode,
      ),
    );
  }

  useEffect(() => {
    if (!showForm) {
      return;
    }
    void refreshFinishedProducts();
    // Fresh stock when opening the sale form.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional showForm trigger
  }, [showForm]);

  useEffect(() => {
    if (skipFirstStockScopeRefresh.current) {
      skipFirstStockScopeRefresh.current = false;
      return;
    }
    void refreshFinishedProducts();
    // Re-scope dropdown stock when the BU switcher changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional scope key
  }, [buReadScope.mode, buReadScope.mode === "unit" ? buReadScope.id : null]);

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

  useEffect(() => {
    void (async () => {
      const ids = entries
        .filter((entry) => !isProductSaleReturn(entry) && !isProductSaleVoided(entry))
        .map((entry) => entry.id);
      if (ids.length === 0) {
        setReturnedQtyByIncomeId(new Map());
        return;
      }
      const { data } = await supabase
        .from("credit_note_line_items")
        .select("source_income_register_id, quantity")
        .in("source_income_register_id", ids);
      setReturnedQtyByIncomeId(
        buildReturnedQtyByIncomeId(
          (data ?? []) as { source_income_register_id: string; quantity: number }[],
        ),
      );
    })();
  }, [entries, supabase]);

  useEffect(() => {
    onRefreshEntriesReady?.(refreshEntries);
  });

  function openAddForm() {
    setLoading(false);
    setShowBulkImport(false);
    setForm(emptyForm);
    setShowForm(true);
  }

  function closeForm() {
    setLoading(false);
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

    try {
    const buContext = await loadWriteBusinessUnitContext(supabase);
    if (!buContext.ok) {
      setError(buContext.error);
      return;
    }

    const stampResult = resolveWriteBusinessUnitIdForCreate({
      allowedUnits: buContext.allowedUnits,
      stamp: stampBusinessUnit,
    });
    if (!stampResult.ok) {
      setError(stampResult.error);
      return;
    }

    const amountReceived = Number(form.amount_received);
    const clientId = form.client_id.trim() || null;
    const otherPayerName = form.customer_name.trim() || null;

    if (!clientId && !otherPayerName) {
      setError("Select a contract client or enter an other payer name.");
      return;
    }

    const quantity = Number.parseFloat(form.sale_quantity);
    const unitPrice = Number.parseFloat(form.unit_price);

    if (!form.product_id) {
      setError("Select a finished product.");
      return;
    }

    if (Number.isNaN(quantity) || quantity <= 0) {
      setError("Quantity must be greater than zero.");
      return;
    }

    if (Number.isNaN(unitPrice) || unitPrice < 0) {
      setError("Unit price must be zero or greater.");
      return;
    }

    const amount = Math.round(quantity * unitPrice * 100) / 100;

    if (Number.isNaN(amountReceived) || amountReceived < 0) {
      setError("Amount paid now must be zero or greater.");
      return;
    }

    if (amountReceived > amount) {
      setError(
        `Amount paid now (${formatGHS(amountReceived)}) cannot exceed the sale total (${formatGHS(amount)}).`,
      );
      return;
    }

    const outstanding = calculateOutstanding(amount, amountReceived);
    if (outstanding > 0 && !form.due_date.trim()) {
      setError("Enter a due date for the remaining balance.");
      return;
    }

    const paymentStatus = deriveProductSalePaymentStatus(amount, amountReceived);

    const product = finishedProducts.find((item) => item.id === form.product_id);
    if (product && product.current_stock < quantity) {
      setError(
        `Only ${formatInventoryQuantity(product.current_stock)} ${product.unit_of_measure} of ${product.product_name} in stock, cannot sell ${formatInventoryQuantity(quantity)}.`,
      );
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
        p_sales_rep_id: salesRepId.trim() || null,
        p_business_unit_id: stampResult.businessUnitId,
      },
    );

    if (rpcError) {
      setError(rpcError.message);
      return;
    }

    requestTenantAdminDirectorNotification({
      title: "Large product sale recorded",
      detail: formatGHS(amount),
      thresholdAmount: amount,
      actionUrl: "/dashboard/crm/sales",
    });

    // VFRS output tax + tax ledger for the new sale. Non-fatal: the sale is
    // already posted, so a tax sync problem is surfaced as a warning.
    const { error: taxError } = await syncProductSaleVfrsTax(
      supabase,
      typeof createdIncomeId === "string" ? [createdIncomeId] : [],
    );

    closeForm();
    await refreshEntries();
    onRegisterMutationComplete?.();

    if (taxError) {
      setError(
        `Sale recorded, but the VFRS tax ledger could not be updated: ${taxError}`,
      );
    }
    } catch (unexpected) {
      setError(
        unexpected instanceof Error
          ? unexpected.message
          : "Unable to save the product sale.",
      );
    } finally {
      setLoading(false);
    }
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

    if (!(await confirmDialog({ message: buildVoidProductSaleConfirmMessage(entry) }))) {
      return;
    }

    setVoidingId(entry.id);
    setError(null);

    const buContext = await loadWriteBusinessUnitContext(supabase);
    if (!buContext.ok) {
      setError(buContext.error);
      setVoidingId(null);
      return;
    }

    try {
      assertCanModifyBusinessUnitRow(
        buContext.allowedUnits,
        entry.business_unit_id,
      );
    } catch (accessError) {
      setError(formatBusinessUnitAccessError(accessError));
      setVoidingId(null);
      return;
    }

    const { error: voidError } = await supabase.rpc("void_product_sale", {
      p_income_id: entry.id,
    });

    if (voidError) {
      setError(formatVoidProductSaleRpcError(voidError.message));
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
        `Sale cancelled, but its tax ledger entries could not be removed: ${ledgerError}`,
      );
    }

    setVoidingId(null);
  }

  return (
    <div className="min-w-0 space-y-6">
      {!embeddedInSalesRegister ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-slate-600">
            Record product sales with full or partial payment, stock movements, and
            auto-posted COGS. Remaining balances use the due date for reminders.
          </p>
          <div className="flex gap-2">
            <DashboardButton
              type="button"
              variant="secondary"
              onClick={() => (showBulkImport ? closeBulkImport() : openBulkImport())}
            >
              {showBulkImport ? "Cancel Import" : "Bulk Import"}
            </DashboardButton>
            <DashboardButton
              type="button"
              variant="primary"
              onClick={() => (showForm ? closeForm() : openAddForm())}
            >
              {showForm ? "Cancel" : "Add Sale"}
            </DashboardButton>
          </div>
        </div>
      ) : null}

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

      {returnInvoiceNo && tenantId ? (
        <ProductReturnModal
          invoiceNo={returnInvoiceNo}
          tenantId={tenantId}
          paymentMethods={initialPaymentMethods}
          onClose={() => setReturnInvoiceNo(null)}
          onSuccess={() => {
            void refreshEntries();
            router.refresh();
            onRegisterMutationComplete?.();
          }}
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
            void refreshEntries()
              .then(() => {
                onRegisterMutationComplete?.();
              })
              .finally(() => setRecordingPaymentId(null));
          }}
        />
      ) : null}

      {showBulkImport ? (
        <ProductSalesBulkImport
          clients={initialClients}
          finishedProducts={finishedProducts}
          activeBusinessUnitId={activeBusinessUnitId}
          onClose={closeBulkImport}
          onImported={async () => {
            await refreshEntries();
            onRegisterMutationComplete?.();
          }}
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
              <SalesRepSelect
                employees={initialEmployees}
                value={salesRepId}
                onChange={setSalesRepId}
                className={inputClassName}
                hint="Defaults to your employee record when linked. Change to assign another rep."
              />
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
              <DashboardButton
                type="submit"
                variant="success"
                disabled={loading}
              >
                {loading ? "Saving…" : "Save Sale"}
              </DashboardButton>
              <DashboardButton
                type="button"
                variant="secondary"
                onClick={closeForm}
                disabled={loading}
              >
                Cancel
              </DashboardButton>
            </div>
          </form>
        </section>
      )}

      {!embeddedInSalesRegister ? (
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
      ) : null}

      {!embeddedInSalesRegister ? (
      <ScrollableTable>
        <table className={scrollableTableClassName}>
          <thead className={scrollableTableHeadClassName}>
            <tr>
              <th className={scrollableTableThClassName}>Date</th>
              <th className={scrollableTableThClassName}>
                <RegisterColumnFilterHeader
                  label="Customer"
                  options={customerOptions}
                  applied={customerFilter}
                  onApply={setCustomerFilter}
                />
              </th>
              <th className={scrollableTableThClassName}>Invoice No.</th>
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
                const isReturn = isProductSaleReturn(entry);
                const returnedQty = returnedQtyByIncomeId.get(entry.id) ?? 0;
                const cancelBlockReason = resolveProductSaleCancelBlockReason({
                  saleQuantity: Number(entry.sale_quantity) || 0,
                  returnedQuantity: returnedQty,
                });
                const fullyReturned = isSaleLineFullyReturned(
                  Number(entry.sale_quantity) || 0,
                  returnedQty,
                );
                const creditNoteNo = getCreditNoteNumberFromEntry(entry);
                const outstanding = resolveIncomeOutstandingBalance({
                  amount: Number(entry.amount) || 0,
                  amount_received: Number(entry.amount_received) || 0,
                  outstanding_balance: entry.outstanding_balance,
                });
                const canRecordPayment =
                  !voided && !isReturn && outstanding > 0;

                return (
                <tr
                  key={entry.id}
                  className={`${getStripedRowClassName(index)}${voided || isReturn ? " opacity-60" : ""}`}
                >
                  <td className="px-4 py-3">{formatDate(entry.date)}</td>
                  <td className="px-4 py-3">
                    {getIncomeCustomerDisplayName(entry, initialClients)}
                  </td>
                  <td className="px-4 py-3">
                    {entry.invoice_no}
                    {isReturn && creditNoteNo ? (
                      <span className="mt-0.5 block text-xs text-slate-500">
                        {creditNoteNo}
                      </span>
                    ) : null}
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
                  <td
                    className={`px-4 py-3${isReturn ? " text-amber-900" : ""}`}
                  >
                    {formatGHS(entry.amount)}
                  </td>
                  <td className="px-4 py-3">
                    {formatGHS(entry.amount_received)}
                  </td>
                  <td className="px-4 py-3">{formatGHS(outstanding)}</td>
                  <td className="px-4 py-3">{entry.payment_status}</td>
                  <td className="px-4 py-3">
                    {isReturn ? (
                      <ProductSaleReturnBadge />
                    ) : voided ? (
                      <span className="inline-flex rounded-full bg-slate-200 px-2.5 py-0.5 text-xs font-medium text-slate-700">
                        Cancelled
                      </span>
                    ) : (
                      "Active"
                    )}
                  </td>
                  <td className="px-4 py-3">{formatDate(entry.due_date)}</td>
                  {isReturn ? (
                    <td className="px-4 py-3 text-sm text-slate-400">—</td>
                  ) : (
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
                      onReturn={
                        !voided
                          ? () => setReturnInvoiceNo(entry.invoice_no.trim())
                          : undefined
                      }
                      onVoid={
                        !fullyReturned
                          ? () => void handleVoidSale(entry)
                          : undefined
                      }
                      disableVoid={voided || cancelBlockReason != null}
                      voidDisabledTitle={cancelBlockReason ?? undefined}
                      voiding={voidingId === entry.id}
                      recordingPayment={recordingPaymentId === entry.id}
                    />
                  )}
                </tr>
                );
              })
            )}
          </tbody>
        </table>
      </ScrollableTable>
      ) : null}

      {!embeddedInSalesRegister ? (
      <RegisterFilteredTotal
        label="Amount total"
        total={visibleAmountTotal}
        visibleCount={visibleEntries.length}
        totalCount={entries.length}
      />
      ) : null}
    </div>
  );
}

export type { ProductSalesProps };
