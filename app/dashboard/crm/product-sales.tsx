"use client";

import { confirmDialog } from "@/components/feedback/app-dialogs";
import { useAlert, useToast } from "@/components/feedback/feedback-context";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  SALES_CRM_ALERT_TITLE,
  clientFacingSalesCrmError,
} from "@/lib/crm/sales-crm-notifications";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import DashboardButton from "@/components/dashboard-button";
import FinishedProductPhoto from "@/components/finished-product-photo";
import { syncProductSaleVfrsTax } from "@/utils/product-sale-tax-sync";
import {
  isManualSalePaymentMethod,
  MANUAL_SALE_PAYMENT_METHODS,
  notesWithPaymentMethod,
} from "@/utils/product-sale-payments-types";
import {
  isPaystackCollectMethod,
  manualSalePaystackChargeAmount,
  type ManualSaleCollectionMode,
} from "@/utils/manual-sale-paystack";
import { notesWithTransactionReference } from "@/utils/manual-sale-paystack";
import ManualSaleCollectionFields from "./manual-sale-collection-fields";
import { openManualSalePaystackInline } from "./manual-sale-paystack-client";
import RequestPaymentModal from "@/app/dashboard/pos/request-payment-modal";
import type { PosCartLine } from "@/app/dashboard/pos/pos-utils";
import {
  POS_MANUAL_SALE_HANDOFF_MISSING_MESSAGE,
  POS_MANUAL_SALE_HANDOFF_PARAM,
  POS_MANUAL_SALE_RESTORE_PARAM,
  allocateAmountReceivedAcrossLines,
  consumePosManualSaleHandoff,
  formatPosManualSaleSavedToast,
  manualSaleLinesTotal,
  writePosManualSaleHandoff,
  type PosManualSaleHandoffLine,
  type PosManualSaleHandoffPayload,
} from "@/app/dashboard/pos/pos-manual-sale-handoff";
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
  createRegisterDateSortState,
  registerColumnSortConfig,
  registerTieBreakByIdDesc,
  sortRegisterRows,
  type RegisterColumnFilterValue,
  type RegisterColumnSortState,
  type RegisterColumnSortValueType,
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
import { verifyFinishedProductMatchesWriteBusinessUnit } from "@/lib/inventory/inventory-item-business-unit-guard.client";
import RecordProductSalePaymentDialog from "./record-product-sale-payment-dialog";
import {
  buildProductSaleReceiptData,
  ProductSaleReceiptPanel,
  withReceiptPaymentLines,
  type ProductSaleReceiptData,
} from "./product-sale-receipt";
import { buildReceiptPaymentLines } from "../pos/receipt-settlement";
import { PRODUCT_SALE_PAYMENT_SELECT } from "@/utils/product-sale-payments-types";
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
import MobileMoneyNotSetupModal from "@/components/mobile-money-not-setup-modal";
import { mobileMoneyPaymentMethodOptionLabel } from "@/utils/product-sale-paystack";

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
  viewerRole?: string | null;
  /** False when Paystack settlement is not configured for MoMo collection. */
  mobileMoneyCollectionReady?: boolean;
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
  payment_method: "",
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
  viewerRole = null,
  mobileMoneyCollectionReady = true,
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
  const { alertError } = useAlert();

  function showActionError(message: string) {
    void alertError(clientFacingSalesCrmError(message), {
      title: SALES_CRM_ALERT_TITLE,
    });
  }

  useEffect(() => {
    if (fetchError) {
      void alertError(clientFacingSalesCrmError(fetchError, "Could not load."), {
        title: SALES_CRM_ALERT_TITLE,
      });
    }
  }, [fetchError, alertError]);

  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { toast } = useToast();
  const stampBusinessUnit = useStampBusinessUnitId();
  const buReadScope = useBusinessUnitReadScope();
  const skipFirstStockScopeRefresh = useRef(true);
  const posHandoffAppliedRef = useRef(false);
  const posHandoffSessionRef = useRef<{
    id: string;
    payload: PosManualSaleHandoffPayload;
  } | null>(null);
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
  const [columnSort, setColumnSort] = useState<RegisterColumnSortState | null>(
    () => createRegisterDateSortState("date"),
  );
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
  const [posHandoffLines, setPosHandoffLines] = useState<
    PosManualSaleHandoffLine[] | null
  >(null);
  const [posHandoffMissingOpen, setPosHandoffMissingOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [collectionMode, setCollectionMode] =
    useState<ManualSaleCollectionMode>("received");
  const [transactionReference, setTransactionReference] = useState("");
  const [payerEmail, setPayerEmail] = useState("");
  const [payerPhone, setPayerPhone] = useState("");
  const [paymentLinkDraft, setPaymentLinkDraft] = useState<{
    cartLines: PosCartLine[];
    saleDate: string;
    clientId: string | null;
    customerName: string | null;
    notes: string | null;
    dueDate: string;
    paymentMethod: string;
    amountGhs: number;
    email: string;
    phone: string;
    salesRepId: string | null;
    businessUnitId: string | null;
  } | null>(null);
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
  const [momoNotSetupOpen, setMomoNotSetupOpen] = useState(false);

  const calculatedAmount = useMemo(() => {
    if (posHandoffLines && posHandoffLines.length > 0) {
      return manualSaleLinesTotal(posHandoffLines);
    }
    const quantity = Number.parseFloat(form.sale_quantity);
    const unitPrice = Number.parseFloat(form.unit_price);
    if (Number.isNaN(quantity) || Number.isNaN(unitPrice)) {
      return 0;
    }

    return Math.round(quantity * unitPrice * 100) / 100;
  }, [form.sale_quantity, form.unit_price, posHandoffLines]);

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

  const columnSortConfig = useCallback(
    (columnId: string, valueType: RegisterColumnSortValueType) =>
      registerColumnSortConfig(columnId, valueType, columnSort, setColumnSort),
    [columnSort],
  );

  const productSaleSortValue = useCallback(
    (entry: ProductSaleEntry, columnId: string) => {
      switch (columnId) {
        case "date":
          return entry.date;
        case "customer":
          return getIncomeCustomerDisplayName(entry, initialClients);
        case "product":
          return getProductSaleProductLabel(entry);
        case "payment_status":
          return entry.payment_status;
        case "status":
          return productSaleStatusLabel(entry);
        default:
          return "";
      }
    },
    [initialClients],
  );

  const visibleEntries = useMemo(() => {
    const filtered = entries.filter(
      (entry) =>
        columnValuePassesFilter(
          getIncomeCustomerDisplayName(entry, initialClients),
          customerFilter,
        ) &&
        columnValuePassesFilter(
          getProductSaleProductLabel(entry),
          productFilter,
        ) &&
        columnValuePassesFilter(entry.payment_status, paymentStatusFilter) &&
        columnValuePassesFilter(productSaleStatusLabel(entry), statusFilter),
    );
    const activeSort = columnSort ?? createRegisterDateSortState("date");
    return sortRegisterRows(
      filtered,
      activeSort,
      (entry) => productSaleSortValue(entry, activeSort.columnId),
      registerTieBreakByIdDesc,
    );
  }, [
    entries,
    customerFilter,
    productFilter,
    paymentStatusFilter,
    statusFilter,
    initialClients,
    columnSort,
    productSaleSortValue,
  ]);

  const visibleAmountTotal = useMemo(() => {
    let total = 0;
    for (const entry of visibleEntries) {
      total += Number(entry.amount) || 0;
    }
    return Math.round(total * 100) / 100;
  }, [visibleEntries]);

  async function refreshFinishedProducts() {
    if (!tenantId) {
      showActionError("Unable to resolve your workspace.");
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
      showActionError(productError.message);
      return;
    }

    const { stockMap, error: stockScopeError } =
      await fetchScopedFinishedProductStock(supabase, tenantId, buReadScope);
    if (stockScopeError) {
      showActionError(stockScopeError);
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
      showActionError(refreshError.message);
      return;
    }

    setEntries(
      ((data as ProductSaleEntry[] | null) ?? []).map((entry) =>
        normalizeProductSaleEntry(entry),
      ),
    );
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

  function clearPosHandoffSession() {
    posHandoffSessionRef.current = null;
    setPosHandoffLines(null);
  }

  function returnToPosWithHandoffRestore() {
    const session = posHandoffSessionRef.current;
    if (!session) {
      return false;
    }
    posHandoffSessionRef.current = null;
    setPosHandoffLines(null);
    writePosManualSaleHandoff(session.payload, session.id);
    router.push(
      `/dashboard/pos?${POS_MANUAL_SALE_RESTORE_PARAM}=${encodeURIComponent(session.id)}`,
    );
    return true;
  }

  function applyPosHandoffPrefill(payload: PosManualSaleHandoffPayload) {
    const { prefill } = payload;
    const first = prefill.lines[0];
    setPosHandoffLines(
      prefill.lines.length > 1
        ? prefill.lines.map((line) => ({ ...line }))
        : null,
    );
    setForm({
      date: prefill.saleDate || emptyForm.date,
      client_id: prefill.clientId ?? "",
      customer_name: prefill.customerName ?? "",
      product_id: first?.productId ?? "",
      sale_quantity: first ? String(first.quantity) : "",
      unit_price: first ? String(first.unitPrice) : "",
      amount_received: String(prefill.amountReceived),
      due_date: prefill.dueDate ?? "",
      payment_method: prefill.paymentMethod || "",
      notes: prefill.notes,
    });
    setSalesRepId(prefill.salesRepId ?? defaultSalesRepId);
    setCollectionMode("received");
  }

  useEffect(() => {
    if (posHandoffAppliedRef.current) {
      return;
    }
    const handoffId =
      searchParams.get(POS_MANUAL_SALE_HANDOFF_PARAM)?.trim() ?? "";
    if (!handoffId) {
      return;
    }
    posHandoffAppliedRef.current = true;
    const payload = consumePosManualSaleHandoff(handoffId);
    const params = new URLSearchParams(searchParams.toString());
    params.delete(POS_MANUAL_SALE_HANDOFF_PARAM);
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
    setShowBulkImport(false);
    setShowForm(true);
    setLoading(false);
    if (!payload || payload.prefill.lines.length === 0) {
      setForm(emptyForm);
      setPosHandoffLines(null);
      posHandoffSessionRef.current = null;
      setPosHandoffMissingOpen(true);
      return;
    }
    posHandoffSessionRef.current = { id: handoffId, payload };
    applyPosHandoffPrefill(payload);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-time URL handoff
  }, [searchParams, pathname, router]);

  const posHandoffFormWasOpenRef = useRef(false);
  useEffect(() => {
    if (showForm) {
      posHandoffFormWasOpenRef.current = true;
      return;
    }
    if (!posHandoffFormWasOpenRef.current) {
      return;
    }
    posHandoffFormWasOpenRef.current = false;
    if (!posHandoffSessionRef.current) {
      return;
    }
    returnToPosWithHandoffRestore();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- close form / Cancel returns to POS
  }, [showForm]);

  function openAddForm() {
    setLoading(false);
    setShowBulkImport(false);
    clearPosHandoffSession();
    setForm(emptyForm);
    setShowForm(true);
  }

  function resetCollection() {
    setCollectionMode("received");
    setTransactionReference("");
    setPayerEmail("");
    setPayerPhone("");
    setPaymentLinkDraft(null);
  }

  function closeForm() {
    setLoading(false);
    setForm(emptyForm);
    resetCollection();
    if (posHandoffSessionRef.current) {
      setShowForm(false);
      return;
    }
    clearPosHandoffSession();
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

  async function buildPaystackCart(contact: "email" | "either" = "email"): Promise<{
    cartLine: PosCartLine;
    saleDate: string;
    clientId: string | null;
    customerName: string | null;
    notes: string | null;
    dueDate: string;
    amountGhs: number;
    businessUnitId: string | null;
  } | null> {
    const amountReceived = Number(form.amount_received);
    if (!isPaystackCollectMethod(form.payment_method)) {
      showActionError("Choose Mobile Money or Card to collect with Paystack.");
      return null;
    }
    const quantity = Number.parseFloat(form.sale_quantity);
    const unitPrice = Number.parseFloat(form.unit_price);
    const amount = Math.round(quantity * unitPrice * 100) / 100;
    const charge = manualSalePaystackChargeAmount(amount, amountReceived);
    if (charge == null) {
      showActionError("Amount paid now must be greater than zero and not above the sale total.");
      return null;
    }
    const clientId = form.client_id.trim() || null;
    const customerName = form.customer_name.trim() || null;
    if (!clientId && !customerName) {
      showActionError("Select a contract client or enter an other payer name.");
      return null;
    }
    if (!form.product_id || Number.isNaN(quantity) || quantity <= 0) {
      showActionError("Select a product and a quantity greater than zero.");
      return null;
    }
    if (charge + 0.001 < amount && !form.due_date.trim()) {
      showActionError("Enter a due date for the remaining balance.");
      return null;
    }
    const product = finishedProducts.find((item) => item.id === form.product_id);
    if (!product) {
      showActionError("Select a finished product.");
      return null;
    }
    if (product.current_stock < quantity) {
      showActionError(
        `Only ${formatInventoryQuantity(product.current_stock)} ${product.unit_of_measure} of ${product.product_name} in stock, cannot sell ${formatInventoryQuantity(quantity)}.`,
      );
      return null;
    }
    const buContext = await loadWriteBusinessUnitContext(supabase);
    if (!buContext.ok) {
      showActionError(buContext.error);
      return null;
    }
    const stampResult = resolveWriteBusinessUnitIdForCreate({
      allowedUnits: buContext.allowedUnits,
      stamp: stampBusinessUnit,
    });
    if (!stampResult.ok) {
      showActionError(stampResult.error);
      return null;
    }
    const emailReady = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(payerEmail.trim());
    if (contact === "email" && !emailReady) {
      showActionError("Enter the payer's email address.");
      return null;
    }
    if (contact === "either" && !emailReady && !payerPhone.trim()) {
      showActionError("Enter the payer's email or phone number.");
      return null;
    }
    return {
      cartLine: {
        id: product.id,
        productId: product.id,
        productCode: product.product_code,
        productName: product.product_name,
        unitOfMeasure: product.unit_of_measure,
        quantity,
        unitPrice,
        availableStock: product.current_stock,
      },
      saleDate: form.date,
      clientId,
      customerName: clientId ? null : customerName,
      notes: form.notes.trim() || null,
      dueDate: form.due_date.trim() || form.date,
      amountGhs: charge,
      businessUnitId: stampResult.businessUnitId,
    };
  }

  async function payNowWithPaystack() {
    if (!mobileMoneyCollectionReady && form.payment_method === "Mobile Money") {
      setMomoNotSetupOpen(true);
      return;
    }
    setLoading(true);
    const draft = await buildPaystackCart();
    if (!draft) {
      setLoading(false);
      return;
    }
    const result = await openManualSalePaystackInline({
      manual_sale: true,
      cart_lines: [draft.cartLine],
      sale_date: draft.saleDate,
      client_id: draft.clientId,
      customer_name: draft.customerName,
      notes: draft.notes,
      due_date: draft.dueDate,
      amount_ghs: draft.amountGhs,
      payment_method: form.payment_method,
      sales_rep_id: salesRepId.trim() || null,
      delivery_email: payerEmail.trim(),
      business_unit_id: draft.businessUnitId,
    });
    setLoading(false);
    if (!result.ok) {
      if (result.notConfirmed) {
        // The request stays on the register as "Awaiting payment" with Check payment.
        closeForm();
        onRegisterMutationComplete?.();
      }
      await alertError(clientFacingSalesCrmError(result.error), {
        title: SALES_CRM_ALERT_TITLE,
      });
      return;
    }
    closeForm();
    await refreshEntries();
    onRegisterMutationComplete?.();
    toast(`Sale saved — ${result.invoiceNo}`);
  }

  async function openPaymentLink() {
    if (!mobileMoneyCollectionReady && form.payment_method === "Mobile Money") {
      setMomoNotSetupOpen(true);
      return;
    }
    setLoading(true);
    const draft = await buildPaystackCart("either");
    setLoading(false);
    if (!draft) {
      return;
    }
    setPaymentLinkDraft({
      cartLines: [draft.cartLine],
      saleDate: draft.saleDate,
      clientId: draft.clientId,
      customerName: draft.customerName,
      notes: draft.notes,
      dueDate: draft.dueDate,
      paymentMethod: form.payment_method,
      amountGhs: draft.amountGhs,
      email: payerEmail.trim(),
      phone: payerPhone.trim(),
      salesRepId: salesRepId.trim() || null,
      businessUnitId: draft.businessUnitId,
    });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const amountReceivedNow = Number(form.amount_received);
    if (
      amountReceivedNow > 0 &&
      isPaystackCollectMethod(form.payment_method) &&
      collectionMode === "paystack"
    ) {
      showActionError("Use Pay now or Send payment link. The sale is recorded after Paystack confirms.");
      return;
    }
    if (amountReceivedNow > 0 && !isManualSalePaymentMethod(form.payment_method)) {
      const methodField = document.getElementById("manual_sale_payment_method");
      if (methodField instanceof HTMLSelectElement) {
        methodField.setCustomValidity("Choose a payment method.");
        methodField.reportValidity();
      }
      return;
    }
    setLoading(true);
    try {
    const buContext = await loadWriteBusinessUnitContext(supabase);
    if (!buContext.ok) {
      showActionError(buContext.error);
      return;
    }

    const stampResult = resolveWriteBusinessUnitIdForCreate({
      allowedUnits: buContext.allowedUnits,
      stamp: stampBusinessUnit,
    });
    if (!stampResult.ok) {
      showActionError(stampResult.error);
      return;
    }

    const amountReceived = amountReceivedNow;
    const clientId = form.client_id.trim() || null;
    const otherPayerName = form.customer_name.trim() || null;

    if (!clientId && !otherPayerName) {
      showActionError("Select a contract client or enter an other payer name.");
      return;
    }

    const saleLines: PosManualSaleHandoffLine[] =
      posHandoffLines && posHandoffLines.length > 0
        ? posHandoffLines
        : [
            {
              productId: form.product_id,
              productCode: "",
              productName: "",
              unitOfMeasure: "",
              quantity: Number.parseFloat(form.sale_quantity),
              unitPrice: Number.parseFloat(form.unit_price),
              availableStock: 0,
            },
          ];

    if (saleLines.some((line) => !line.productId)) {
      showActionError("Select a finished product.");
      return;
    }

    if (
      saleLines.some(
        (line) => Number.isNaN(line.quantity) || line.quantity <= 0,
      )
    ) {
      showActionError("Quantity must be greater than zero.");
      return;
    }

    if (
      saleLines.some(
        (line) => Number.isNaN(line.unitPrice) || line.unitPrice < 0,
      )
    ) {
      showActionError("Unit price must be zero or greater.");
      return;
    }

    const lineTotals = saleLines.map(
      (line) => Math.round(line.quantity * line.unitPrice * 100) / 100,
    );
    const amount = manualSaleLinesTotal(saleLines);

    if (Number.isNaN(amountReceived) || amountReceived < 0) {
      showActionError("Amount paid now must be zero or greater.");
      return;
    }

    if (amountReceived > amount) {
      showActionError(
        `Amount paid now (${formatGHS(amountReceived)}) cannot exceed the sale total (${formatGHS(amount)}).`,
      );
      return;
    }

    const outstanding = calculateOutstanding(amount, amountReceived);
    if (outstanding > 0 && !form.due_date.trim()) {
      showActionError("Enter a due date for the remaining balance.");
      return;
    }

    for (const line of saleLines) {
      const product = finishedProducts.find((item) => item.id === line.productId);
      if (product && product.current_stock < line.quantity) {
        showActionError(
          `Only ${formatInventoryQuantity(product.current_stock)} ${product.unit_of_measure} of ${product.product_name} in stock, cannot sell ${formatInventoryQuantity(line.quantity)}.`,
        );
        return;
      }

      if (tenantId) {
        const productBuCheck = await verifyFinishedProductMatchesWriteBusinessUnit({
          supabase,
          tenantId,
          productId: line.productId,
          writeBusinessUnitId: stampResult.businessUnitId,
          action: "sale",
          knownProductBusinessUnitId: product?.business_unit_id ?? null,
        });
        if (!productBuCheck.ok) {
          showActionError(productBuCheck.message);
          return;
        }
      }
    }

    const amountByLine = allocateAmountReceivedAcrossLines(
      lineTotals,
      amountReceived,
    );
    const notesPayload =
      amountReceived > 0 && isManualSalePaymentMethod(form.payment_method)
        ? notesWithTransactionReference(
            notesWithPaymentMethod(form.notes, form.payment_method),
            collectionMode === "received" ? transactionReference : null,
          )
        : form.notes || null;

    const createdIncomeIds: string[] = [];
    let sharedInvoiceNo: string | null = null;

    for (let index = 0; index < saleLines.length; index += 1) {
      const line = saleLines[index]!;
      const lineAmount = lineTotals[index]!;
      const lineReceived = amountByLine[index]!;
      const paymentStatus = deriveProductSalePaymentStatus(
        lineAmount,
        lineReceived,
      );
      const invoiceNoForLine: string | null = sharedInvoiceNo;

      const { data, error: rpcError } = await supabase.rpc(
        "create_product_sale",
        {
          p_date: form.date,
          // Blank on first line → allocate PSI; later lines reuse the same invoice.
          p_invoice_no: invoiceNoForLine,
          p_client_id: clientId,
          p_customer_name: clientId ? null : otherPayerName,
          p_product_id: line.productId,
          p_quantity: line.quantity,
          p_unit_price: line.unitPrice,
          p_amount_received: lineReceived,
          p_payment_status: paymentStatus,
          p_due_date:
            outstanding > 0 ? form.due_date : form.due_date || form.date,
          p_description: null,
          p_notes: notesPayload,
          p_sales_rep_id: salesRepId.trim() || null,
          p_business_unit_id: stampResult.businessUnitId,
        },
      );

      if (rpcError) {
        showActionError(rpcError.message);
        return;
      }

      const createdIncomeId: string | null =
        typeof data === "string" ? data : null;
      if (createdIncomeId) {
        createdIncomeIds.push(createdIncomeId);
        if (!sharedInvoiceNo) {
          const { data: incomeRow } = await supabase
            .from("income_register")
            .select("invoice_no")
            .eq("id", createdIncomeId)
            .maybeSingle();
          const rawInvoice: unknown = incomeRow?.invoice_no;
          sharedInvoiceNo =
            typeof rawInvoice === "string" ? rawInvoice.trim() || null : null;
        }
      }
    }
    const invoiceNo = sharedInvoiceNo;

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
      createdIncomeIds,
    );

    const fromPosHandoff = Boolean(posHandoffSessionRef.current);
    const savedDueDate = form.due_date.trim() || form.date;
    clearPosHandoffSession();
    closeForm();
    await refreshEntries();
    onRegisterMutationComplete?.();
    if (fromPosHandoff && outstanding > 0) {
      toast(
        formatPosManualSaleSavedToast({
          invoiceNo: invoiceNo ?? "",
          balance: outstanding,
          dueDate: savedDueDate,
        }),
      );
    } else if (fromPosHandoff) {
      toast(
        formatPosManualSaleSavedToast({
          invoiceNo: invoiceNo ?? "",
          balance: 0,
          dueDate: savedDueDate,
        }),
      );
    } else {
      toast("Sale saved");
    }

    if (taxError) {
      showActionError(
        `Sale recorded, but the VFRS tax ledger could not be updated: ${taxError}`,
      );
    }
    } catch (unexpected) {
      showActionError(
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
    const buContext = await loadWriteBusinessUnitContext(supabase);
    if (!buContext.ok) {
      showActionError(buContext.error);
      setVoidingId(null);
      return;
    }

    try {
      assertCanModifyBusinessUnitRow(
        buContext.allowedUnits,
        entry.business_unit_id,
      );
    } catch (accessError) {
      showActionError(formatBusinessUnitAccessError(accessError));
      setVoidingId(null);
      return;
    }

    const { error: voidError } = await supabase.rpc("void_product_sale", {
      p_income_id: entry.id,
    });

    if (voidError) {
      showActionError(formatVoidProductSaleRpcError(voidError.message));
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
      showActionError(
        `Sale cancelled, but its tax ledger entries could not be removed: ${ledgerError}`,
      );
    }

    setVoidingId(null);
  }

  return (
    <div className={embeddedInSalesRegister ? "empty:hidden" : "min-w-0 space-y-6"}>
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

      {receipt ? (
        <ProductSaleReceiptPanel
          receipt={receipt}
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

      {paymentLinkDraft ? (
        <RequestPaymentModal
          mode="cart"
          manualSale
          cartLines={paymentLinkDraft.cartLines}
          saleDate={paymentLinkDraft.saleDate}
          clientId={paymentLinkDraft.clientId}
          customerName={paymentLinkDraft.customerName}
          notes={paymentLinkDraft.notes}
          dueDate={paymentLinkDraft.dueDate}
          paymentMethod={paymentLinkDraft.paymentMethod}
          defaultAmountGhs={paymentLinkDraft.amountGhs}
          defaultEmail={paymentLinkDraft.email}
          defaultPhone={paymentLinkDraft.phone}
          salesRepId={paymentLinkDraft.salesRepId}
          businessUnitId={paymentLinkDraft.businessUnitId}
          onClose={() => setPaymentLinkDraft(null)}
          onLinkSent={() => {
            setPaymentLinkDraft(null);
            closeForm();
            onRegisterMutationComplete?.();
            toast("Payment link sent — the sale shows as Awaiting payment until Paystack confirms.");
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
          defaultEmail={
            initialClients.find(
              (client) => client.client_id === recordPaymentEntry.client_id,
            )?.email ?? ""
          }
          defaultPhone={
            initialClients.find(
              (client) => client.client_id === recordPaymentEntry.client_id,
            )?.phone ?? ""
          }
          mobileMoneyCollectionReady={mobileMoneyCollectionReady}
          viewerRole={viewerRole}
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

      {momoNotSetupOpen ? (
        <MobileMoneyNotSetupModal
          viewerRole={viewerRole}
          onClose={() => setMomoNotSetupOpen(false)}
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

      {posHandoffMissingOpen ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="pos-handoff-missing-title"
        >
          <div className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-lg">
            <h2
              id="pos-handoff-missing-title"
              className="text-lg font-semibold text-[#0f2744]"
            >
              Cart not loaded
            </h2>
            <p className="mt-3 text-sm text-slate-700">
              {POS_MANUAL_SALE_HANDOFF_MISSING_MESSAGE}
            </p>
            <div className="mt-5 flex justify-end">
              <DashboardButton
                type="button"
                variant="secondary"
                onClick={() => setPosHandoffMissingOpen(false)}
              >
                OK
              </DashboardButton>
            </div>
          </div>
        </div>
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
                  onChange={(e) => {
                    const clientId = e.target.value;
                    const client = initialClients.find(
                      (item) => item.client_id === clientId,
                    );
                    updateField("client_id", clientId);
                    if (client && !payerEmail) {
                      setPayerEmail(client.email ?? "");
                    }
                    if (client && !payerPhone) {
                      setPayerPhone(client.phone ?? "");
                    }
                  }}
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
              {posHandoffLines && posHandoffLines.length > 1 ? (
                <div className="md:col-span-2 xl:col-span-3">
                  <label className="mb-2 block text-sm font-medium text-slate-700">
                    Cart lines (from POS)
                  </label>
                  <div className="overflow-x-auto rounded-md border border-slate-200">
                    <table className="min-w-full text-sm">
                      <thead className="bg-slate-50 text-left text-slate-600">
                        <tr>
                          <th className="px-3 py-2 font-medium">Product</th>
                          <th className="px-3 py-2 font-medium">Qty</th>
                          <th className="px-3 py-2 font-medium">Unit price</th>
                          <th className="px-3 py-2 font-medium">Line total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {posHandoffLines.map((line) => (
                          <tr
                            key={`${line.productId}-${line.quantity}-${line.unitPrice}`}
                            className="border-t border-slate-100"
                          >
                            <td className="px-3 py-2 text-slate-900">
                              {line.productCode
                                ? `${line.productCode} — ${line.productName}`
                                : line.productName || line.productId}
                            </td>
                            <td className="px-3 py-2">
                              {formatInventoryQuantity(line.quantity)}{" "}
                              {line.unitOfMeasure}
                            </td>
                            <td className="px-3 py-2">
                              {formatGHS(line.unitPrice)}
                            </td>
                            <td className="px-3 py-2">
                              {formatGHS(
                                Math.round(
                                  line.quantity * line.unitPrice * 100,
                                ) / 100,
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              ) : (
                <>
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
                </>
              )}
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
                  onChange={(e) => {
                    const next = e.target.value;
                    updateField("amount_received", next);
                    if (!(Number(next) > 0)) {
                      updateField("payment_method", "");
                      setCollectionMode("received");
                    }
                  }}
                  className={inputClassName}
                />
                <p className="mt-1 text-xs text-slate-500">
                  Enter 0 for unpaid, less than total for a partial payment, or the
                  full total to mark paid.
                </p>
              </div>
              {Number(form.amount_received) > 0 ? (
              <div>
                <label
                  htmlFor="manual_sale_payment_method"
                  className="mb-1 block text-sm font-medium text-slate-700"
                >
                  Payment method
                </label>
                <select
                  id="manual_sale_payment_method"
                  value={form.payment_method}
                  onChange={(e) => {
                    e.target.setCustomValidity("");
                    updateField("payment_method", e.target.value);
                    if (!isPaystackCollectMethod(e.target.value)) {
                      setCollectionMode("received");
                    }
                  }}
                  className={inputClassName}
                >
                  <option value="">Choose how the customer paid</option>
                  {MANUAL_SALE_PAYMENT_METHODS.map((method) => {
                    const momoBlocked =
                      method === "Mobile Money" && !mobileMoneyCollectionReady;
                    return (
                      <option
                        key={method}
                        value={method}
                        disabled={momoBlocked}
                      >
                        {method === "Mobile Money"
                          ? mobileMoneyPaymentMethodOptionLabel(
                              mobileMoneyCollectionReady,
                            )
                          : method}
                      </option>
                    );
                  })}
                </select>
              </div>
              ) : null}
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

            <ManualSaleCollectionFields
              method={form.payment_method}
              amount={Number(form.amount_received) || 0}
              mode={collectionMode}
              onMode={setCollectionMode}
              reference={transactionReference}
              onReference={setTransactionReference}
              email={payerEmail}
              onEmail={setPayerEmail}
              phone={payerPhone}
              onPhone={setPayerPhone}
              paystackCollectAllowed={mobileMoneyCollectionReady}
              onPaystackBlocked={() => setMomoNotSetupOpen(true)}
            />

            <div className="flex flex-wrap gap-3">
              {Number(form.amount_received) > 0 &&
              isPaystackCollectMethod(form.payment_method) &&
              collectionMode === "paystack" ? (
                <>
                  <DashboardButton
                    type="button"
                    variant="success"
                    disabled={loading}
                    onClick={() => void payNowWithPaystack()}
                  >
                    {loading ? "Opening Paystack…" : "Pay now"}
                  </DashboardButton>
                  <DashboardButton
                    type="button"
                    variant="secondary"
                    disabled={loading}
                    onClick={() => void openPaymentLink()}
                  >
                    Send payment link
                  </DashboardButton>
                </>
              ) : (
              <DashboardButton
                type="submit"
                variant="success"
                disabled={loading}
              >
                {loading ? "Saving…" : "Save Sale"}
              </DashboardButton>
              )}
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
                  sort={columnSortConfig("customer", "text")}
                />
              </th>
              <th className={scrollableTableThClassName}>Invoice No.</th>
              <th className={scrollableTableThClassName}>
                <RegisterColumnFilterHeader
                  label="Product"
                  options={productOptions}
                  applied={productFilter}
                  onApply={setProductFilter}
                  sort={columnSortConfig("product", "text")}
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
                  sort={columnSortConfig("payment_status", "text")}
                />
              </th>
              <th className={scrollableTableThClassName}>
                <RegisterColumnFilterHeader
                  label="Status"
                  options={statusOptions}
                  applied={statusFilter}
                  onApply={setStatusFilter}
                  sort={columnSortConfig("status", "text")}
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
                      onPrint={() => {
                        void (async () => {
                          const { data, error } = await supabase
                            .from("product_sale_payments")
                            .select(PRODUCT_SALE_PAYMENT_SELECT)
                            .eq("income_id", entry.id)
                            .order("payment_date", { ascending: true });
                          if (error) {
                            await alertError(clientFacingSalesCrmError(error.message), {
                              title: "Couldn't print the receipt",
                            });
                            return;
                          }
                          setReceipt(
                            withReceiptPaymentLines(
                              buildProductSaleReceiptData(entry, initialClients),
                              buildReceiptPaymentLines(
                                [
                                  {
                                    id: entry.id,
                                    date: entry.date,
                                    amount: Number(entry.amount) || 0,
                                    amount_received: Number(entry.amount_received) || 0,
                                    notes: entry.notes,
                                    payment_method: entry.payment_method,
                                    is_sale_return: entry.is_sale_return === true,
                                  },
                                ],
                                data ?? [],
                              ),
                              entry.notes,
                            ),
                          );
                        })();
                      }}
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
