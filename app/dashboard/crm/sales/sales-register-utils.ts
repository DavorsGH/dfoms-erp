import {
  getIncomeCustomerDisplayName,
  resolveIncomeOutstandingBalance,
} from "@/app/dashboard/finance/income-register-utils";
import type { ClientEntry } from "@/app/dashboard/operations/clients-utils";
import { formatInventoryQuantity } from "@/app/dashboard/inventory/inventory-utils";
import type { HrEmployee } from "@/app/dashboard/hr-payroll/employee-utils";
import {
  getProductSaleProductLabel,
  isProductSaleVoided,
  type ProductSaleEntry,
} from "../product-sales-utils";
import {
  getCreditNoteNumberFromEntry,
  isProductSaleReturn,
} from "../product-return-utils";
import {
  creditNoteMetaFromEntry,
  formatReturnRowPaymentMethod,
  formatReturnRowPaymentStatus,
  type ReturnRefundSummary,
} from "./sales-register-return-display";
import {
  AWAITING_PAYMENT_LABEL,
  isManualSalePaystackSnapshot,
  type OpenPaystackPaymentRequest,
} from "@/utils/manual-sale-paystack";
import {
  isPosInvoiceNo,
  isProductSaleInvoiceNo,
  parsePosPaymentMethodFromNotes,
} from "./sales-log-receipt-utils";
import type { CrmSaleEntry } from "./sales-utils";

export type SalesRegisterSource = "pos" | "manual" | "digital";

export type SalesRegisterTypeFilter = "all" | "sales" | "returns";

export type SalesRegisterReceiptStatus =
  | "active"
  | "partly_returned"
  | "returned"
  | "voided";

export type SalesRegisterLine = ProductSaleEntry & {
  returnedQuantity: number;
};

export type SalesRegisterReceiptRow = {
  kind: "receipt";
  rowKey: string;
  invoiceNo: string;
  date: string;
  customerLabel: string;
  clientId: string | null;
  itemsSummary: string;
  totalAmount: number;
  totalReceived: number;
  totalOutstanding: number;
  paymentStatus: string;
  paymentMethod: string;
  source: SalesRegisterSource;
  salesRepLabel: string;
  status: SalesRegisterReceiptStatus;
  creditNoteNumbers: string[];
  dueDate: string | null;
  /** Timestamp when the sale stored a time; date-only otherwise. */
  saleTimestamp: string | null;
  lines: SalesRegisterLine[];
  businessUnitId: string | null;
  voided: boolean;
  /** Paystack link or popup is still open. No income lines means the sale is not created yet. */
  paystackPending?: boolean;
  /** Open payment request behind the awaiting row. Drives Check payment. */
  paystackRequestId?: string;
};

export type SalesRegisterReturnRow = {
  kind: "return";
  rowKey: string;
  creditNoteId: string | null;
  creditNoteNumber: string | null;
  linkedInvoiceNo: string | null;
  date: string;
  customerLabel: string;
  itemsSummary: string;
  totalAmount: number;
  paymentStatus: string;
  paymentMethod: string;
  source: SalesRegisterSource;
  salesRepLabel: string;
  lines: ProductSaleEntry[];
  businessUnitId: string | null;
  refundedCash: number;
  storeCreditIssued: number;
  storeCreditAvailable: number;
};

export type SalesRegisterDigitalRow = {
  kind: "digital";
  rowKey: string;
  date: string;
  invoiceNo: string | null;
  customerLabel: string;
  itemsSummary: string;
  totalAmount: number;
  totalReceived: number;
  totalOutstanding: number;
  paymentStatus: string | null;
  paymentMethod: string | null;
  source: "digital";
  salesRepLabel: string;
  status: string;
  webhook: CrmSaleEntry;
};

export type SalesRegisterRow =
  | SalesRegisterReceiptRow
  | SalesRegisterReturnRow
  | SalesRegisterDigitalRow;

