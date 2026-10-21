"use client";

import { confirmDialog } from "@/components/feedback/app-dialogs";
import { useAlert } from "@/components/feedback/feedback-context";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  SALES_CRM_ALERT_TITLE,
  clientFacingSalesCrmError,
} from "@/lib/crm/sales-crm-notifications";
import { useRouter } from "next/navigation";
import { createClient } from "@/utils/supabase/client";
import {
  useBusinessUnitReadScope,
  useBusinessUnitView,
} from "@/app/dashboard/business-unit-view-context";
import { applyBusinessUnitScope } from "@/utils/business-unit-view";
import RegisterRecordDetailDrawer, {
  type RegisterDetailSection,
} from "@/app/dashboard/register-record-detail-drawer";
import {
  createRegisterDateSortState,
  registerTieBreakByRowKeyDesc,
  sortRegisterRows,
  type RegisterColumnSortState,
  type RegisterColumnSortValueType,
} from "@/app/dashboard/finance/register-column-filter";
import Tooltip from "@/components/ui/tooltip";
import {
  formatDate,
  formatGHS,
  getIncomeCustomerDisplayName,
  resolveIncomeOutstandingBalance,
} from "@/app/dashboard/finance/income-register-utils";
import { formatInventoryQuantity } from "@/app/dashboard/inventory/inventory-utils";
import type { ClientEntry } from "@/app/dashboard/operations/clients-utils";
import type { FinishedProductRecord } from "@/app/dashboard/inventory/finished-products-utils";
import type { HrEmployee } from "@/app/dashboard/hr-payroll/employee-utils";
import ProductSales from "../product-sales";
import PaystackAttentionList from "./paystack-attention-list";
import { canResolvePaystackAttention } from "@/utils/rbac-access";
import {
  buildVoidProductSaleConfirmMessage,
  getProductSaleProductLabel,
  isProductSaleVoided,
  normalizeProductSaleEntry,
  PRODUCT_SALES_SELECT,
  type ProductSaleEntry,
} from "../product-sales-utils";
import {
  formatVoidProductSaleRpcError,
  isProductSaleReturn,
  isSaleLineFullyReturned,
  resolveProductSaleCancelBlockReason,
} from "../product-return-utils";
import { deleteTaxLedgerEntriesForSource } from "@/app/dashboard/finance/tax-ledger-sync";
import {
  assertCanModifyBusinessUnitRow,
  formatBusinessUnitAccessError,
  loadWriteBusinessUnitContext,
} from "@/utils/business-unit-access";
import { PosReceiptPanel, type PosReceiptData } from "@/app/dashboard/pos/pos-receipt";
import {
  ProductSaleReceiptPanel,
  type ProductSaleReceiptData,
} from "../product-sale-receipt";
import {
  CRM_WEBHOOK_SALE_SELECT,
  normalizeWebhookSale,
  type CrmSaleEntry,
} from "./sales-utils";
import { loadSalesLogReceiptData } from "./sales-log-receipt-utils";
import { useQueryTab } from "@/hooks/use-query-tab";
import { SalesRegisterLayout } from "./sales-register-layout";
import {
  buildReturnedQtyByIncomeId,
  buildSalesRegisterRows,
  formatCompactPaymentMethod,
  formatRegisterItemsCompact,
  formatSalesRegisterSourceLabel,
  mergePaystackPendingRows,
  rowMatchesSalesRegisterView,
  SALES_REGISTER_VIEWS,
  salesRegisterDaysOverdue,
  salesRegisterDefaultView,
  salesRegisterManualStatus,
  salesRegisterPosStatus,
  salesRegisterRowIncludedInCounts,
  salesRegisterRowPassesCancelledFilter,
  salesRegisterRowStatusLabel,
  type SalesRegisterReceiptRow,
  type SalesRegisterRow,
  type SalesRegisterView,
} from "./sales-register-utils";
import type { OpenPaystackPaymentRequest } from "@/utils/manual-sale-paystack";
import {
  formatDrawerPaymentSummary,
  formatDrawerReturnSummary,
  loadReceiptDrawerPayments,
  loadReceiptDrawerReturns,
  loadReturnRowDrawerDetail,
  loadRefundsByCreditNoteIds,
  SALES_REGISTER_VIEW_ONLY_TOOLTIP,
  type SalesRegisterDrawerPayment,
  type SalesRegisterDrawerReturn,
} from "./sales-register-drawer-data";
import type { ReturnRefundSummary } from "./sales-register-return-display";

type SalesRegisterProps = {
  initialIncomeEntries: ProductSaleEntry[];
  initialWebhookSales: CrmSaleEntry[];
  initialClients: ClientEntry[];
  initialFinishedProducts: FinishedProductRecord[];
  initialPaymentMethods: string[];
  initialEmployees: HrEmployee[];
  defaultSalesRepId?: string;
  fetchError: string | null;
  activeBusinessUnitId?: string | null;
  tenantId: string;
  viewerRole?: string | null;
};

