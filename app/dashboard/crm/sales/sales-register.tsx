"use client";

import { confirmDialog } from "@/components/feedback/app-dialogs";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
import { RegisterRecordNameLink } from "@/app/dashboard/register-record-name-link";
import TruncatedCell, {
  registerTruncatedCellHostClassName,
} from "@/app/dashboard/register-truncated-cell";
import RegisterRowActions, {
  getStripedRowClassName,
} from "@/app/dashboard/finance/register-row-actions";
import {
  RegisterColumnFilterHeader,
  collectDistinctColumnValues,
  columnValuePassesFilter,
  type RegisterColumnFilterValue,
} from "@/app/dashboard/finance/register-column-filter";
import DashboardButton from "@/components/dashboard-button";
import Tooltip from "@/components/ui/tooltip";
import ScrollableTable, {
  scrollableTableClassName,
  scrollableTableHeadClassName,
  scrollableTableRegisterDateCellClassName,
  scrollableTableRegisterIdCellClassName,
  scrollableTableThClassName,
  scrollableTableWrapThClassName,
} from "@/app/dashboard/scrollable-table";
import FilteredListCount, {
  anyRegisterColumnFiltersActive,
} from "@/app/dashboard/filtered-list-count";
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
import { ProductSaleReturnBadge } from "../product-return-badge";
import {
  buildVoidProductSaleConfirmMessage,
  getProductSaleProductLabel,
  isProductSaleVoided,
  normalizeProductSaleEntry,
  PRODUCT_SALES_SELECT,
  type ProductSaleEntry,
} from "../product-sales-utils";
import {
  fetchIncomeIdsWithReturnCredits,
  formatVoidProductSaleRpcError,
  isProductSaleReturn,
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
import {
  buildReturnedQtyByIncomeId,
  buildSalesRegisterRows,
  computeSalesRegisterFooterTotals,
  formatSalesRegisterSourceLabel,
  formatSalesRegisterStatusLabel,
  SALES_REGISTER_SOURCE_FILTER_TOOLTIP_DIGITAL,
  salesRegisterRowsForTotals,
  type SalesRegisterReceiptRow,
  type SalesRegisterRow,
  type SalesRegisterTypeFilter,
} from "./sales-register-utils";
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

const salesRegisterTextCellClassName = `min-w-0 max-w-[7.5rem] px-2 py-3 ${registerTruncatedCellHostClassName}`;

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
};