export const SALES_REGISTER_SOURCE_FILTER_TOOLTIP_DIGITAL =
  "Digital (webhook) sales are not tagged to a business unit. They appear only when All Businesses is selected.";

export function resolveIncomeRegisterSource(
  invoiceNo: string | null | undefined,
): SalesRegisterSource {
  if (isPosInvoiceNo(invoiceNo)) {
    return "pos";
  }
  if (isProductSaleInvoiceNo(invoiceNo)) {
    return "manual";
  }
  const trimmed = invoiceNo?.trim() ?? "";
  if (/POS/i.test(trimmed)) {
    return "pos";
  }
  if (/PSI/i.test(trimmed)) {
    return "manual";
  }
  return "manual";
}

export function formatSalesRegisterSourceLabel(source: SalesRegisterSource): string {
  if (source === "pos") {
    return "POS";
  }
  if (source === "manual") {
    return "Manual";
  }
  return "Digital";
}

/** Channel names that were shown in the Method column but are not payment methods. */
const PAYMENT_METHOD_CHANNEL_LABELS = new Set([
  "product sale",
  "pos",
  "webhook",
]);

export function isRecordedPaymentMethod(
  value: string | null | undefined,
): boolean {
  const trimmed = value?.trim() ?? "";
  if (!trimmed || trimmed === "—") {
    return false;
  }
  return !PAYMENT_METHOD_CHANNEL_LABELS.has(trimmed.toLowerCase());
}

export function resolveStoredProductSalePaymentMethod(
  entry: Pick<ProductSaleEntry, "payment_method" | "notes" | "invoice_no">,
): string {
  const column = entry.payment_method?.trim() ?? "";
  if (isRecordedPaymentMethod(column)) {
    return column;
  }
  const fromNotes = parsePosPaymentMethodFromNotes(entry.notes);
  if (fromNotes !== "—") {
    return fromNotes;
  }
  return "—";
}

export function resolveReceiptPaymentMethod(
  lines: Pick<ProductSaleEntry, "id" | "payment_method" | "notes" | "invoice_no">[],
  paymentsByIncomeId?: Map<string, string[]>,
): string {
  const recorded: string[] = [];
  for (const line of lines) {
    for (const method of paymentsByIncomeId?.get(line.id) ?? []) {
      if (isRecordedPaymentMethod(method)) {
        recorded.push(method.trim());
      }
    }
    const stored = resolveStoredProductSalePaymentMethod(line);
    if (stored !== "—") {
      recorded.push(stored);
    }
  }
  const unique = [...new Set(recorded)];
  if (unique.length === 0) {
    return "—";
  }
  if (unique.length === 1) {
    return unique[0] ?? "—";
  }
  return unique.join(" · ");
}

export function formatCompactPaymentMethod(method: string | null | undefined): string {
  const trimmed = method?.trim() ?? "";
  if (!isRecordedPaymentMethod(trimmed)) {
    return "—";
  }
  if (/^mobile money$/i.test(trimmed)) {
    return "MoMo";
  }
  return trimmed;
}

export function formatRegisterItemsCompact(
  lines: Pick<ProductSaleEntry, "product" | "sale_quantity">[],
): string {
  if (lines.length === 0) {
    return "—";
  }
  const first = lines[0] as ProductSaleEntry;
  const label = first.product?.product_name?.trim() || getProductSaleProductLabel(first);
  if (lines.length === 1) {
    const qty = formatInventoryQuantity(Number(first.sale_quantity) || 0);
    return `${label} ×${qty}`;
  }
  return `${label} +${lines.length - 1}`;
}

export function formatSalesRegisterDayMonth(
  value: string | null | undefined,
): string {
  const trimmed = value?.trim().slice(0, 10) ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return "—";
  }
  const [year, month, day] = trimmed.split("-").map(Number);
  const date = new Date(Date.UTC(year, (month ?? 1) - 1, day ?? 1));
  return date.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    timeZone: "UTC",
  });
}

