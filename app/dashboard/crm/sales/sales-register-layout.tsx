"use client";

import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import DashboardButton from "@/components/dashboard-button";
import Tooltip from "@/components/ui/tooltip";
import { RegisterRecordNameLink } from "@/app/dashboard/register-record-name-link";
import { getStripedRowClassName } from "@/app/dashboard/finance/register-row-actions";
import { formatGHS, resolveIncomeOutstandingBalance } from "@/app/dashboard/finance/income-register-utils";
import type { RegisterColumnSortState } from "@/app/dashboard/finance/register-column-filter";
import type { RegisterColumnSortValueType } from "@/app/dashboard/finance/register-column-filter";
import {
  isProductSaleVoided,
  type ProductSaleEntry,
} from "../product-sales-utils";
import {
  isSaleLineFullyReturned,
  resolveProductSaleCancelBlockReason,
} from "../product-return-utils";
import { SALES_REGISTER_VIEW_ONLY_TOOLTIP } from "./sales-register-drawer-data";
import {
  formatCompactPaymentMethod,
  formatRegisterItemsCompact,
  formatSalesRegisterDayMonth,
  formatSalesRegisterPosTime,
  formatSalesRegisterSourceLabel,
  salesRegisterManualStatus,
  salesRegisterPlainStatus,
  salesRegisterPosStatus,
  salesRegisterRowIncludedInCounts,
  salesRegisterRowStatusLabel,
  withCancelledStatusOption,
  type SalesRegisterReceiptRow,
  type SalesRegisterReturnRow,
  type SalesRegisterRow,
  type SalesRegisterStatusTone,
  type SalesRegisterView,
} from "./sales-register-utils";

const salesTableHeadClassName =
  "bg-[#0f2744] px-4 py-3 text-left text-sm font-medium text-white";

const SALES_REGISTER_ABOUT =
  "All product sales, POS receipts, returns, and digital webhook sales in one register. Remaining balances on manual sales use due dates for reminders.";

function onSalesViewKeyDown(
  event: KeyboardEvent<HTMLButtonElement>,
  index: number,
  onView: (view: SalesRegisterView) => void,
) {
  const last = VIEW_LABELS.length - 1;
  let next = index;
  if (event.key === "ArrowRight" || event.key === "ArrowDown") {
    next = index === last ? 0 : index + 1;
  } else if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
    next = index === 0 ? last : index - 1;
  } else if (event.key === "Home") {
    next = 0;
  } else if (event.key === "End") {
    next = last;
  } else {
    return;
  }
  event.preventDefault();
  const nextView = VIEW_LABELS[next]?.id;
  if (!nextView) {
    return;
  }
  onView(nextView);
  document.getElementById(`sales-register-view-${nextView}`)?.focus();
}

const VIEW_LABELS: { id: SalesRegisterView; label: string }[] = [
  { id: "manual", label: "Manual sales" },
  { id: "pos", label: "POS sales log" },
  { id: "returns", label: "Returns and credit notes" },
  { id: "digital", label: "Digital" },
  { id: "all", label: "All" },
];

const chipClassName =
  "rounded-full border border-slate-300 bg-white px-3 py-1 text-sm text-slate-700 hover:bg-slate-50";
const chipActiveClassName =
  "rounded-full border border-[#0f2744] bg-white px-3 py-1 text-sm font-medium text-[#0f2744]";