export default function SalesRegister(props: SalesRegisterProps) {
  const router = useRouter();
  const supabase = createClient();
  const { alertError } = useAlert();
  const buReadScope = useBusinessUnitReadScope();
  const { viewAllBusinessUnits } = useBusinessUnitView();

  function showActionError(message: string) {
    void alertError(clientFacingSalesCrmError(message), {
      title: SALES_CRM_ALERT_TITLE,
    });
  }

  useEffect(() => {
    if (props.fetchError) {
      void alertError(
        clientFacingSalesCrmError(props.fetchError, "Could not load."),
        { title: SALES_CRM_ALERT_TITLE },
      );
    }
  }, [props.fetchError, alertError]);

  const [incomeEntries, setIncomeEntries] = useState(
    props.initialIncomeEntries.map(normalizeProductSaleEntry),
  );
  const [webhookSales, setWebhookSales] = useState(props.initialWebhookSales);
  const [returnedQtyByIncomeId, setReturnedQtyByIncomeId] = useState<
    Map<string, number>
  >(() => new Map());
  const [showForm, setShowForm] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [returnInvoiceNo, setReturnInvoiceNo] = useState<string | null>(null);
  const [recordPaymentEntry, setRecordPaymentEntry] =
    useState<ProductSaleEntry | null>(null);
  const refreshIncomeRef = useRef<(() => Promise<void>) | null>(null);
  const [paymentsByIncomeId, setPaymentsByIncomeId] = useState<
    Map<string, string[]>
  >(() => new Map());
  const [pendingPaystack, setPendingPaystack] = useState<
    OpenPaystackPaymentRequest[]
  >([]);

  const defaultView = salesRegisterDefaultView(props.viewerRole);
  const { tab: view, setTab: setView } = useQueryTab<SalesRegisterView>({
    values: SALES_REGISTER_VIEWS,
    defaultTab: defaultView,
    param: "view",
  });
  const [outstandingOnly, setOutstandingOnly] = useState(false);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [posTodayOnly, setPosTodayOnly] = useState(true);
  const todayIso = new Date().toLocaleDateString("en-CA", {
    timeZone: "Africa/Accra",
  });
  const [methodFilter, setMethodFilter] = useState("");
  const [salesRepChip, setSalesRepChip] = useState("");
  const [statusChip, setStatusChip] = useState("");
  const [settlementChip, setSettlementChip] = useState("");
  const [creditStatusChip, setCreditStatusChip] = useState("");
  const [sourceChip, setSourceChip] = useState("");
  const [dateRangeOpen, setDateRangeOpen] = useState(false);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [columnSort, setColumnSort] = useState<RegisterColumnSortState | null>(
    () => createRegisterDateSortState("date"),
  );

  const [drawerRowKey, setDrawerRowKey] = useState<string | null>(null);
  const [activeReceipt, setActiveReceipt] = useState<
    | { kind: "pos"; receipt: PosReceiptData }
    | { kind: "product_sale"; receipt: ProductSaleReceiptData }
    | null
  >(null);
  const [voidingId, setVoidingId] = useState<string | null>(null);
  const [printingKey, setPrintingKey] = useState<string | null>(null);
  const [refundsByCreditNoteId, setRefundsByCreditNoteId] = useState<
    Map<string, ReturnRefundSummary[]>
  >(() => new Map());

  const registerViewOnly = viewAllBusinessUnits;

  const getCustomerLabel = useCallback(
    (entry: ProductSaleEntry) =>
      getIncomeCustomerDisplayName(entry, props.initialClients),
    [props.initialClients],
  );

  const allRows = useMemo(
    () =>
      mergePaystackPendingRows(
        buildSalesRegisterRows({
          incomeEntries,
          webhookSales,
          returnedQtyByIncomeId,
          refundsByCreditNoteId,
          employees: props.initialEmployees,
          clients: props.initialClients,
          includeDigitalRows: viewAllBusinessUnits,
          getCustomerLabel,
          paymentsByIncomeId,
        }),
        pendingPaystack,
      ),
    [
      incomeEntries,
      webhookSales,
      returnedQtyByIncomeId,
      refundsByCreditNoteId,
      props.initialEmployees,
      props.initialClients,
      viewAllBusinessUnits,
      getCustomerLabel,
      paymentsByIncomeId,
      pendingPaystack,
    ],
  );

  async function reloadReturnedQuantities(entries: ProductSaleEntry[]) {
    const saleLineIds = entries
      .filter((entry) => !isProductSaleReturn(entry))
      .map((entry) => entry.id);
    if (saleLineIds.length === 0) {
      setReturnedQtyByIncomeId(new Map());
      return;
    }
    const { data } = await supabase
      .from("credit_note_line_items")
      .select("source_income_register_id, quantity")
      .in("source_income_register_id", saleLineIds);
    setReturnedQtyByIncomeId(
      buildReturnedQtyByIncomeId(
        (data ?? []) as { source_income_register_id: string; quantity: number }[],
      ),
    );
  }

  async function refreshIncomeEntries() {
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
    const normalized = ((data as ProductSaleEntry[] | null) ?? []).map((row) =>
      normalizeProductSaleEntry(row),
    );
    setIncomeEntries(normalized);
    await reloadReturnedQuantities(normalized);
  }

  async function refreshWebhookSales() {
    if (!viewAllBusinessUnits) {
      setWebhookSales([]);
      return;
    }
    const { data, error: webhookError } = await supabase
      .from("crm_sales")
      .select(CRM_WEBHOOK_SALE_SELECT)
      .order("sale_date", { ascending: false });
    if (webhookError) {
      showActionError(webhookError.message);
      return;
    }
    setWebhookSales(
      ((data as Parameters<typeof normalizeWebhookSale>[0][] | null) ?? []).map(
        (row) => normalizeWebhookSale(row),
      ),
    );
  }

  async function refreshPendingPaystack() {
    const { data, error: pendingError } = await supabase
      .from("product_sale_payment_requests")
      .select(
        "id, invoice_no, amount_requested, status, payment_method, income_ids, cart_snapshot, created_at",
      )
      .in("status", ["pending", "sent"]);
    if (pendingError) {
      return;
    }
    const rows = (data ?? []) as Array<{
      id: string;
      invoice_no: string;
      amount_requested: number;
      status: string;
      payment_method: string;
      income_ids: string[] | null;
      cart_snapshot: OpenPaystackPaymentRequest["cart_snapshot"];
      created_at: string;
    }>;
    setPendingPaystack(
      rows.map((row) => ({
        id: row.id,
        invoice_no: row.invoice_no,
        amount_requested: Number(row.amount_requested) || 0,
        status: row.status,
        payment_method: row.payment_method,
        income_ids: Array.isArray(row.income_ids) ? row.income_ids : [],
        cart_snapshot: row.cart_snapshot,
        created_at: row.created_at,
      })),
    );
  }

  async function refreshAll() {
    await Promise.all([
      refreshIncomeEntries(),
      refreshWebhookSales(),
      refreshPendingPaystack(),
    ]);
    router.refresh();
  }

  useEffect(() => {
    void refreshPendingPaystack();
  }, [supabase]);

  useEffect(() => {
    void reloadReturnedQuantities(incomeEntries);
  }, [incomeEntries, supabase]);

  useEffect(() => {
    const incomeIds = incomeEntries
      .filter((entry) => !isProductSaleReturn(entry))
      .map((entry) => entry.id);
    if (incomeIds.length === 0) {
      setPaymentsByIncomeId(new Map());
      return;
    }
    let cancelled = false;
    void (async () => {
      const next = new Map<string, string[]>();
      const chunkSize = 80;
      for (let index = 0; index < incomeIds.length; index += chunkSize) {
        const slice = incomeIds.slice(index, index + chunkSize);
        const { data } = await supabase
          .from("product_sale_payments")
          .select("income_id, payment_method")
          .in("income_id", slice);
        if (cancelled) {
          return;
        }
        for (const row of (data ?? []) as {
          income_id: string;
          payment_method: string | null;
        }[]) {
          const method = row.payment_method?.trim();
          if (!method) {
            continue;
          }
          const list = next.get(row.income_id) ?? [];
          list.push(method);
          next.set(row.income_id, list);
        }
      }
      if (!cancelled) {
        setPaymentsByIncomeId(next);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [incomeEntries, supabase]);

  useEffect(() => {
    const creditNoteIds = [
      ...new Set(
        incomeEntries
          .filter((entry) => isProductSaleReturn(entry))
          .map((entry) => entry.credit_note_id?.trim())
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    if (creditNoteIds.length === 0) {
      setRefundsByCreditNoteId(new Map());
      return;
    }
    let cancelled = false;
    void loadRefundsByCreditNoteIds(supabase, creditNoteIds).then((map) => {
      if (!cancelled) {
        setRefundsByCreditNoteId(map);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [incomeEntries, supabase]);

  useEffect(() => {
    void refreshWebhookSales();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- BU view toggle
  }, [viewAllBusinessUnits]);

  useEffect(() => {
    if (!registerViewOnly) {
      return;
    }
    setShowForm(false);
    setShowBulkImport(false);
    setReturnInvoiceNo(null);
    setRecordPaymentEntry(null);
  }, [registerViewOnly]);

  function toggleColumnSort(
    columnId: string,
    valueType: RegisterColumnSortValueType,
  ) {
    setColumnSort((current) => {
      if (current?.columnId === columnId) {
        return {
          columnId,
          valueType,
          direction: current.direction === "asc" ? "desc" : "asc",
        };
      }
      return {
        columnId,
        valueType,
        direction: valueType === "text" ? "asc" : "desc",
      };
    });
  }

  const salesRegisterRowSortValue = useCallback(
    (row: SalesRegisterRow, columnId: string) => {
      switch (columnId) {
        case "date":
        case "time":
          return row.kind === "receipt"
            ? (row.saleTimestamp ?? row.date)
            : row.date;
        case "invoice":
          return row.kind === "receipt"
            ? row.invoiceNo
            : row.kind === "return"
              ? (row.creditNoteNumber ?? row.linkedInvoiceNo ?? "")
              : (row.invoiceNo ?? "");
        case "customer":
          return row.customerLabel;
        case "items":
          return row.kind === "digital"
            ? row.itemsSummary
            : formatRegisterItemsCompact(row.lines);
        case "total":
        case "amount":
          return row.totalAmount;
        case "outstanding":
          return row.kind === "return" ? 0 : row.totalOutstanding;
        case "due":
          return row.kind === "receipt" ? (row.dueDate ?? "") : "";
        case "method":
          return row.kind === "digital"
            ? (row.paymentMethod ?? "")
            : row.paymentMethod;
        case "source":
          return row.kind === "digital"
            ? "Digital"
            : formatSalesRegisterSourceLabel(row.source);
        case "status":
          return salesRegisterRowStatusLabel(row, todayIso, view);
        default:
          return "";
      }
    },
    [todayIso, view],
  );

  const visibleRows = useMemo(() => {
    const filtered = allRows.filter((row) => {
      if (!rowMatchesSalesRegisterView(row, view)) {
        return false;
      }
      if (!salesRegisterRowPassesCancelledFilter(row, statusChip)) {
        return false;
      }
      const date = row.date?.slice(0, 10) ?? "";
      if (view === "pos") {
        if (posTodayOnly && date !== todayIso) {
          return false;
        }
        if (methodFilter && row.kind === "receipt") {
          const compact = formatCompactPaymentMethod(row.paymentMethod);
          if (compact !== methodFilter && row.paymentMethod !== methodFilter) {
            return false;
          }
        }
        if (salesRepChip && row.salesRepLabel !== salesRepChip) {
          return false;
        }
        if (
          statusChip &&
          row.kind === "receipt" &&
          salesRegisterPosStatus(row).label !== statusChip
        ) {
          return false;
        }
        return true;
      }

      if (dateFrom || dateTo) {
        if (dateFrom && date < dateFrom) {
          return false;
        }
        if (dateTo && date > dateTo) {
          return false;
        }
      }

      if (view === "manual" && row.kind === "receipt") {
        if (
          statusChip &&
          salesRegisterRowStatusLabel(row, todayIso, view) !== statusChip
        ) {
          return false;
        }
        if (outstandingOnly && row.totalOutstanding <= 0.001) {
          return false;
        }
        if (
          overdueOnly &&
          salesRegisterDaysOverdue(row.dueDate, row.totalOutstanding, todayIso) <= 0
        ) {
          return false;
        }
      }

      if (view === "returns" && row.kind === "return") {
        if (settlementChip && row.paymentMethod !== settlementChip) {
          return false;
        }
        if (creditStatusChip && row.paymentStatus !== creditStatusChip) {
          return false;
        }
      }

      if (view === "digital" && row.kind === "digital") {
        if (
          statusChip &&
          salesRegisterRowStatusLabel(row, todayIso, view) !== statusChip
        ) {
          return false;
        }
      }

      if (view === "all") {
        const sourceLabel =
          row.kind === "digital"
            ? "Digital"
            : formatSalesRegisterSourceLabel(row.source);
        if (sourceChip && sourceLabel !== sourceChip) {
          return false;
        }
        if (
          statusChip &&
          salesRegisterRowStatusLabel(row, todayIso, view) !== statusChip
        ) {
          return false;
        }
      }

      return true;
    });
    const activeSort = columnSort ?? createRegisterDateSortState("date");
    return sortRegisterRows(
      filtered,
      activeSort,
      (row) => salesRegisterRowSortValue(row, activeSort.columnId),
      (left, right) => registerTieBreakByRowKeyDesc(left.rowKey, right.rowKey),
    );
  }, [
    allRows,
    view,
    outstandingOnly,
    overdueOnly,
    posTodayOnly,
    todayIso,
    dateFrom,
    dateTo,
    methodFilter,
    salesRepChip,
    statusChip,
    settlementChip,
    creditStatusChip,
    sourceChip,
    columnSort,
    salesRegisterRowSortValue,
  ]);

  const viewCounts = useMemo(() => {
    const counts: Record<SalesRegisterView, number> = {
      pos: 0,
      manual: 0,
      returns: 0,
      digital: 0,
      all: 0,
    };
    for (const row of allRows) {
      if (!salesRegisterRowIncludedInCounts(row)) {
        continue;
      }
      counts.all += 1;
      if (row.kind === "return") {
        counts.returns += 1;
      } else if (row.kind === "digital") {
        counts.digital += 1;
      } else if (row.source === "pos") {
        counts.pos += 1;
      } else if (row.source === "manual") {
        counts.manual += 1;
      }
    }
    return counts;
  }, [allRows]);

  const drawerRow = useMemo(
    () => visibleRows.find((row) => row.rowKey === drawerRowKey) ?? null,
    [visibleRows, drawerRowKey],
  );

  async function handleVoidLine(entry: ProductSaleEntry) {
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
    await deleteTaxLedgerEntriesForSource(
      supabase,
      "income_register",
      entry.id,
    );
    await refreshAll();
    setVoidingId(null);
  }

  async function handlePrintReceipt(row: SalesRegisterReceiptRow) {
    setPrintingKey(row.rowKey);
    const pseudoSale: CrmSaleEntry = {
      id: row.lines[0]?.id ?? row.rowKey,
      sale_date: row.date,
      invoice_no: row.invoiceNo,
      amount: row.totalAmount,
      payment_status: row.paymentStatus,
      payment_method: row.paymentMethod,
      sale_status: row.voided ? "voided" : "active",
      customer_id: row.clientId,
      product_id: row.lines[0]?.product_id ?? null,
      customer_name: row.customerLabel,
      product_name: row.itemsSummary,
      source: "product_sale",
    };
    try {
      const result = await loadSalesLogReceiptData(
        supabase,
        buReadScope,
        pseudoSale,
        props.initialClients,
      );
      if (result.kind === "unsupported") {
        showActionError(result.reason);
        return;
      }
      if (result.kind === "pos") {
        setActiveReceipt({ kind: "pos", receipt: result.receipt });
        return;
      }
      setActiveReceipt({ kind: "product_sale", receipt: result.receipt });
    } catch (printError) {
      showActionError(
        printError instanceof Error
          ? printError.message
          : "Unable to load receipt.",
      );
    } finally {
      setPrintingKey(null);
    }
  }

  const tabRows = useMemo(
    () => allRows.filter((row) => rowMatchesSalesRegisterView(row, view)),
    [allRows, view],
  );

  return (
    <div className="min-w-0 space-y-4">
      <PaystackAttentionList canResolve={canResolvePaystackAttention(props.viewerRole)} />
      <SalesRegisterLayout
        view={view}
        onView={(next) => {
          setView(next);
          setMethodFilter("");
          setSalesRepChip("");
          setStatusChip("");
          setSettlementChip("");
          setCreditStatusChip("");
          setSourceChip("");
        }}
        viewCounts={viewCounts}
        viewAllBusinessUnits={viewAllBusinessUnits}
        showForm={showForm}
        onToggleForm={() => setShowForm((current) => !current)}
        showBulkImport={showBulkImport}
        onToggleBulkImport={() => setShowBulkImport((current) => !current)}
        registerViewOnly={registerViewOnly}
        rows={visibleRows}
        tabRows={tabRows}
        todayIso={todayIso}
        posTodayOnly={posTodayOnly}
        onTogglePosToday={() => setPosTodayOnly((current) => !current)}
        outstandingOnly={outstandingOnly}
        onToggleOutstanding={() => setOutstandingOnly((current) => !current)}
        overdueOnly={overdueOnly}
        onToggleOverdue={() => setOverdueOnly((current) => !current)}
        dateFrom={dateFrom}
        dateTo={dateTo}
        onDateFrom={setDateFrom}
        onDateTo={setDateTo}
        dateRangeOpen={dateRangeOpen}
        onToggleDateRange={() => setDateRangeOpen((current) => !current)}
        methodFilter={methodFilter}
        onMethodFilter={setMethodFilter}
        salesRepChip={salesRepChip}
        onSalesRepChip={setSalesRepChip}
        statusChip={statusChip}
        onStatusChip={setStatusChip}
        settlementChip={settlementChip}
        onSettlementChip={setSettlementChip}
        creditStatusChip={creditStatusChip}
        onCreditStatusChip={setCreditStatusChip}
        sourceChip={sourceChip}
        onSourceChip={setSourceChip}
        columnSort={columnSort}
        onSort={toggleColumnSort}
        printingKey={printingKey}
        voidingId={voidingId}
        onOpenDrawer={(row) => setDrawerRowKey(row.rowKey)}
        onReturn={(invoice) => setReturnInvoiceNo(invoice)}
        onRecordPayment={(entry) => setRecordPaymentEntry(entry)}
        onPrintReceipt={(row) => void handlePrintReceipt(row)}
        onVoidLine={(line) => void handleVoidLine(line)}
        onOpenCreditNote={(note) => {
          const match = allRows.find(
            (candidate) =>
              candidate.kind === "return" && candidate.creditNoteNumber === note,
          );
          if (match) {
            setView("returns");
            setDrawerRowKey(match.rowKey);
          }
        }}
      >
        <ProductSales
          embeddedInSalesRegister
          initialEntries={incomeEntries}
          initialClients={props.initialClients}
          initialFinishedProducts={props.initialFinishedProducts}
          initialPaymentMethods={props.initialPaymentMethods}
          initialEmployees={props.initialEmployees}
          defaultSalesRepId={props.defaultSalesRepId}
          fetchError={null}
          activeBusinessUnitId={props.activeBusinessUnitId}
          tenantId={props.tenantId}
          controlledEntries={incomeEntries}
          onControlledEntriesChange={setIncomeEntries}
          controlledShowForm={showForm}
          onControlledShowFormChange={setShowForm}
          controlledShowBulkImport={showBulkImport}
          onControlledShowBulkImportChange={setShowBulkImport}
          controlledReturnInvoiceNo={returnInvoiceNo}
          onControlledReturnInvoiceNoChange={setReturnInvoiceNo}
          controlledRecordPaymentEntry={recordPaymentEntry}
          onControlledRecordPaymentEntryChange={setRecordPaymentEntry}
          onRefreshEntriesReady={(fn) => {
            refreshIncomeRef.current = fn;
          }}
          onRegisterMutationComplete={() => {
            void refreshAll();
          }}
        />
      </SalesRegisterLayout>

      {activeReceipt?.kind === "pos" ? (
        <PosReceiptPanel
          receipt={activeReceipt.receipt}
          onClose={() => setActiveReceipt(null)}
        />
      ) : null}
      {activeReceipt?.kind === "product_sale" ? (
        <ProductSaleReceiptPanel
          receipt={activeReceipt.receipt}
          onClose={() => setActiveReceipt(null)}
        />
      ) : null}

      <SalesRegisterDetailDrawer
        row={drawerRow}
        open={drawerRow != null}
        onClose={() => setDrawerRowKey(null)}
        voidingId={voidingId}
        viewOnly={registerViewOnly}
        onOpenReceiptByInvoice={(invoiceNo) => {
          const match = allRows.find(
            (candidate) =>
              candidate.kind === "receipt" && candidate.invoiceNo === invoiceNo,
          );
          if (match) {
            setDrawerRowKey(match.rowKey);
          }
        }}
        onVoidLine={(line) => void handleVoidLine(line)}
        onReturn={(invoice) => {
          setReturnInvoiceNo(invoice);
        }}
        onRecordPayment={(line) => setRecordPaymentEntry(line)}
        onPrintReceipt={
          drawerRow?.kind === "receipt"
            ? () => void handlePrintReceipt(drawerRow)
            : undefined
        }
      />
    </div>
  );
}


function SalesRegisterDetailDrawer({
  row,
  open,
  onClose,
  voidingId,
  viewOnly,
  onOpenReceiptByInvoice,
  onVoidLine,
  onReturn,
  onRecordPayment,
  onPrintReceipt,
}: {
  row: SalesRegisterRow | null;
  open: boolean;
  onClose: () => void;
  voidingId: string | null;
  viewOnly: boolean;
  onOpenReceiptByInvoice: (invoiceNo: string) => void;
  onVoidLine: (line: ProductSaleEntry) => void;
  onReturn: (invoiceNo: string) => void;
  onRecordPayment: (line: ProductSaleEntry) => void;
  onPrintReceipt?: () => void;
}) {
  const supabase = createClient();
  const [extraLoading, setExtraLoading] = useState(false);
  const [drawerPayments, setDrawerPayments] = useState<
    SalesRegisterDrawerPayment[]
  >([]);
  const [drawerReturns, setDrawerReturns] = useState<
    SalesRegisterDrawerReturn[]
  >([]);
  const [linkedInvoiceNo, setLinkedInvoiceNo] = useState<string | null>(null);

  useEffect(() => {
    if (!open || !row) {
      setDrawerPayments([]);
      setDrawerReturns([]);
      setLinkedInvoiceNo(null);
      return;
    }
    let cancelled = false;
    setExtraLoading(true);
    void (async () => {
      try {
        if (row.kind === "receipt") {
          const [payments, returns] = await Promise.all([
            loadReceiptDrawerPayments(supabase, row),
            loadReceiptDrawerReturns(supabase, row.invoiceNo),
          ]);
          if (!cancelled) {
            setDrawerPayments(payments);
            setDrawerReturns(returns);
            setLinkedInvoiceNo(null);
          }
        } else if (row.kind === "return") {
          const detail = await loadReturnRowDrawerDetail(
            supabase,
            row.creditNoteId,
          );
          if (!cancelled) {
            setDrawerPayments([]);
            setDrawerReturns(detail.returns);
            setLinkedInvoiceNo(detail.linkedInvoiceNo);
          }
        } else {
          if (!cancelled) {
            setDrawerPayments([]);
            setDrawerReturns([]);
            setLinkedInvoiceNo(null);
          }
        }
      } finally {
        if (!cancelled) {
          setExtraLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, row, supabase]);

  const sections: RegisterDetailSection[] = useMemo(() => {
    if (!row) {
      return [];
    }
    if (row.kind === "digital") {
      return [
        {
          title: "Digital sale",
          fields: [
            { label: "Customer", value: row.customerLabel },
            { label: "Product", value: row.itemsSummary },
            { label: "Amount", value: formatGHS(row.totalAmount) },
            { label: "Payment status", value: row.paymentStatus ?? "—" },
            { label: "Payment method", value: row.paymentMethod ?? "—" },
          ],
        },
      ];
    }
    if (row.kind === "return") {
      const note = drawerReturns[0];
      const fields: RegisterDetailSection["fields"] = [
        { label: "Credit note", value: row.creditNoteNumber ?? "—" },
        {
          label: "Date",
          value: note ? formatDate(note.creditNoteDate) : formatDate(row.date),
        },
        { label: "Customer", value: row.customerLabel },
        {
          label: "Outcome",
          value: note?.outcome ?? row.paymentMethod,
        },
        {
          label: "Amount",
          value: formatGHS(note?.totalAmount ?? row.totalAmount),
        },
        {
          label: "Refunded",
          value: formatGHS(note?.refundedAmount ?? 0),
        },
        {
          label: "Applied",
          value: formatGHS(note?.appliedAmount ?? 0),
        },
        {
          label: "Credit status",
          value: note?.usageStatus ?? "—",
        },
        {
          label: "Original receipt",
          value: linkedInvoiceNo ? (
            <button
              type="button"
              onClick={() => onOpenReceiptByInvoice(linkedInvoiceNo)}
              className="font-medium text-[#0f2744] underline hover:no-underline"
            >
              Open {linkedInvoiceNo}
            </button>
          ) : (
            row.linkedInvoiceNo ?? "—"
          ),
        },
      ];
      if (note && note.lines.length > 0) {
        fields.push({
          label: "Lines",
          value: (
            <ul className="space-y-1 text-sm">
              {note.lines.map((line, lineIndex) => (
                <li key={`${note.id}-line-${lineIndex}`}>
                  {line.productLabel} ×
                  {formatInventoryQuantity(line.quantity)}
                </li>
              ))}
            </ul>
          ),
        });
      }
      return [{ title: "Credit note", fields }];
    }

    const receiptSections: RegisterDetailSection[] = [
      {
        title: "Receipt",
        fields: [
          { label: "Invoice", value: row.invoiceNo },
          { label: "Date", value: formatDate(row.date) },
          { label: "Customer", value: row.customerLabel },
          {
            label: "Status",
            value:
              row.source === "pos"
                ? salesRegisterPosStatus(row).label
                : salesRegisterManualStatus(
                    row,
                    new Date().toLocaleDateString("en-CA", {
                      timeZone: "Africa/Accra",
                    }),
                  ).label,
          },
          { label: "Payment method", value: row.paymentMethod },
          { label: "Total", value: formatGHS(row.totalAmount) },
          { label: "Paid", value: formatGHS(row.totalReceived) },
          {
            label: "Outstanding",
            value: formatGHS(row.totalOutstanding),
          },
        ],
      },
      {
        title: "Lines",
        fields: [
          {
            label: "Items",
            value: (
              <SalesRegisterDrawerLinesList
                row={row}
                voidingId={voidingId}
                viewOnly={viewOnly}
                onVoidLine={onVoidLine}
                onRecordPayment={onRecordPayment}
              />
            ),
          },
        ],
      },
    ];

    if (extraLoading) {
      receiptSections.push({
        title: "Payments",
        fields: [{ label: " ", value: "Loading…" }],
      });
      receiptSections.push({
        title: "Returns",
        fields: [{ label: " ", value: "Loading…" }],
      });
    } else {
      receiptSections.push({
        title: "Payments",
        fields:
          drawerPayments.length === 0
            ? [{ label: " ", value: "No payments recorded." }]
            : drawerPayments.map((payment) => ({
                label: payment.label,
                value: formatDrawerPaymentSummary(payment),
              })),
      });
      receiptSections.push({
        title: "Returns",
        fields:
          drawerReturns.length === 0
            ? [{ label: " ", value: "No returns for this receipt." }]
            : drawerReturns.map((ret) => ({
                label: ret.creditNoteNumber,
                value: (
                  <div className="space-y-1">
                    <p>{formatDate(ret.creditNoteDate)}</p>
                    <ul className="text-slate-600">
                      {ret.lines.map((line, lineIndex) => (
                        <li key={`${ret.id}-${lineIndex}`}>
                          {line.productLabel} ×
                          {formatInventoryQuantity(line.quantity)}
                        </li>
                      ))}
                    </ul>
                    <p>
                      {ret.outcome} · {formatDrawerReturnSummary(ret)}
                    </p>
                  </div>
                ),
              })),
      });
    }

    return receiptSections;
  }, [
    row,
    drawerPayments,
    drawerReturns,
    extraLoading,
    linkedInvoiceNo,
    voidingId,
    viewOnly,
    onOpenReceiptByInvoice,
    onVoidLine,
    onRecordPayment,
  ]);

  const receiptRow = row?.kind === "receipt" ? row : null;

  return (
    <RegisterRecordDetailDrawer
      open={open}
      title={
        row?.kind === "return"
          ? row.creditNoteNumber ?? "Return"
          : row?.kind === "receipt"
            ? row.invoiceNo
            : "Sale detail"
      }
      subtitle={
        row?.kind === "receipt"
          ? row.customerLabel
          : row?.kind === "return"
            ? row.linkedInvoiceNo
            : null
      }
      sections={sections}
      onClose={onClose}
      footer={
        receiptRow ? (
          <SalesRegisterDrawerFooter
            row={receiptRow}
            viewOnly={viewOnly}
            onReturn={onReturn}
            onPrintReceipt={onPrintReceipt}
          />
        ) : null
      }
    />
  );
}

function SalesRegisterDrawerLinesList({
  row,
  voidingId,
  viewOnly,
  onVoidLine,
  onRecordPayment,
}: {
  row: SalesRegisterReceiptRow;
  voidingId: string | null;
  viewOnly: boolean;
  onVoidLine: (line: ProductSaleEntry) => void;
  onRecordPayment: (line: ProductSaleEntry) => void;
}) {
  return (
    <ul className="space-y-3 text-sm">
      {row.lines.map((line) => {
        const outstanding = resolveIncomeOutstandingBalance({
          amount: Number(line.amount) || 0,
          amount_received: Number(line.amount_received) || 0,
          outstanding_balance: line.outstanding_balance,
        });
        const cancelBlockReason = resolveProductSaleCancelBlockReason({
          saleQuantity: Number(line.sale_quantity) || 0,
          returnedQuantity: line.returnedQuantity ?? 0,
        });
        const fullyReturned = isSaleLineFullyReturned(
          Number(line.sale_quantity) || 0,
          line.returnedQuantity ?? 0,
        );
        return (
          <li
            key={line.id}
            className="rounded-md border border-slate-200 px-3 py-2"
          >
            <p className="font-medium text-[#0f2744]">
              {getProductSaleProductLabel(line)}
            </p>
            <p className="text-slate-600">
              Qty {formatInventoryQuantity(line.sale_quantity ?? 0)} · Unit{" "}
              {formatGHS(line.unit_price ?? 0)} · {formatGHS(line.amount)}
            </p>
            <p className="text-slate-600">
              Returned {formatInventoryQuantity(line.returnedQuantity)} · Paid{" "}
              {formatGHS(line.amount_received)} · Outstanding{" "}
              {formatGHS(outstanding)}
            </p>
            {!viewOnly ? (
              <div className="mt-2 flex flex-wrap gap-2">
                {!isProductSaleVoided(line) && outstanding > 0 ? (
                  <button
                    type="button"
                    onClick={() => onRecordPayment(line)}
                    className="rounded-md border border-emerald-300 bg-emerald-50 px-3 py-1.5 text-sm font-medium text-emerald-900 hover:bg-emerald-100"
                  >
                    Record Payment
                  </button>
                ) : null}
                {!isProductSaleVoided(line) && !fullyReturned ? (
                  cancelBlockReason ? (
                    <Tooltip content={cancelBlockReason} variant="blocked">
                      <button
                        type="button"
                        disabled
                        className="rounded-md border border-amber-200 px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-50"
                      >
                        Cancel sale
                      </button>
                    </Tooltip>
                  ) : (
                    <button
                      type="button"
                      disabled={voidingId === line.id}
                      onClick={() => onVoidLine(line)}
                      className="rounded-md border border-amber-200 px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-50"
                    >
                      {voidingId === line.id ? "Cancelling…" : "Cancel sale"}
                    </button>
                  )
                ) : null}
              </div>
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}

function SalesRegisterDrawerFooter({
  row,
  viewOnly,
  onReturn,
  onPrintReceipt,
}: {
  row: SalesRegisterReceiptRow;
  viewOnly: boolean;
  onReturn: (invoiceNo: string) => void;
  onPrintReceipt?: () => void;
}) {
  const canReturn = !row.voided && row.status !== "returned";

  return (
    <div className="flex flex-wrap gap-2">
      {onPrintReceipt ? (
        <button
          type="button"
          onClick={onPrintReceipt}
          className="rounded-md border border-slate-300 px-4 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
        >
          Print Receipt
        </button>
      ) : null}
      {canReturn ? (
        viewOnly ? (
          <Tooltip content={SALES_REGISTER_VIEW_ONLY_TOOLTIP} variant="blocked">
            <button
              type="button"
              disabled={viewOnly}
              onClick={() => onReturn(row.invoiceNo)}
              className="rounded-md border border-amber-200 px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Return
            </button>
          </Tooltip>
        ) : (
          <button
            type="button"
            disabled={viewOnly}
            onClick={() => onReturn(row.invoiceNo)}
            className="rounded-md border border-amber-200 px-4 py-2 text-sm font-medium text-amber-800 hover:bg-amber-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Return
          </button>
        )
      ) : null}
    </div>
  );
}