/** POS sales log Time cell. Date when no clock was stored; HH:MM when Today is on; "20 Oct · 16:23" when Today is off. */
export function formatSalesRegisterPosTime(
  timestamp: string | null | undefined,
  date: string | null | undefined,
  todayChipOn: boolean,
): string {
  const clock = formatSalesRegisterClock(timestamp);
  const day = formatSalesRegisterDayMonth(date);
  if (!clock) {
    return day;
  }
  if (!todayChipOn) {
    return day === "—" ? clock : `${day} · ${clock}`;
  }
  return clock;
}

export function formatSalesRegisterClock(
  timestamp: string | null | undefined,
): string | null {
  const trimmed = timestamp?.trim() ?? "";
  if (!trimmed || /^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    return null;
  }
  const date = new Date(trimmed);
  if (Number.isNaN(date.getTime())) {
    return null;
  }
  return date.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Africa/Accra",
  });
}

export type SalesRegisterStatusTone =
  | "paid"
  | "part"
  | "cancelled"
  | "returned"
  | "refunded"
  | "available"
  | "muted"
  | "overdue";

export function formatManualPaymentStatusLabel(input: {
  paymentStatus: string | null | undefined;
  totalReceived: number;
  totalOutstanding: number;
}): string {
  const raw = input.paymentStatus?.trim() ?? "";
  if (/^paid$/i.test(raw)) {
    return "Paid";
  }
  if (/partial|part[-\s]?paid/i.test(raw)) {
    return "Part-paid";
  }
  if (/pending|unpaid/i.test(raw)) {
    return "Unpaid";
  }
  if (input.totalOutstanding <= 0.001 && (input.totalReceived > 0.001 || raw === "")) {
    return input.totalReceived > 0.001 || /^paid$/i.test(raw) ? "Paid" : raw || "Paid";
  }
  if (input.totalReceived > 0.001 && input.totalOutstanding > 0.001) {
    return "Part-paid";
  }
  if (input.totalOutstanding > 0.001) {
    return "Unpaid";
  }
  return raw || "—";
}

export function salesRegisterManualStatus(
  row: SalesRegisterReceiptRow,
  todayIso: string,
): { label: string; tone: SalesRegisterStatusTone } {
  if (row.voided || row.status === "voided") {
    return { label: "Cancelled", tone: "cancelled" };
  }
  if (row.paystackPending) {
    return { label: "Awaiting payment", tone: "muted" };
  }
  if (row.status === "returned" || row.status === "partly_returned") {
    return { label: formatSalesRegisterStatusLabel(row), tone: "returned" };
  }
  const days = salesRegisterDaysOverdue(row.dueDate, row.totalOutstanding, todayIso);
  if (days > 0) {
    return {
      label: `Overdue ${days} ${days === 1 ? "day" : "days"}`,
      tone: "overdue",
    };
  }
  const label = formatManualPaymentStatusLabel(row);
  return { label, tone: paymentStatusTone(label) };
}

export function salesRegisterPosStatus(
  row: SalesRegisterReceiptRow,
): { label: string; tone: SalesRegisterStatusTone } {
  if (row.status === "voided") {
    return { label: "Cancelled", tone: "cancelled" };
  }
  if (row.status === "returned" || row.status === "partly_returned") {
    return { label: formatSalesRegisterStatusLabel(row), tone: "returned" };
  }
  const label = formatManualPaymentStatusLabel(row);
  return { label, tone: paymentStatusTone(label) };
}

function paymentStatusTone(label: string): SalesRegisterStatusTone {
  if (label === "Paid") {
    return "paid";
  }
  if (label === "Part-paid") {
    return "part";
  }
  return "muted";
}