function tableMoney(value: number): string {
  return value.toLocaleString("en-GH", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function negativeMoney(value: number): string {
  const amount = value > 0 ? -value : value;
  return tableMoney(amount);
}

function StatusPill({
  label,
  tone,
}: {
  label: string;
  tone: SalesRegisterStatusTone;
}) {
  const className =
    tone === "paid"
      ? "bg-emerald-100 text-emerald-800"
      : tone === "part" || tone === "overdue"
        ? "bg-amber-100 text-amber-950"
        : tone === "cancelled"
          ? "bg-slate-200 text-slate-700"
          : tone === "refunded"
            ? "bg-sky-100 text-sky-900"
            : tone === "available"
              ? "bg-emerald-50 text-emerald-800"
              : tone === "returned"
                ? "bg-slate-100 text-slate-600"
                : "bg-slate-100 text-slate-600";
  return (
    <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-medium ${className}`}>
      {label}
    </span>
  );
}

function SortHeader({
  label,
  columnId,
  valueType,
  sort,
  onSort,
  className = "",
}: {
  label: string;
  columnId: string;
  valueType: RegisterColumnSortValueType;
  sort: RegisterColumnSortState | null;
  onSort: (columnId: string, valueType: RegisterColumnSortValueType) => void;
  className?: string;
}) {
  const active = sort?.columnId === columnId;
  return (
    <th className={`${salesTableHeadClassName} ${className}`}>
      <button
        type="button"
        className="inline-flex items-center gap-1 text-white hover:text-white/80"
        onClick={() => onSort(columnId, valueType)}
      >
        {label}
        <span aria-hidden className={active ? "text-white" : "text-white/70"}>
          {active ? (sort.direction === "asc" ? "↑" : "↓") : "↕"}
        </span>
      </button>
    </th>
  );
}

function FilterSelect({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (value: string) => void;
}) {
  return (
    <select
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={value ? chipActiveClassName : chipClassName}
    >
      <option value="">{label}</option>
      {options.map((option) => (
        <option key={option} value={option}>
          {option}
        </option>
      ))}
    </select>
  );
}

function distinct(values: string[]): string[] {
  return [...new Set(values.filter((value) => value && value !== "—"))].sort(
    (left, right) => left.localeCompare(right),
  );
}

export function SalesRegisterLayout({
  view,
  onView,
  viewCounts,
  children,
  viewAllBusinessUnits,
  showForm,
  onToggleForm,
  showBulkImport,
  onToggleBulkImport,
  registerViewOnly,
  rows,
  tabRows,
  todayIso,
  posTodayOnly,
  onTogglePosToday,
  outstandingOnly,
  onToggleOutstanding,
  overdueOnly,
  onToggleOverdue,
  dateFrom,
  dateTo,
  onDateFrom,
  onDateTo,
  dateRangeOpen,
  onToggleDateRange,
  methodFilter,
  onMethodFilter,
  salesRepChip,
  onSalesRepChip,
  statusChip,
  onStatusChip,
  settlementChip,
  onSettlementChip,
  creditStatusChip,
  onCreditStatusChip,
  sourceChip,
  onSourceChip,
  columnSort,
  onSort,
  printingKey,
  voidingId,
  onOpenDrawer,
  onReturn,
  onRecordPayment,
  onPrintReceipt,
  onVoidLine,
  onOpenCreditNote,
}: {
  view: SalesRegisterView;
  onView: (view: SalesRegisterView) => void;
  viewCounts: Record<SalesRegisterView, number>;
  children?: ReactNode;
  viewAllBusinessUnits: boolean;
  showForm: boolean;
  onToggleForm: () => void;
  showBulkImport: boolean;
  onToggleBulkImport: () => void;
  registerViewOnly: boolean;
  rows: SalesRegisterRow[];
  tabRows: SalesRegisterRow[];
  todayIso: string;
  posTodayOnly: boolean;
  onTogglePosToday: () => void;
  outstandingOnly: boolean;
  onToggleOutstanding: () => void;
  overdueOnly: boolean;
  onToggleOverdue: () => void;
  dateFrom: string;
  dateTo: string;
  onDateFrom: (value: string) => void;
  onDateTo: (value: string) => void;
  dateRangeOpen: boolean;
  onToggleDateRange: () => void;
  methodFilter: string;
  onMethodFilter: (value: string) => void;
  salesRepChip: string;
  onSalesRepChip: (value: string) => void;
  statusChip: string;
  onStatusChip: (value: string) => void;
  settlementChip: string;
  onSettlementChip: (value: string) => void;
  creditStatusChip: string;
  onCreditStatusChip: (value: string) => void;
  sourceChip: string;
  onSourceChip: (value: string) => void;
  columnSort: RegisterColumnSortState | null;
  onSort: (columnId: string, valueType: RegisterColumnSortValueType) => void;
  printingKey: string | null;
  voidingId: string | null;
  onOpenDrawer: (row: SalesRegisterRow) => void;
  onReturn: (invoiceNo: string) => void;
  onRecordPayment: (entry: ProductSaleEntry) => void;
  onPrintReceipt: (row: SalesRegisterReceiptRow) => void;
  onVoidLine: (line: ProductSaleEntry) => void;
  onOpenCreditNote: (creditNoteNumber: string) => void;
}) {
  const dateRangeActive = Boolean(dateFrom || dateTo);
  const posReceipts = tabRows.filter(
    (row): row is SalesRegisterReceiptRow => row.kind === "receipt",
  );
  const methodOptions = distinct(
    posReceipts.map((row) => formatCompactPaymentMethod(row.paymentMethod)),
  );
  const repOptions = distinct(posReceipts.map((row) => row.salesRepLabel));
  const posStatusOptions = withCancelledStatusOption(
    distinct(posReceipts.map((row) => salesRegisterPosStatus(row).label)),
  );
  const manualStatusOptions = withCancelledStatusOption(
    distinct(
      tabRows
        .filter((row): row is SalesRegisterReceiptRow => row.kind === "receipt")
        .map((row) => salesRegisterManualStatus(row, todayIso).label),
    ),
  );
  const digitalStatusOptions = withCancelledStatusOption(
    distinct(
      tabRows
        .filter((row) => row.kind === "digital")
        .map((row) => salesRegisterRowStatusLabel(row, todayIso, "digital")),
    ),
  );
  const settlementOptions = distinct(
    tabRows
      .filter((row): row is SalesRegisterReturnRow => row.kind === "return")
      .map((row) => row.paymentMethod),
  );
  const creditOptions = distinct(
    tabRows
      .filter((row): row is SalesRegisterReturnRow => row.kind === "return")
      .map((row) => row.paymentStatus),
  );
  const sourceOptions = distinct(
    tabRows.map((row) =>
      row.kind === "digital" ? "Digital" : formatSalesRegisterSourceLabel(row.source),
    ),
  );
  const allStatusOptions = withCancelledStatusOption(
    distinct(
      tabRows.map((row) => salesRegisterRowStatusLabel(row, todayIso, "all")),
    ),
  );

  return (
    <div className="min-w-0 space-y-4">
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
        <h2 className="flex min-w-0 items-center gap-2 text-xl font-semibold text-[#0f2744]">
          Sales
          <Tooltip content={SALES_REGISTER_ABOUT}>
            <button
              type="button"
              aria-label="About Sales"
              className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-slate-300 text-[11px] font-medium text-slate-500"
            >
              i
            </button>
          </Tooltip>
        </h2>
        <div className="flex w-full min-w-0 max-w-full flex-wrap items-stretch justify-start gap-2 sm:w-auto sm:justify-end">
          <DashboardButton
            type="button"
            variant="secondary"
            disabled={registerViewOnly}
            tooltip={registerViewOnly ? SALES_REGISTER_VIEW_ONLY_TOOLTIP : undefined}
            onClick={onToggleBulkImport}
            className="min-w-0 flex-1 basis-[8.5rem] whitespace-normal px-3 text-center sm:flex-none"
          >
            {showBulkImport ? "Cancel Import" : "Bulk Import"}
          </DashboardButton>
          {view === "pos" ? (
            <Link
              href="/dashboard/pos"
              className="inline-flex min-h-10 min-w-0 flex-1 basis-[8.5rem] items-center justify-center gap-2 whitespace-normal rounded-md border border-slate-300 bg-white px-3 py-2 text-center text-sm font-medium text-[#0f2744] hover:bg-slate-50 sm:flex-none"
            >
              <svg aria-hidden viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth="1.8">
                <rect x="3" y="4" width="18" height="12" rx="2" />
                <path d="M8 20h8M12 16v4" />
              </svg>
              Open POS
            </Link>
          ) : null}
          {view === "manual" || view === "all" ? (
            <DashboardButton
              type="button"
              variant="primary"
              disabled={registerViewOnly}
              tooltip={registerViewOnly ? SALES_REGISTER_VIEW_ONLY_TOOLTIP : undefined}
              onClick={onToggleForm}
              className="min-w-0 flex-1 basis-[8.5rem] whitespace-normal px-3 text-center sm:flex-none"
            >
              {showForm ? "Cancel" : "+ Add sale"}
            </DashboardButton>
          ) : null}
        </div>
      </div>

      <div
        role="tablist"
        aria-label="Sales views"
        className="flex flex-wrap gap-2"
      >
        {VIEW_LABELS.map((item, index) => {
          const active = view === item.id;
          return (
            <button
              key={item.id}
              id={`sales-register-view-${item.id}`}
              type="button"
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              onClick={() => onView(item.id)}
              onKeyDown={(event) => onSalesViewKeyDown(event, index, onView)}
              className={`rounded-lg border px-[14px] py-[9px] text-[14px] font-medium ${
                active
                  ? "border-[#0f2744] bg-[#0f2744] text-white"
                  : "border-slate-400 bg-white text-[#0f2744] hover:bg-slate-50"
              }`}
            >
              {item.label}
              <span
                className={`ml-2 inline-flex min-w-5 items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-medium leading-none ${
                  active
                    ? "bg-white/30 text-white"
                    : "bg-slate-100 text-slate-500"
                }`}
              >
                {viewCounts[item.id]}
              </span>
            </button>
          );
        })}
      </div>

      {children}

      {view === "digital" ? (
        <p className="text-xs text-slate-500">
          {viewAllBusinessUnits
            ? "Digital webhook sales are not tagged to a business unit. They appear in this view when All Businesses is selected."
            : "Digital (webhook) sales are hidden while a specific business unit is selected. Switch to All Businesses to include them."}
        </p>
      ) : null}

      <SalesRegisterCards
        view={view}
        rows={rows}
        posTodayOnly={posTodayOnly}
      />

      <div className="flex flex-wrap items-center gap-2">
        {view === "pos" ? (
          <>
            <button
              type="button"
              className={posTodayOnly ? chipActiveClassName : chipClassName}
              onClick={onTogglePosToday}
            >
              Today
            </button>
            <FilterSelect
              label="Payment method"
              value={methodFilter}
              options={methodOptions}
              onChange={onMethodFilter}
            />
            <FilterSelect
              label="Sales rep"
              value={salesRepChip}
              options={repOptions}
              onChange={onSalesRepChip}
            />
            <FilterSelect
              label="Status"
              value={statusChip}
              options={posStatusOptions}
              onChange={onStatusChip}
            />
          </>
        ) : null}
        {view === "manual" ? (
          <>
            <FilterSelect
              label="Status"
              value={statusChip}
              options={manualStatusOptions}
              onChange={onStatusChip}
            />
            <button
              type="button"
              className={outstandingOnly ? chipActiveClassName : chipClassName}
              onClick={onToggleOutstanding}
            >
              Outstanding only
            </button>
            <button
              type="button"
              className={overdueOnly ? chipActiveClassName : chipClassName}
              onClick={onToggleOverdue}
            >
              Overdue only
            </button>
          </>
        ) : null}
        {view === "digital" ? (
          <FilterSelect
            label="Status"
            value={statusChip}
            options={digitalStatusOptions}
            onChange={onStatusChip}
          />
        ) : null}
        {view !== "pos" ? (
          <button
            type="button"
            className={dateRangeActive || dateRangeOpen ? chipActiveClassName : chipClassName}
            onClick={onToggleDateRange}
          >
            Date range
          </button>
        ) : null}
        {view === "returns" ? (
          <>
            <FilterSelect
              label="Settlement"
              value={settlementChip}
              options={settlementOptions}
              onChange={onSettlementChip}
            />
            <FilterSelect
              label="Credit status"
              value={creditStatusChip}
              options={creditOptions}
              onChange={onCreditStatusChip}
            />
          </>
        ) : null}
        {view === "all" ? (
          <>
            <FilterSelect
              label="Source"
              value={sourceChip}
              options={sourceOptions}
              onChange={onSourceChip}
            />
            <FilterSelect
              label="Status"
              value={statusChip}
              options={allStatusOptions}
              onChange={onStatusChip}
            />
          </>
        ) : null}
        {view !== "pos" && dateRangeOpen ? (
          <span className="flex items-center gap-2">
            <input
              type="date"
              aria-label="From"
              value={dateFrom}
              onChange={(event) => onDateFrom(event.target.value)}
              className="rounded-md border border-slate-300 px-2 py-1 text-sm"
            />
            <input
              type="date"
              aria-label="To"
              value={dateTo}
              onChange={(event) => onDateTo(event.target.value)}
              className="rounded-md border border-slate-300 px-2 py-1 text-sm"
            />
          </span>
        ) : null}
      </div>

      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full table-fixed text-sm text-slate-800">
          <SalesRegisterColGroup view={view} />
          <thead className="bg-[#0f2744] text-white">
            <tr>
              {view === "pos" ? (
                <>
                  <SortHeader label="Time" columnId="time" valueType="date" sort={columnSort} onSort={onSort} />
                  <SortHeader label="Receipt" columnId="invoice" valueType="text" sort={columnSort} onSort={onSort} />
                  <SortHeader label="Items" columnId="items" valueType="text" sort={columnSort} onSort={onSort} />
                  <SortHeader label="Total" columnId="total" valueType="number" sort={columnSort} onSort={onSort} />
                  <SortHeader label="Method" columnId="method" valueType="text" sort={columnSort} onSort={onSort} />
                  <SortHeader label="Status" columnId="status" valueType="text" sort={columnSort} onSort={onSort} />
                  <th className={salesTableHeadClassName}>Actions</th>
                </>
              ) : null}
              {view === "manual" ? (
                <>
                  <SortHeader label="Invoice" columnId="invoice" valueType="text" sort={columnSort} onSort={onSort} />
                  <SortHeader label="Customer" columnId="customer" valueType="text" sort={columnSort} onSort={onSort} />
                  <SortHeader label="Total" columnId="total" valueType="number" sort={columnSort} onSort={onSort} />
                  <SortHeader label="Outstanding" columnId="outstanding" valueType="number" sort={columnSort} onSort={onSort} />
                  <SortHeader label="Due" columnId="due" valueType="date" sort={columnSort} onSort={onSort} />
                  <SortHeader label="Status" columnId="status" valueType="text" sort={columnSort} onSort={onSort} />
                  <th className={salesTableHeadClassName}>Actions</th>
                </>
              ) : null}
              {view === "returns" ? (
                <>
                  <SortHeader label="Date" columnId="date" valueType="date" sort={columnSort} onSort={onSort} />
                  <SortHeader label="Credit note" columnId="invoice" valueType="text" sort={columnSort} onSort={onSort} />
                  <SortHeader label="Original receipt/invoice" columnId="customer" valueType="text" sort={columnSort} onSort={onSort} />
                  <SortHeader label="Items" columnId="items" valueType="text" sort={columnSort} onSort={onSort} />
                  <SortHeader label="Amount" columnId="amount" valueType="number" sort={columnSort} onSort={onSort} />
                  <SortHeader label="Settlement" columnId="method" valueType="text" sort={columnSort} onSort={onSort} />
                  <SortHeader label="Credit status" columnId="status" valueType="text" sort={columnSort} onSort={onSort} />
                </>
              ) : null}
              {view === "digital" ? (
                <>
                  <SortHeader label="Date" columnId="date" valueType="date" sort={columnSort} onSort={onSort} />
                  <SortHeader label="Number" columnId="invoice" valueType="text" sort={columnSort} onSort={onSort} />
                  <SortHeader label="Customer" columnId="customer" valueType="text" sort={columnSort} onSort={onSort} />
                  <SortHeader label="Items" columnId="items" valueType="text" sort={columnSort} onSort={onSort} />
                  <SortHeader label="Total" columnId="total" valueType="number" sort={columnSort} onSort={onSort} />
                  <SortHeader label="Status" columnId="status" valueType="text" sort={columnSort} onSort={onSort} />
                </>
              ) : null}
              {view === "all" ? (
                <>
                  <SortHeader label="Date" columnId="date" valueType="date" sort={columnSort} onSort={onSort} />
                  <SortHeader label="Number" columnId="invoice" valueType="text" sort={columnSort} onSort={onSort} />
                  <SortHeader label="Source" columnId="source" valueType="text" sort={columnSort} onSort={onSort} />
                  <SortHeader label="Customer" columnId="customer" valueType="text" sort={columnSort} onSort={onSort} />
                  <SortHeader label="Total" columnId="total" valueType="number" sort={columnSort} onSort={onSort} />
                  <SortHeader label="Outstanding" columnId="outstanding" valueType="number" sort={columnSort} onSort={onSort} />
                  <SortHeader label="Status" columnId="status" valueType="text" sort={columnSort} onSort={onSort} />
                  <th className={salesTableHeadClassName}>Actions</th>
                </>
              ) : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.length === 0 ? (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-slate-500">
                  No sales match the current filters.
                </td>
              </tr>
            ) : (
              rows.map((row, index) => (
                <SalesRegisterViewRow
                  key={row.rowKey}
                  row={row}
                  index={index}
                  view={view}
                  todayIso={todayIso}
                  showDateWithTime={!posTodayOnly}
                  printingKey={printingKey}
                  voidingId={voidingId}
                  viewOnly={registerViewOnly}
                  onOpenDrawer={() => onOpenDrawer(row)}
                  onReturn={onReturn}
                  onRecordPayment={onRecordPayment}
                  onPrintReceipt={onPrintReceipt}
                  onVoidLine={onVoidLine}
                  onOpenCreditNote={onOpenCreditNote}
                />
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SalesRegisterColGroup({ view }: { view: SalesRegisterView }) {
  const widths =
    view === "pos"
      ? ["8%", "14%", "18%", "10%", "10%", "12%", "28%"]
      : view === "manual"
        ? ["12%", "16%", "11%", "12%", "10%", "12%", "27%"]
        : view === "returns"
          ? ["12%", "14%", "18%", "20%", "12%", "12%", "12%"]
          : view === "digital"
            ? ["14%", "16%", "20%", "22%", "14%", "14%"]
            : ["10%", "12%", "9%", "14%", "10%", "10%", "11%", "24%"];
  return (
    <colgroup>
      {widths.map((width, index) => (
        <col key={`${view}-${index}`} style={{ width }} />
      ))}
    </colgroup>
  );
}

function SalesRegisterCards({
  view,
  rows,
  posTodayOnly,
}: {
  view: SalesRegisterView;
  rows: SalesRegisterRow[];
  posTodayOnly: boolean;
}) {
  const cards: { label: string; value: string; tone?: "green" | "amber" }[] = [];
  if (view === "pos") {
    const sales = rows.filter(
      (row): row is SalesRegisterReceiptRow =>
        row.kind === "receipt" && salesRegisterRowIncludedInCounts(row),
    );
    cards.push(
      { label: posTodayOnly ? "Sales today" : "Sales", value: String(sales.length) },
      {
        label: "Total",
        value: formatGHS(sales.reduce((sum, row) => sum + row.totalAmount, 0)),
      },
    );
    const byMethod = new Map<string, number>();
    for (const row of sales) {
      const method = row.paymentMethod?.trim();
      if (!method || method === "—") {
        continue;
      }
      const label = /^mobile money$/i.test(method) ? "Mobile Money" : method;
      byMethod.set(label, (byMethod.get(label) ?? 0) + row.totalAmount);
    }
    for (const [method, amount] of byMethod) {
      cards.push({ label: method, value: formatGHS(amount), tone: "green" });
    }
  } else if (view === "returns") {
    const returns = rows.filter((row) => row.kind === "return");
    cards.push(
      { label: "Returns", value: String(returns.length) },
      {
        label: "Total returned",
        value: formatGHS(
          returns.reduce((sum, row) => sum + Math.abs(row.totalAmount), 0),
        ),
      },
      {
        label: "Refunded in cash",
        value: formatGHS(
          returns.reduce(
            (sum, row) => sum + (row.kind === "return" ? row.refundedCash : 0),
            0,
          ),
        ),
      },
      {
        label: "Store credit available",
        value: formatGHS(
          returns.reduce(
            (sum, row) =>
              sum + (row.kind === "return" ? row.storeCreditAvailable : 0),
            0,
          ),
        ),
      },
    );
  } else if (view === "digital" || view === "manual" || view === "all") {
    const sales = rows.filter(
      (row) =>
        salesRegisterRowIncludedInCounts(row) &&
        row.kind !== "return" &&
        (row.kind === "receipt" || (view !== "manual" && row.kind === "digital")),
    );
    cards.push(
      {
        label: view === "manual" ? "Sales" : view === "digital" ? "Sales" : "Sales",
        value: String(sales.length),
      },
      {
        label: "Total",
        value: formatGHS(sales.reduce((sum, row) => sum + row.totalAmount, 0)),
      },
      {
        label: "Collected",
        value: formatGHS(
          sales.reduce(
            (sum, row) => sum + (row.kind === "return" ? 0 : row.totalReceived),
            0,
          ),
        ),
        tone: "green",
      },
      {
        label: "Outstanding",
        value: formatGHS(
          sales.reduce(
            (sum, row) => sum + (row.kind === "return" ? 0 : row.totalOutstanding),
            0,
          ),
        ),
        tone: "amber",
      },
    );
  }

  if (cards.length === 0) {
    return null;
  }

  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {cards.map((card) => (
        <div
          key={card.label}
          className="rounded-lg border border-slate-200 bg-white px-4 py-3"
        >
          <p className="text-sm text-slate-500">{card.label}</p>
          <p
            className={`mt-1 text-2xl font-semibold ${
              card.tone === "green"
                ? "text-emerald-600"
                : card.tone === "amber"
                  ? "text-amber-600"
                  : "text-[#0f2744]"
            }`}
          >
            {card.value}
          </p>
        </div>
      ))}
    </div>
  );
}

function cellClassName(extra = "") {
  return `truncate px-3 py-2.5 ${extra}`;
}

function SalesRegisterViewRow({
  row,
  index,
  view,
  todayIso,
  showDateWithTime,
  printingKey,
  voidingId,
  viewOnly,
  onOpenDrawer,
  onReturn,
  onRecordPayment,
  onPrintReceipt,
  onVoidLine,
  onOpenCreditNote,
}: {
  row: SalesRegisterRow;
  index: number;
  view: SalesRegisterView;
  todayIso: string;
  showDateWithTime: boolean;
  printingKey: string | null;
  voidingId: string | null;
  viewOnly: boolean;
  onOpenDrawer: () => void;
  onReturn: (invoiceNo: string) => void;
  onRecordPayment: (entry: ProductSaleEntry) => void;
  onPrintReceipt: (row: SalesRegisterReceiptRow) => void;
  onVoidLine: (line: ProductSaleEntry) => void;
  onOpenCreditNote: (creditNoteNumber: string) => void;
}) {
  if (view === "pos" && row.kind === "receipt") {
    const status = salesRegisterPosStatus(row);
    const timeLabel = formatSalesRegisterPosTime(
      row.saleTimestamp,
      row.date,
      !showDateWithTime,
    );
    return (
      <tr className={getStripedRowClassName(index)}>
        <td className="px-3 py-2.5 whitespace-nowrap">
          {timeLabel}
        </td>
        <td className={cellClassName("font-medium text-[#0f2744]")}>
          <RegisterRecordNameLink onOpen={onOpenDrawer}>
            {row.invoiceNo}
          </RegisterRecordNameLink>
        </td>
        <td className={cellClassName()} title={formatRegisterItemsCompact(row.lines)}>
          {formatRegisterItemsCompact(row.lines)}
        </td>
        <td className={cellClassName()}>{tableMoney(row.totalAmount)}</td>
        <td className={cellClassName()}>{formatCompactPaymentMethod(row.paymentMethod)}</td>
        <td className="px-3 py-2.5">
          {status.tone === "muted" && row.creditNoteNumbers[0] ? (
            <button
              type="button"
              className="text-left text-xs text-slate-500 hover:underline"
              onClick={() => onOpenCreditNote(row.creditNoteNumbers[0])}
            >
              {status.label}
            </button>
          ) : (
            <StatusPill label={status.label} tone={status.tone} />
          )}
        </td>
        <td className="px-3 py-2.5">
          <ReceiptActions
            row={row}
            view={view}
            viewOnly={viewOnly}
            printing={printingKey === row.rowKey}
            voidingId={voidingId}
            onReturn={onReturn}
            onRecordPayment={onRecordPayment}
            onPrint={() => onPrintReceipt(row)}
            onVoidLine={onVoidLine}
          />
        </td>
      </tr>
    );
  }

  if (view === "manual" && row.kind === "receipt") {
    const status = salesRegisterManualStatus(row, todayIso);
    return (
      <tr className={getStripedRowClassName(index)}>
        <td className={cellClassName("font-medium text-[#0f2744]")}>
          <RegisterRecordNameLink onOpen={onOpenDrawer}>
            {row.invoiceNo}
          </RegisterRecordNameLink>
        </td>
        <td className={cellClassName()} title={row.customerLabel}>
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
        </td>
        <td className={cellClassName()}>{tableMoney(row.totalAmount)}</td>
        <td className={cellClassName()}>{tableMoney(row.totalOutstanding)}</td>
        <td className={cellClassName()}>
          {row.dueDate ? formatSalesRegisterDayMonth(row.dueDate) : "—"}
        </td>
        <td className="px-3 py-2.5">
          <StatusPill label={status.label} tone={status.tone} />
        </td>
        <td className="px-3 py-2.5">
          <ReceiptActions
            row={row}
            view={view}
            viewOnly={viewOnly}
            printing={printingKey === row.rowKey}
            voidingId={voidingId}
            onReturn={onReturn}
            onRecordPayment={onRecordPayment}
            onPrint={() => onPrintReceipt(row)}
            onVoidLine={onVoidLine}
          />
        </td>
      </tr>
    );
  }

  if (view === "returns" && row.kind === "return") {
    return (
      <tr className={getStripedRowClassName(index)}>
        <td className={cellClassName()}>{formatSalesRegisterDayMonth(row.date)}</td>
        <td className={cellClassName("font-medium text-[#0f2744]")}>
          <RegisterRecordNameLink onOpen={onOpenDrawer}>
            {row.creditNoteNumber ?? "—"}
          </RegisterRecordNameLink>
        </td>
        <td className={cellClassName()}>{row.linkedInvoiceNo ?? "—"}</td>
        <td className={cellClassName()} title={formatRegisterItemsCompact(row.lines)}>
          {formatRegisterItemsCompact(row.lines)}
        </td>
        <td className={cellClassName()}>{negativeMoney(row.totalAmount)}</td>
        <td className={cellClassName()}>{row.paymentMethod}</td>
        <td className="px-3 py-2.5">
          <StatusPill {...salesRegisterPlainStatus(row.paymentStatus)} />
        </td>
      </tr>
    );
  }

  if (view === "digital" && row.kind === "digital") {
    return (
      <tr className={getStripedRowClassName(index)}>
        <td className={cellClassName()}>{formatSalesRegisterDayMonth(row.date)}</td>
        <td className={cellClassName()}>{row.invoiceNo ?? "—"}</td>
        <td className={cellClassName()} title={row.customerLabel}>
          {row.customerLabel}
        </td>
        <td className={cellClassName()} title={row.itemsSummary}>
          {row.itemsSummary}
        </td>
        <td className={cellClassName()}>{tableMoney(row.totalAmount)}</td>
        <td className="px-3 py-2.5">
          <StatusPill {...salesRegisterPlainStatus(row.status)} />
        </td>
      </tr>
    );
  }

  if (view === "all") {
    const number =
      row.kind === "return"
        ? (row.creditNoteNumber ?? row.linkedInvoiceNo ?? "—")
        : row.kind === "receipt"
          ? row.invoiceNo
          : (row.invoiceNo ?? "—");
    const source =
      row.kind === "digital" ? "Digital" : formatSalesRegisterSourceLabel(row.source);
    const outstanding = row.kind === "return" ? "—" : tableMoney(row.totalOutstanding);
    const status =
      row.kind === "receipt" ? (
        <StatusPill {...salesRegisterManualStatus(row, todayIso)} />
      ) : row.kind === "return" ? (
        <StatusPill {...salesRegisterPlainStatus(row.paymentStatus)} />
      ) : (
        <StatusPill {...salesRegisterPlainStatus(row.status)} />
      );
    return (
      <tr className={getStripedRowClassName(index)}>
        <td className={cellClassName()}>{formatSalesRegisterDayMonth(row.date)}</td>
        <td className={cellClassName("font-medium text-[#0f2744]")}>
          <RegisterRecordNameLink onOpen={onOpenDrawer}>{number}</RegisterRecordNameLink>
        </td>
        <td className={cellClassName()}>{source}</td>
        <td className={cellClassName()} title={row.customerLabel}>
          {row.customerLabel}
        </td>
        <td className={cellClassName()}>
          {row.kind === "return" ? negativeMoney(row.totalAmount) : tableMoney(row.totalAmount)}
        </td>
        <td className={cellClassName()}>{outstanding}</td>
        <td className="px-3 py-2.5">{status}</td>
        <td className="px-3 py-2.5">
          {row.kind === "receipt" ? (
            <ReceiptActions
              row={row}
              view={view}
              viewOnly={viewOnly}
              printing={printingKey === row.rowKey}
              voidingId={voidingId}
              onReturn={onReturn}
              onRecordPayment={onRecordPayment}
              onPrint={() => onPrintReceipt(row)}
              onVoidLine={onVoidLine}
            />
          ) : (
            "—"
          )}
        </td>
      </tr>
    );
  }

  return null;
}

/**
 * Check payment for rows awaiting Paystack. Provided by the register; null when
 * the viewer may not collect Paystack payments.
 */
export type PaystackCheckContextValue = {
  onCheck: (row: SalesRegisterReceiptRow) => void;
  checkingRequestId: string | null;
};

export const PaystackCheckContext = createContext<PaystackCheckContextValue | null>(
  null,
);

function ReceiptActions({
  row,
  view,
  viewOnly,
  printing,
  voidingId,
  onReturn,
  onRecordPayment,
  onPrint,
  onVoidLine,
}: {
  row: SalesRegisterReceiptRow;
  view: SalesRegisterView;
  viewOnly: boolean;
  printing: boolean;
  voidingId: string | null;
  onReturn: (invoiceNo: string) => void;
  onRecordPayment: (entry: ProductSaleEntry) => void;
  onPrint: () => void;
  onVoidLine: (line: ProductSaleEntry) => void;
}) {
  const paystackCheck = useContext(PaystackCheckContext);
  const canCheckPayment =
    paystackCheck != null && Boolean(row.paystackPending && row.paystackRequestId);
  const checkingPayment =
    canCheckPayment && paystackCheck?.checkingRequestId === row.paystackRequestId;
  if (row.paystackPending && row.lines.length === 0) {
    if (!canCheckPayment || !paystackCheck) {
      return <span className="text-xs text-slate-500">Awaiting payment</span>;
    }
    return (
      <RegisterActionButton
        action={{
          key: "check-payment",
          label: checkingPayment ? "Checking…" : "Check payment",
          primary: true,
          disabled: checkingPayment,
          onClick: () => paystackCheck.onCheck(row),
        }}
      />
    );
  }
  const outstandingLines =
    row.totalOutstanding > 0.001
      ? row.lines.filter((line) => {
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
        })
      : [];
  const singlePaymentLine = outstandingLines.length === 1 ? outstandingLines[0] : null;
  const canReturn =
    !row.voided &&
    row.status !== "returned" &&
    row.lines.some((line) => !isProductSaleVoided(line));
  const singleLine = row.lines.length === 1 ? row.lines[0] : null;
  const singleLineCancelBlock = singleLine
    ? resolveProductSaleCancelBlockReason({
        saleQuantity: Number(singleLine.sale_quantity) || 0,
        returnedQuantity: singleLine.returnedQuantity ?? 0,
      })
    : "Cancel each sale line from the receipt detail drawer.";
  const singleLineFullyReturned =
    singleLine != null &&
    isSaleLineFullyReturned(
      Number(singleLine.sale_quantity) || 0,
      singleLine.returnedQuantity ?? 0,
    );
  const showPay =
    view !== "pos" &&
    row.source !== "pos" &&
    singlePaymentLine &&
    !viewOnly;
  const showReturn = canReturn && !viewOnly;
  const showCancel =
    Boolean(singleLine) &&
    !row.voided &&
    !viewOnly &&
    !singleLineFullyReturned &&
    singleLineCancelBlock == null;

  const actions: RegisterRowAction[] = [];
  if (showPay && singlePaymentLine) {
    actions.push({
      key: "pay",
      label: "Record payment",
      primary: true,
      onClick: () => onRecordPayment(singlePaymentLine),
    });
  }
  if (canCheckPayment && paystackCheck) {
    actions.push({
      key: "check-payment",
      label: checkingPayment ? "Checking…" : "Check payment",
      primary: true,
      disabled: checkingPayment,
      onClick: () => paystackCheck.onCheck(row),
    });
  }
  actions.push({
    key: "print",
    label: printing ? "Printing…" : "Print",
    disabled: printing,
    onClick: onPrint,
  });
  if (showReturn) {
    actions.push({
      key: "return",
      label: "Return",
      onClick: () => onReturn(row.invoiceNo),
    });
  }
  if (showCancel && singleLine) {
    const line = singleLine;
    actions.push({
      key: "cancel",
      label: voidingId === line.id ? "Cancelling…" : "Cancel sale",
      disabled: voidingId === line.id,
      onClick: () => onVoidLine(line),
    });
  }

  const visible = actions.length > 3 ? actions.filter((action) => action.primary) : actions;
  const overflow = actions.length > 3 ? actions.filter((action) => !action.primary) : [];

  return (
    <div className="flex flex-nowrap items-center gap-1.5 whitespace-nowrap">
      {visible.map((action) => (
        <RegisterActionButton key={action.key} action={action} />
      ))}
      {overflow.length > 0 ? <RegisterActionMenu items={overflow} /> : null}
    </div>
  );
}

type RegisterRowAction = {
  key: string;
  label: string;
  disabled?: boolean;
  primary?: boolean;
  onClick: () => void;
};

function RegisterActionButton({ action }: { action: RegisterRowAction }) {
  const className = action.primary
    ? "whitespace-nowrap rounded-md bg-[#0f2744] px-2 py-1 text-xs font-medium text-white hover:bg-[#1a3a5c] disabled:opacity-60"
    : "whitespace-nowrap rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-[#0f2744] hover:bg-slate-50 disabled:text-slate-400";
  return (
    <button
      type="button"
      className={className}
      disabled={action.disabled}
      onClick={action.onClick}
    >
      {action.label}
    </button>
  );
}

function RegisterActionMenu({ items }: { items: RegisterRowAction[] }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [position, setPosition] = useState({ top: 0, left: 0 });

  useEffect(() => {
    if (!open) {
      return;
    }
    function onKey(event: globalThis.KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <>
      <button
        ref={buttonRef}
        type="button"
        aria-label="More actions"
        aria-expanded={open}
        className="whitespace-nowrap rounded-md border border-slate-300 bg-white px-2 py-1 text-xs font-medium text-[#0f2744] hover:bg-slate-50"
        onClick={() => {
          const rect = buttonRef.current?.getBoundingClientRect();
          if (rect) {
            setPosition({ top: rect.bottom + 4, left: rect.right });
          }
          setOpen((current) => !current);
        }}
      >
        ⋯
      </button>
      {open
        ? createPortal(
            <>
              <button
                type="button"
                aria-label="Close actions"
                className="fixed inset-0 z-[60] cursor-default"
                onClick={() => setOpen(false)}
              />
              <div
                className="fixed z-[70] min-w-[9.5rem] -translate-x-full rounded-md border border-slate-200 bg-white py-1 shadow-lg"
                style={{ top: position.top, left: position.left }}
              >
                {items.map((action) => (
                  <button
                    key={action.key}
                    type="button"
                    disabled={action.disabled}
                    className="block w-full px-3 py-1.5 text-left text-xs font-medium text-[#0f2744] hover:bg-slate-50 disabled:text-slate-400"
                    onClick={() => {
                      setOpen(false);
                      action.onClick();
                    }}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            </>,
            document.body,
          )
        : null}
    </>
  );
}