export default function SalesRegister(props: SalesRegisterProps) {
  const router = useRouter();
  const supabase = createClient();
  const buReadScope = useBusinessUnitReadScope();
  const { viewAllBusinessUnits } = useBusinessUnitView();

  const [incomeEntries, setIncomeEntries] = useState(
    props.initialIncomeEntries.map(normalizeProductSaleEntry),
  );
  const [webhookSales, setWebhookSales] = useState(props.initialWebhookSales);
  const [returnedQtyByIncomeId, setReturnedQtyByIncomeId] = useState<
    Map<string, number>
  >(() => new Map());
  const [incomeIdsWithReturns, setIncomeIdsWithReturns] = useState<Set<string>>(
    () => new Set(),
  );
  const [error, setError] = useState<string | null>(props.fetchError);
  const [showForm, setShowForm] = useState(false);
  const [showBulkImport, setShowBulkImport] = useState(false);
  const [returnInvoiceNo, setReturnInvoiceNo] = useState<string | null>(null);
  const [recordPaymentEntry, setRecordPaymentEntry] =
    useState<ProductSaleEntry | null>(null);
  const refreshIncomeRef = useRef<(() => Promise<void>) | null>(null);

  const [typeFilter, setTypeFilter] = useState<SalesRegisterTypeFilter>("all");
  const [sourceFilter, setSourceFilter] =
    useState<RegisterColumnFilterValue>(null);
  const [statusFilter, setStatusFilter] =
    useState<RegisterColumnFilterValue>(null);
  const [paymentStatusFilter, setPaymentStatusFilter] =
    useState<RegisterColumnFilterValue>(null);
  const [customerFilter, setCustomerFilter] =
    useState<RegisterColumnFilterValue>(null);
  const [salesRepFilter, setSalesRepFilter] =
    useState<RegisterColumnFilterValue>(null);
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");

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
      buildSalesRegisterRows({
        incomeEntries,
        webhookSales,
        returnedQtyByIncomeId,
        refundsByCreditNoteId,
        employees: props.initialEmployees,
        clients: props.initialClients,
        includeDigitalRows: viewAllBusinessUnits,
        getCustomerLabel,
      }),
    [
      incomeEntries,
      webhookSales,
      returnedQtyByIncomeId,
      refundsByCreditNoteId,
      props.initialEmployees,
      props.initialClients,
      viewAllBusinessUnits,
      getCustomerLabel,
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
    const withReturns = await fetchIncomeIdsWithReturnCredits(
      supabase,
      saleLineIds,
    );
    setIncomeIdsWithReturns(withReturns);
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
      setError(refreshError.message);
      return;
    }
    const normalized = ((data as ProductSaleEntry[] | null) ?? []).map((row) =>
      normalizeProductSaleEntry(row),
    );
    setIncomeEntries(normalized);
    await reloadReturnedQuantities(normalized);
    setError(null);
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
      setError(webhookError.message);
      return;
    }
    setWebhookSales(
      ((data as Parameters<typeof normalizeWebhookSale>[0][] | null) ?? []).map(
        (row) => normalizeWebhookSale(row),
      ),
    );
  }

  async function refreshAll() {
    await Promise.all([refreshIncomeEntries(), refreshWebhookSales()]);
    router.refresh();
  }

  useEffect(() => {
    void reloadReturnedQuantities(incomeEntries);
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

  const visibleRows = useMemo(() => {
    return allRows.filter((row) => {
      if (typeFilter === "sales" && row.kind === "return") {
        return false;
      }
      if (typeFilter === "returns" && row.kind !== "return") {
        return false;
      }
      const date =
        row.kind === "digital" ? row.date : row.date?.slice(0, 10) ?? "";
      if (dateFrom && date < dateFrom) {
        return false;
      }
      if (dateTo && date > dateTo) {
        return false;
      }
      const customer =
        row.kind === "receipt"
          ? row.customerLabel
          : row.kind === "return"
            ? row.customerLabel
            : row.customerLabel;
      if (!columnValuePassesFilter(customer, customerFilter)) {
        return false;
      }
      const sourceLabel =
        row.kind === "digital"
          ? "Digital"
          : formatSalesRegisterSourceLabel(row.source);
      if (!columnValuePassesFilter(sourceLabel, sourceFilter)) {
        return false;
      }
      const statusLabel =
        row.kind === "return"
          ? "Return"
          : row.kind === "receipt"
            ? formatSalesRegisterStatusLabel(row)
            : row.status;
      if (!columnValuePassesFilter(statusLabel, statusFilter)) {
        return false;
      }
      const paymentStatus =
        row.kind === "digital"
          ? row.paymentStatus
          : row.kind === "return"
            ? row.paymentStatus
            : row.paymentStatus;
      if (!columnValuePassesFilter(paymentStatus, paymentStatusFilter)) {
        return false;
      }
      const rep =
        row.kind === "digital" ? row.salesRepLabel : row.salesRepLabel;
      if (!columnValuePassesFilter(rep, salesRepFilter)) {
        return false;
      }
      return true;
    });
  }, [
    allRows,
    typeFilter,
    dateFrom,
    dateTo,
    customerFilter,
    sourceFilter,
    statusFilter,
    paymentStatusFilter,
    salesRepFilter,
  ]);

  const footerTotals = useMemo(
    () =>
      computeSalesRegisterFooterTotals(
        salesRegisterRowsForTotals(visibleRows),
      ),
    [visibleRows],
  );

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
        setError(result.reason);
        return;
      }
      if (result.kind === "pos") {
        setActiveReceipt({ kind: "pos", receipt: result.receipt });
        return;
      }
      setActiveReceipt({ kind: "product_sale", receipt: result.receipt });
    } catch (printError) {
      setError(
        printError instanceof Error
          ? printError.message
          : "Unable to load receipt.",
      );
    } finally {
      setPrintingKey(null);
    }
  }

  const customerOptions = useMemo(
    () => collectDistinctColumnValues(allRows.map((row) => row.kind === "digital" ? row.customerLabel : row.customerLabel)),
    [allRows],
  );
  const sourceOptions = useMemo(
    () =>
      collectDistinctColumnValues(
        allRows.map((row) =>
          row.kind === "digital"
            ? "Digital"
            : formatSalesRegisterSourceLabel(row.source),
        ),
      ),
    [allRows],
  );
  const statusOptions = useMemo(
    () =>
      collectDistinctColumnValues(
        allRows.map((row) =>
          row.kind === "return"
            ? "Return"
            : row.kind === "receipt"
              ? formatSalesRegisterStatusLabel(row)
              : row.status,
        ),
      ),
    [allRows],
  );
  const salesRepOptions = useMemo(
    () => collectDistinctColumnValues(allRows.map((row) => row.salesRepLabel)),
    [allRows],
  );

  return (
    <div className="min-w-0 space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-600">
          All product sales, POS receipts, returns, and digital webhook sales in
          one register. Remaining balances on manual sales use due dates for
          reminders.
        </p>
        <div className="flex gap-2">
          <DashboardButton
            type="button"
            variant="secondary"
            disabled={registerViewOnly}
            tooltip={registerViewOnly ? SALES_REGISTER_VIEW_ONLY_TOOLTIP : undefined}
            onClick={() =>
              showBulkImport ? setShowBulkImport(false) : setShowBulkImport(true)
            }
          >
            {showBulkImport ? "Cancel Import" : "Bulk Import"}
          </DashboardButton>
          <DashboardButton
            type="button"
            variant="primary"
            disabled={registerViewOnly}
            tooltip={registerViewOnly ? SALES_REGISTER_VIEW_ONLY_TOOLTIP : undefined}
            onClick={() => (showForm ? setShowForm(false) : setShowForm(true))}
          >
            {showForm ? "Cancel" : "Add Sale"}
          </DashboardButton>
        </div>
      </div>

      {error ? (
        <p className="rounded-md border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          {error}
        </p>
      ) : null}

      {!viewAllBusinessUnits ? (
        <p className="text-xs text-slate-500">
          Digital (webhook) sales are hidden while a specific business unit is
          selected. Switch to All Businesses to include them.
        </p>
      ) : null}

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

      {activeReceipt?.kind === "pos" ? (
        <PosReceiptPanel
          receipt={activeReceipt.receipt}
          onPrint={() => window.print()}
          onClose={() => setActiveReceipt(null)}
        />
      ) : null}
      {activeReceipt?.kind === "product_sale" ? (
        <ProductSaleReceiptPanel
          receipt={activeReceipt.receipt}
          onPrint={() => window.print()}
          onClose={() => setActiveReceipt(null)}
        />
      ) : null}

      <div className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">
            Type
          </label>
          <select
            value={typeFilter}
            onChange={(e) =>
              setTypeFilter(e.target.value as SalesRegisterTypeFilter)
            }
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            <option value="all">All</option>
            <option value="sales">Sales</option>
            <option value="returns">Returns</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">
            From
          </label>
          <input
            type="date"
            value={dateFrom}
            onChange={(e) => setDateFrom(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-600">
            To
          </label>
          <input
            type="date"
            value={dateTo}
            onChange={(e) => setDateTo(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
        </div>
      </div>

      <FilteredListCount
        filteredCount={visibleRows.length}
        totalCount={allRows.length}
        itemSingular="row"
        hasActiveFilters={
          typeFilter !== "all" ||
          Boolean(dateFrom || dateTo) ||
          anyRegisterColumnFiltersActive(
            customerFilter,
            sourceFilter,
            statusFilter,
            paymentStatusFilter,
            salesRepFilter,
          )
        }
      />

      <ScrollableTable stickyEdgeColumns stickyEdgeLayout="default">
        <table className={scrollableTableClassName}>
          <thead className={scrollableTableHeadClassName}>
            <tr>
              <th className={scrollableTableThClassName}>Date</th>
              <th className={scrollableTableRegisterIdCellClassName}>
                Invoice No.
              </th>
              <th className={scrollableTableWrapThClassName}>
                <RegisterColumnFilterHeader
                  label="Customer"
                  options={customerOptions}
                  applied={customerFilter}
                  onApply={setCustomerFilter}
                />
              </th>
              <th className={scrollableTableWrapThClassName}>Items</th>
              <th className={scrollableTableThClassName}>Total</th>
              <th className={scrollableTableThClassName}>Paid</th>
              <th className={scrollableTableThClassName}>Outstanding</th>
              <th className={scrollableTableWrapThClassName}>
                <RegisterColumnFilterHeader
                  label="Payment Status"
                  options={collectDistinctColumnValues(
                    allRows.map((row) =>
                      row.kind === "digital"
                        ? row.paymentStatus
                        : row.paymentStatus,
                    ),
                  )}
                  applied={paymentStatusFilter}
                  onApply={setPaymentStatusFilter}
                />
              </th>
              <th className={scrollableTableThClassName}>Payment Method</th>
              <th className={scrollableTableWrapThClassName}>
                <Tooltip content={SALES_REGISTER_SOURCE_FILTER_TOOLTIP_DIGITAL}>
                  <span className="inline-flex">
                    <RegisterColumnFilterHeader
                      label="Source"
                      options={sourceOptions}
                      applied={sourceFilter}
                      onApply={setSourceFilter}
                    />
                  </span>
                </Tooltip>
              </th>
              <th className={scrollableTableWrapThClassName}>
                <RegisterColumnFilterHeader
                  label="Sales Rep"
                  options={salesRepOptions}
                  applied={salesRepFilter}
                  onApply={setSalesRepFilter}
                />
              </th>
              <th className={scrollableTableWrapThClassName}>
                <RegisterColumnFilterHeader
                  label="Status"
                  options={statusOptions}
                  applied={statusFilter}
                  onApply={setStatusFilter}
                />
              </th>
              <th className={scrollableTableThClassName}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-200">
            {visibleRows.length === 0 ? (
              <tr>
                <td colSpan={13} className="px-4 py-8 text-center text-slate-500">
                  No sales match the current filters.
                </td>
              </tr>
            ) : (
              visibleRows.map((row, index) => (
                <SalesRegisterTableRow
                  key={row.rowKey}
                  row={row}
                  index={index}
                  incomeIdsWithReturns={incomeIdsWithReturns}
                  printingKey={printingKey}
                  voidingId={voidingId}
                  viewOnly={registerViewOnly}
                  onOpenDrawer={() => setDrawerRowKey(row.rowKey)}
                  onReturn={(invoice) => setReturnInvoiceNo(invoice)}
                  onRecordPayment={(entry) => setRecordPaymentEntry(entry)}
                  onPrintReceipt={
                    row.kind === "receipt"
                      ? () => void handlePrintReceipt(row)
                      : undefined
                  }
                  onVoidLine={(line) => void handleVoidLine(line)}
                />
              ))
            )}
          </tbody>
        </table>
      </ScrollableTable>

      <div className="grid gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm sm:grid-cols-3">
        <p>
          <span className="text-slate-600">Gross sales:</span>{" "}
          <span className="font-medium text-[#0f2744]">
            {formatGHS(footerTotals.grossSales)}
          </span>
        </p>
        <p>
          <span className="text-slate-600">Returns:</span>{" "}
          <span className="font-medium text-amber-900">
            {formatGHS(footerTotals.returns)}
          </span>
        </p>
        <p>
          <span className="text-slate-600">Net sales:</span>{" "}
          <span className="font-semibold text-[#0f2744]">
            {formatGHS(footerTotals.netSales)}
          </span>
        </p>
      </div>

      <SalesRegisterDetailDrawer
        row={drawerRow}
        open={drawerRow != null}
        onClose={() => setDrawerRowKey(null)}
        incomeIdsWithReturns={incomeIdsWithReturns}
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

function SalesRegisterTableRow({
  row,
  index,
  incomeIdsWithReturns,
  printingKey,
  voidingId,
  viewOnly,
  onOpenDrawer,
  onReturn,
  onRecordPayment,
  onPrintReceipt,
  onVoidLine,
}: {
  row: SalesRegisterRow;
  index: number;
  incomeIdsWithReturns: Set<string>;
  printingKey: string | null;
  voidingId: string | null;
  viewOnly: boolean;
  onOpenDrawer: () => void;
  onReturn: (invoiceNo: string) => void;
  onRecordPayment: (entry: ProductSaleEntry) => void;
  onPrintReceipt?: () => void;
  onVoidLine: (line: ProductSaleEntry) => void;
}) {
  if (row.kind === "digital") {
    return (
      <tr className={getStripedRowClassName(index)}>
        <td className={scrollableTableRegisterDateCellClassName}>
          {formatDate(row.date)}
        </td>
        <td className={scrollableTableRegisterIdCellClassName}>—</td>
        <td className={salesRegisterTextCellClassName}>
          <TruncatedCell>{row.customerLabel}</TruncatedCell>
        </td>
        <td className={salesRegisterTextCellClassName}>
          <TruncatedCell>{row.itemsSummary}</TruncatedCell>
        </td>
        <td className="px-2 py-3">{formatGHS(row.totalAmount)}</td>
        <td className="px-2 py-3">{formatGHS(row.totalReceived)}</td>
        <td className="px-2 py-3">{formatGHS(row.totalOutstanding)}</td>
        <td className="px-2 py-3">{row.paymentStatus ?? "—"}</td>
        <td className="px-2 py-3">{row.paymentMethod ?? "—"}</td>
        <td className="px-2 py-3">Digital</td>
        <td className={salesRegisterTextCellClassName}>
          <TruncatedCell>—</TruncatedCell>
        </td>
        <td className="px-4 py-3">{row.status}</td>
        <td className="px-4 py-3 text-sm text-slate-400">—</td>
      </tr>
    );
  }

  if (row.kind === "return") {
    return (
      <tr className={`${getStripedRowClassName(index)} opacity-60`}>
        <td className={scrollableTableRegisterDateCellClassName}>
          {formatDate(row.date)}
        </td>
        <td className={scrollableTableRegisterIdCellClassName}>
          <RegisterRecordNameLink onOpen={onOpenDrawer}>
            {row.linkedInvoiceNo ?? "—"}
          </RegisterRecordNameLink>
          {row.creditNoteNumber ? (
            <span className="mt-0.5 block text-xs text-slate-500">
              {row.creditNoteNumber}
            </span>
          ) : null}
        </td>
        <td className={salesRegisterTextCellClassName}>
          <TruncatedCell>{row.customerLabel}</TruncatedCell>
        </td>
        <td className={salesRegisterTextCellClassName}>
          <TruncatedCell>{row.itemsSummary}</TruncatedCell>
        </td>
        <td className="px-2 py-3 text-amber-900">{formatGHS(row.totalAmount)}</td>
        <td className="px-2 py-3">—</td>
        <td className="px-2 py-3">—</td>
        <td className="px-2 py-3">{row.paymentStatus}</td>
        <td className="px-2 py-3">{row.paymentMethod}</td>
        <td className="px-2 py-3">
          {formatSalesRegisterSourceLabel(row.source)}
        </td>
        <td className={salesRegisterTextCellClassName}>
          <TruncatedCell>{row.salesRepLabel}</TruncatedCell>
        </td>
        <td className="px-4 py-3">
          <ProductSaleReturnBadge />
        </td>
        <td className="px-4 py-3 text-sm text-slate-400">—</td>
      </tr>
    );
  }

  const outstandingLines = row.lines.filter((line) => {
    if (isProductSaleVoided(line)) {
      return false;
    }
    return (
      resolveIncomeOutstandingBalance({
        amount: Number(line.amount) || 0,
        amount_received: Number(line.amount_received) || 0,
        outstanding_balance: line.outstanding_balance,
      }) > 0
    );
  });
  const singlePaymentLine =
    outstandingLines.length === 1 ? outstandingLines[0] : null;
  const canReturn =
    !row.voided &&
    row.status !== "returned" &&
    row.lines.some((line) => !isProductSaleVoided(line));
  const voidDisabled = row.lines.some((line) => incomeIdsWithReturns.has(line.id));
  const singleLine = row.lines.length === 1 ? row.lines[0] : null;

  return (
    <tr
      className={`${getStripedRowClassName(index)}${row.voided ? " opacity-60" : ""}`}
    >
      <td className={scrollableTableRegisterDateCellClassName}>
        {formatDate(row.date)}
      </td>
      <td className={scrollableTableRegisterIdCellClassName}>
        <RegisterRecordNameLink onOpen={onOpenDrawer}>
          {row.invoiceNo}
        </RegisterRecordNameLink>
      </td>
      <td className={salesRegisterTextCellClassName}>
        <TruncatedCell>
          {row.clientId ? (
            <Link
              href={`/dashboard/crm/customers/${encodeURIComponent(row.clientId)}`}
              className="text-[#0f2744] hover:underline"
            >
              {row.customerLabel}
            </Link>
          ) : (
            row.customerLabel
          )}
        </TruncatedCell>
      </td>
      <td className={salesRegisterTextCellClassName}>
        <TruncatedCell>{row.itemsSummary}</TruncatedCell>
      </td>
      <td className="px-2 py-3">{formatGHS(row.totalAmount)}</td>
      <td className="px-2 py-3">{formatGHS(row.totalReceived)}</td>
      <td className="px-2 py-3">{formatGHS(row.totalOutstanding)}</td>
      <td className="px-2 py-3">{row.paymentStatus}</td>
      <td className="px-2 py-3">{row.paymentMethod}</td>
      <td className="px-2 py-3">
        {formatSalesRegisterSourceLabel(row.source)}
      </td>
      <td className={salesRegisterTextCellClassName}>
        <TruncatedCell>{row.salesRepLabel}</TruncatedCell>
      </td>
      <td className="px-2 py-3">{formatSalesRegisterStatusLabel(row)}</td>
      <RegisterRowActions
        compact
        onPrint={onPrintReceipt}
        printing={printingKey === row.rowKey}
        onReturn={
          canReturn && !viewOnly ? () => onReturn(row.invoiceNo) : undefined
        }
        disableReturn={viewOnly}
        returnDisabledTitle={SALES_REGISTER_VIEW_ONLY_TOOLTIP}
        onRecordPayment={
          singlePaymentLine && !viewOnly
            ? () => onRecordPayment(singlePaymentLine)
            : undefined
        }
        disableRecordPayment={viewOnly}
        recordPaymentDisabledTitle={SALES_REGISTER_VIEW_ONLY_TOOLTIP}
        onVoid={
          singleLine && !row.voided && !viewOnly
            ? () => onVoidLine(singleLine)
            : undefined
        }
        disableVoid={row.voided || voidDisabled || !singleLine || viewOnly}
        voidDisabledTitle={
          viewOnly
            ? SALES_REGISTER_VIEW_ONLY_TOOLTIP
            : voidDisabled
              ? "This sale has returns. Use Return instead."
              : !singleLine
                ? "Void each line from the receipt detail drawer."
                : undefined
        }
        voiding={singleLine ? voidingId === singleLine.id : false}
      />
    </tr>
  );
}

function SalesRegisterDetailDrawer({
  row,
  open,
  onClose,
  incomeIdsWithReturns,
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
  incomeIdsWithReturns: Set<string>;
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
          { label: "Status", value: formatSalesRegisterStatusLabel(row) },
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
                incomeIdsWithReturns={incomeIdsWithReturns}
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
    incomeIdsWithReturns,
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
  incomeIdsWithReturns,
  voidingId,
  viewOnly,
  onVoidLine,
  onRecordPayment,
}: {
  row: SalesRegisterReceiptRow;
  incomeIdsWithReturns: Set<string>;
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
        const hasReturns = incomeIdsWithReturns.has(line.id);
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
                {!isProductSaleVoided(line) ? (
                  hasReturns ? (
                    <Tooltip
                      content="This sale has returns. Use Return instead."
                      variant="blocked"
                    >
                      <button
                        type="button"
                        disabled={hasReturns || voidingId === line.id}
                        onClick={() => onVoidLine(line)}
                        className="rounded-md border border-amber-200 px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-50"
                      >
                        {voidingId === line.id ? "Voiding…" : "Void line"}
                      </button>
                    </Tooltip>
                  ) : (
                    <button
                      type="button"
                      disabled={hasReturns || voidingId === line.id}
                      onClick={() => onVoidLine(line)}
                      className="rounded-md border border-amber-200 px-3 py-1.5 text-sm font-medium text-amber-800 hover:bg-amber-50 disabled:opacity-50"
                    >
                      {voidingId === line.id ? "Voiding…" : "Void line"}
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