/** Badge tone for credit-note and digital status text. Labels stay as computed. */
export function salesRegisterPlainStatus(label: string): {
  label: string;
  tone: SalesRegisterStatusTone;
} {
  const value = label.trim() || "—";
  if (/^paid$/i.test(value)) {
    return { label: value, tone: "paid" };
  }
  if (/part-?paid|partial|partly used/i.test(value)) {
    return { label: value, tone: "part" };
  }
  if (/cancel/i.test(value)) {
    return { label: value, tone: "cancelled" };
  }
  if (/refund/i.test(value)) {
    return { label: value, tone: "refunded" };
  }
  if (/^available$/i.test(value)) {
    return { label: value, tone: "available" };
  }
  if (/return/i.test(value)) {
    return { label: value, tone: "returned" };
  }
  return { label: value, tone: "muted" };
}

export function resolveSalesRepLabel(
  entry: Pick<ProductSaleEntry, "sales_rep_id">,
  employees: HrEmployee[],
): string {
  const id = entry.sales_rep_id?.trim();
  if (!id) {
    return "—";
  }
  const match = employees.find((employee) => employee.employee_id === id);
  return match?.full_name?.trim() || id;
}

export function buildReturnedQtyByIncomeId(
  rows: { source_income_register_id: string; quantity: number }[],
): Map<string, number> {
  const map = new Map<string, number>();
  for (const row of rows) {
    const id = String(row.source_income_register_id ?? "").trim();
    if (!id) {
      continue;
    }
    map.set(id, (map.get(id) ?? 0) + (Number(row.quantity) || 0));
  }
  return map;
}

function computeReceiptStatus(
  lines: ProductSaleEntry[],
  returnedQtyByIncomeId: Map<string, number>,
): SalesRegisterReceiptStatus {
  const activeLines = lines.filter((line) => !isProductSaleVoided(line));
  if (activeLines.length === 0) {
    return "voided";
  }
  if (lines.every((line) => isProductSaleVoided(line))) {
    return "voided";
  }

  let anyReturned = false;
  let allSellableFullyReturned = true;

  for (const line of activeLines) {
    const sold = Number(line.sale_quantity) || 0;
    const returned = returnedQtyByIncomeId.get(line.id) ?? 0;
    if (returned > 0.0001) {
      anyReturned = true;
    }
    if (returned + 0.0001 < sold) {
      allSellableFullyReturned = false;
    }
  }

  if (anyReturned && allSellableFullyReturned) {
    return "returned";
  }
  if (anyReturned) {
    return "partly_returned";
  }
  return "active";
}

function formatItemsSummaryFromLines(
  lines: Pick<ProductSaleEntry, "product" | "sale_quantity">[],
  labelForLine: (line: ProductSaleEntry) => string,
): string {
  if (lines.length === 0) {
    return "—";
  }
  const first = lines[0] as ProductSaleEntry;
  const firstLabel = labelForLine(first);
  const firstQty = formatInventoryQuantity(Number(first.sale_quantity) || 0);
  if (lines.length === 1) {
    return `${firstLabel} ×${firstQty}`;
  }
  return `${firstLabel} ×${firstQty} + ${lines.length - 1} more`;
}

function receiptDateFromLines(lines: ProductSaleEntry[]): string {
  const dates = lines
    .map((line) => line.date?.trim())
    .filter(Boolean)
    .sort();
  return dates[0] ?? lines[0]?.date ?? "";
}

export function buildSalesRegisterRows(args: {
  incomeEntries: ProductSaleEntry[];
  webhookSales: CrmSaleEntry[];
  returnedQtyByIncomeId: Map<string, number>;
  refundsByCreditNoteId: Map<string, ReturnRefundSummary[]>;
  employees: HrEmployee[];
  clients: { client_id: string; client_name: string }[];
  includeDigitalRows: boolean;
  getCustomerLabel: (entry: ProductSaleEntry) => string;
  paymentsByIncomeId?: Map<string, string[]>;
}): SalesRegisterRow[] {
  const saleLines = args.incomeEntries.filter(
    (entry) => !isProductSaleReturn(entry) && (Number(entry.amount) || 0) >= -0.001,
  );
  const returnLines = args.incomeEntries.filter(
    (entry) => isProductSaleReturn(entry) || (Number(entry.amount) || 0) < -0.001,
  );

  const receiptsByInvoice = new Map<string, ProductSaleEntry[]>();
  for (const line of saleLines) {
    const invoice = line.invoice_no?.trim();
    if (!invoice) {
      continue;
    }
    const bucket = receiptsByInvoice.get(invoice) ?? [];
    bucket.push(line);
    receiptsByInvoice.set(invoice, bucket);
  }

  const receiptRows: SalesRegisterReceiptRow[] = [];
  for (const [invoiceNo, lines] of receiptsByInvoice) {
    const sorted = [...lines].sort((a, b) => a.id.localeCompare(b.id));
    const first = sorted[0];
    if (!first) {
      continue;
    }

    const registerLines: SalesRegisterLine[] = sorted.map((line) => ({
      ...line,
      returnedQuantity: args.returnedQtyByIncomeId.get(line.id) ?? 0,
    }));

    const totalAmount = sorted.reduce(
      (sum, line) => sum + (Number(line.amount) || 0),
      0,
    );
    const totalReceived = sorted.reduce(
      (sum, line) => sum + (Number(line.amount_received) || 0),
      0,
    );

    const statusFromQty = computeReceiptStatus(sorted, args.returnedQtyByIncomeId);
    const linkedReturns = returnLines.filter(
      (line) => line.invoice_no?.trim() === invoiceNo && !isProductSaleVoided(line),
    );
    const returnedAmount = linkedReturns.reduce(
      (sum, line) => sum + Math.abs(Number(line.amount) || 0),
      0,
    );
    const creditNoteNumbers = [
      ...new Set(
        linkedReturns
          .map((line) => getCreditNoteNumberFromEntry(line))
          .filter((value): value is string => Boolean(value)),
      ),
    ];
    let status = statusFromQty;
    if (totalAmount > 0.001 && returnedAmount >= totalAmount - 0.001) {
      status = "returned";
    } else if (returnedAmount > 0.001 && status === "active") {
      status = "partly_returned";
    }

    const netAmount = Math.max(0, Math.round((totalAmount - returnedAmount) * 100) / 100);
    const totalOutstanding =
      status === "returned" || netAmount <= 0.001
        ? 0
        : Math.max(0, Math.round((netAmount - totalReceived) * 100) / 100);

    const paymentStatuses = [...new Set(sorted.map((line) => line.payment_status))];
    const paymentStatus =
      status === "returned"
        ? "Returned"
        : status === "partly_returned"
          ? "Partly returned"
          : paymentStatuses.length === 1
            ? (paymentStatuses[0] ?? "—")
            : "Mixed";

    receiptRows.push({
      kind: "receipt",
      rowKey: `receipt-${invoiceNo}`,
      invoiceNo,
      date: receiptDateFromLines(sorted),
      customerLabel: args.getCustomerLabel(first),
      clientId: first.client_id,
      itemsSummary: formatItemsSummaryFromLines(sorted, getProductSaleProductLabel),
      totalAmount: Math.round(totalAmount * 100) / 100,
      totalReceived: Math.round(totalReceived * 100) / 100,
      totalOutstanding,
      paymentStatus,
      paymentMethod: resolveReceiptPaymentMethod(sorted, args.paymentsByIncomeId),
      source: resolveIncomeRegisterSource(invoiceNo),
      salesRepLabel: resolveSalesRepLabel(first, args.employees),
      status,
      creditNoteNumbers,
      dueDate: sorted.find((line) => line.due_date?.trim())?.due_date?.trim() || null,
      saleTimestamp: sorted.find((line) => line.created_at?.trim())?.created_at?.trim() || null,
      lines: registerLines,
      businessUnitId: first.business_unit_id ?? null,
      voided: status === "voided",
    });
  }

  const returnsByCreditNote = new Map<string, ProductSaleEntry[]>();
  for (const line of returnLines) {
    const key = line.credit_note_id?.trim() || line.id;
    const bucket = returnsByCreditNote.get(key) ?? [];
    bucket.push(line);
    returnsByCreditNote.set(key, bucket);
  }

  const returnRows: SalesRegisterReturnRow[] = [];
  for (const [key, lines] of returnsByCreditNote) {
    const sorted = [...lines].sort((a, b) => a.id.localeCompare(b.id));
    const first = sorted[0];
    if (!first) {
      continue;
    }
    const totalAmount = sorted.reduce(
      (sum, line) => sum + (Number(line.amount) || 0),
      0,
    );
    const creditNoteId = first.credit_note_id?.trim() || key;
    const meta = creditNoteMetaFromEntry(first);
    const refunds = args.refundsByCreditNoteId.get(creditNoteId) ?? [];
    const issued = Math.abs(Math.round(totalAmount * 100) / 100);
    const mode = meta?.return_mode?.trim().toLowerCase() ?? "";
    const isRefund = mode === "refund_now";
    const creditTotal = meta ? Math.abs(meta.total_amount) || issued : issued;
    const refundedRecorded = meta?.refunded_amount ?? 0;
    const applied = meta?.applied_amount ?? 0;
    const available = Math.max(
      0,
      Math.round((creditTotal - refundedRecorded - applied) * 100) / 100,
    );
    returnRows.push({
      kind: "return",
      rowKey: `return-${key}`,
      creditNoteId: first.credit_note_id ?? null,
      creditNoteNumber: getCreditNoteNumberFromEntry(first),
      linkedInvoiceNo: first.invoice_no?.trim() || null,
      date: receiptDateFromLines(sorted),
      customerLabel: args.getCustomerLabel(first),
      itemsSummary: formatItemsSummaryFromLines(sorted, getProductSaleProductLabel),
      totalAmount: Math.round(totalAmount * 100) / 100,
      paymentStatus: formatReturnRowPaymentStatus(meta),
      paymentMethod: formatReturnRowPaymentMethod(meta, refunds),
      source: resolveIncomeRegisterSource(first.invoice_no),
      salesRepLabel: resolveSalesRepLabel(first, args.employees),
      lines: sorted,
      businessUnitId: first.business_unit_id ?? null,
      refundedCash: isRefund
        ? Math.round((refundedRecorded > 0 ? refundedRecorded : issued) * 100) / 100
        : 0,
      storeCreditIssued: isRefund ? 0 : creditTotal,
      storeCreditAvailable: isRefund ? 0 : available,
    });
  }

  const digitalRows: SalesRegisterDigitalRow[] = args.includeDigitalRows
    ? args.webhookSales.map((sale) => ({
        kind: "digital",
        rowKey: `digital-${sale.id}`,
        date: sale.sale_date,
        invoiceNo: sale.invoice_no,
        customerLabel: sale.customer_name,
        itemsSummary: sale.product_name,
        totalAmount: Number(sale.amount) || 0,
        totalReceived: Number(sale.amount) || 0,
        totalOutstanding: 0,
        paymentStatus: sale.payment_status,
        paymentMethod: sale.payment_method,
        source: "digital",
        salesRepLabel: "—",
        status: sale.payment_status ?? "—",
        webhook: sale,
      }))
    : [];

  return [...receiptRows, ...returnRows, ...digitalRows].sort((left, right) => {
    const leftDate = left.kind === "receipt" ? left.date : left.date;
    const rightDate = right.kind === "receipt" ? right.date : right.date;
    const dateCompare = String(rightDate).localeCompare(String(leftDate));
    if (dateCompare !== 0) {
      return dateCompare;
    }
    return left.rowKey.localeCompare(right.rowKey);
  });
}

export function formatSalesRegisterStatusLabel(
  row: SalesRegisterReceiptRow | SalesRegisterDigitalRow,
): string {
  if (row.kind === "digital") {
    return row.status;
  }
  if (row.status === "voided") {
    return "Cancelled";
  }
  if (row.status === "returned") {
    const note = row.creditNoteNumbers[0];
    return note ? `Returned · ${note}` : "Returned";
  }
  if (row.status === "partly_returned") {
    const note = row.creditNoteNumbers[0];
    return note ? `Partly returned · ${note}` : "Partly returned";
  }
  return "Active";
}

export function salesRegisterRowsForTotals(
  rows: SalesRegisterRow[],
): SalesRegisterRow[] {
  return rows.filter((row) => row.kind !== "digital");
}

export function computeSalesRegisterFooterTotals(rows: SalesRegisterRow[]): {
  grossSales: number;
  returns: number;
  netSales: number;
} {
  let grossSales = 0;
  let returns = 0;
  for (const row of rows) {
    if (row.kind === "receipt" && !row.voided) {
      grossSales += row.totalAmount;
    } else if (row.kind === "return") {
      returns += row.totalAmount;
    }
  }
  grossSales = Math.round(grossSales * 100) / 100;
  returns = Math.round(returns * 100) / 100;
  return {
    grossSales,
    returns,
    netSales: Math.round((grossSales + returns) * 100) / 100,
  };
}

export function countLinesWithOutstanding(
  row: SalesRegisterReceiptRow,
): number {
  return row.lines.filter((line) => {
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
  }).length;
}

export type SalesRegisterView = "pos" | "manual" | "returns" | "digital" | "all";

export const SALES_REGISTER_VIEWS: readonly SalesRegisterView[] = [
  "pos",
  "manual",
  "returns",
  "digital",
  "all",
];

export function salesRegisterDefaultView(role: string | null | undefined): SalesRegisterView {
  if (role === "sales_rep") {
    return "pos";
  }
  return "all";
}

export function rowMatchesSalesRegisterView(
  row: SalesRegisterRow,
  view: SalesRegisterView,
): boolean {
  if (view === "all") {
    return true;
  }
  if (view === "returns") {
    return row.kind === "return";
  }
  if (view === "digital") {
    return row.kind === "digital";
  }
  if (view === "pos") {
    return row.kind === "receipt" && row.source === "pos";
  }
  return row.kind === "receipt" && row.source === "manual";
}

export const SALES_REGISTER_CANCELLED_STATUS = "Cancelled";

export function salesRegisterRowIsCancelled(row: SalesRegisterRow): boolean {
  if (row.kind === "return") {
    return false;
  }
  if (row.kind === "receipt") {
    return row.voided || row.status === "voided";
  }
  return /cancel/i.test((row.status ?? "").trim());
}

/** Tab badges and the Sales card share this rule. */
export function salesRegisterRowIncludedInCounts(row: SalesRegisterRow): boolean {
  if (row.kind === "return") {
    return true;
  }
  if (salesRegisterRowIsCancelled(row)) {
    return false;
  }
  if (row.kind === "receipt" && row.paystackPending && row.lines.length === 0) {
    return false;
  }
  return true;
}

/** Cancelled sales stay in the table only when the Status filter is Cancelled. */
export function salesRegisterRowPassesCancelledFilter(
  row: SalesRegisterRow,
  statusChip: string,
): boolean {
  const cancelled = salesRegisterRowIsCancelled(row);
  if (statusChip === SALES_REGISTER_CANCELLED_STATUS) {
    return cancelled;
  }
  return !cancelled;
}

export function salesRegisterRowStatusLabel(
  row: SalesRegisterRow,
  todayIso: string,
  view: SalesRegisterView,
): string {
  if (row.kind === "return") {
    return row.paymentStatus;
  }
  if (row.kind === "digital") {
    return row.status;
  }
  if (row.paystackPending) {
    return AWAITING_PAYMENT_LABEL;
  }
  if (view === "pos") {
    return salesRegisterPosStatus(row).label;
  }
  return salesRegisterManualStatus(row, todayIso).label;
}

export function mergePaystackPendingRows(
  rows: SalesRegisterRow[],
  requests: OpenPaystackPaymentRequest[],
  clients: ClientEntry[] = [],
): SalesRegisterRow[] {
  const open = requests.filter(
    (request) => request.status === "pending" || request.status === "sent",
  );
  const pendingInvoices = new Map<string, string>();
  for (const request of open) {
    const invoice = request.invoice_no.trim();
    if (request.income_ids.length > 0 && invoice && !pendingInvoices.has(invoice)) {
      pendingInvoices.set(invoice, request.id);
    }
  }
  const flagged = rows.map((row) => {
    if (
      row.kind === "receipt" &&
      row.source === "manual" &&
      pendingInvoices.has(row.invoiceNo)
    ) {
      return {
        ...row,
        paystackPending: true,
        paystackRequestId: pendingInvoices.get(row.invoiceNo),
      };
    }
    return row;
  });

  const extras: SalesRegisterReceiptRow[] = [];
  for (const request of open) {
    if (request.income_ids.length > 0) {
      continue;
    }
    const snapshot = request.cart_snapshot;
    if (
      !isManualSalePaystackSnapshot({
        incomeIds: request.income_ids,
        invoiceNo: request.invoice_no,
        snapshot,
      }) ||
      !snapshot
    ) {
      continue;
    }
    const line = snapshot.lines?.[0];
    const quantity = Number(line?.quantity) || 0;
    const unitPrice = Number(line?.unitPrice) || 0;
    const total =
      Math.round((Number(request.amount_requested) || quantity * unitPrice) * 100) /
      100;
    const productName = line?.productName?.trim() || "Product";
    extras.push({
      kind: "receipt",
      rowKey: `paystack-${request.id}`,
      invoiceNo:
        request.invoice_no.startsWith("LINK-PENDING-") ||
        request.invoice_no.startsWith("MOMO-PENDING-")
          ? "Pending link"
          : request.invoice_no,
      date: (request.created_at || snapshot.saleDate || "").slice(0, 10),
      customerLabel: getIncomeCustomerDisplayName(
        {
          client_id: snapshot.clientId ?? null,
          customer_name: snapshot.customerName ?? null,
          client: null,
        },
        clients,
      ),
      clientId: snapshot.clientId ?? null,
      itemsSummary: productName,
      totalAmount: Math.round((quantity * unitPrice || total) * 100) / 100,
      totalReceived: 0,
      totalOutstanding: Math.round((quantity * unitPrice || total) * 100) / 100,
      paymentStatus: AWAITING_PAYMENT_LABEL,
      paymentMethod:
        snapshot.manualSale?.paymentMethod || request.payment_method,
      source: "manual",
      salesRepLabel: "—",
      status: "active",
      creditNoteNumbers: [],
      dueDate: snapshot.dueDate ?? null,
      saleTimestamp: request.created_at || null,
      lines: [],
      businessUnitId: snapshot.businessUnitId ?? null,
      voided: false,
      paystackPending: true,
      paystackRequestId: request.id,
    });
  }

  return [...extras, ...flagged];
}

export function withCancelledStatusOption(options: string[]): string[] {
  if (options.includes(SALES_REGISTER_CANCELLED_STATUS)) {
    return options;
  }
  return [...options, SALES_REGISTER_CANCELLED_STATUS].sort((left, right) =>
    left.localeCompare(right),
  );
}

export function salesRegisterDaysOverdue(
  dueDate: string | null | undefined,
  outstanding: number,
  todayIso: string,
): number {
  if (outstanding <= 0.001 || !dueDate?.trim()) {
    return 0;
  }
  const due = dueDate.slice(0, 10);
  if (due >= todayIso) {
    return 0;
  }
  const elapsed =
    Date.parse(`${todayIso}T00:00:00Z`) - Date.parse(`${due}T00:00:00Z`);
  if (!Number.isFinite(elapsed) || elapsed <= 0) {
    return 0;
  }
  return Math.round(elapsed / 86_400_000);
}
