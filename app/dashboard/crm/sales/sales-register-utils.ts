import { resolveIncomeOutstandingBalance } from "@/app/dashboard/finance/income-register-utils";
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
  lines: SalesRegisterLine[];
  businessUnitId: string | null;
  voided: boolean;
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

export function resolveStoredProductSalePaymentMethod(
  entry: Pick<ProductSaleEntry, "payment_method" | "notes" | "invoice_no">,
): string {
  const column = entry.payment_method?.trim();
  if (column) {
    return column;
  }
  const fromNotes = parsePosPaymentMethodFromNotes(entry.notes);
  if (fromNotes !== "—") {
    return fromNotes;
  }
  const channel = resolveIncomeRegisterSource(entry.invoice_no);
  if (channel === "pos") {
    return "POS";
  }
  if (isProductSaleInvoiceNo(entry.invoice_no)) {
    return "Product Sale";
  }
  return "—";
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
}): SalesRegisterRow[] {
  const saleLines = args.incomeEntries.filter((entry) => !isProductSaleReturn(entry));
  const returnLines = args.incomeEntries.filter((entry) => isProductSaleReturn(entry));

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
    const totalOutstanding = sorted.reduce(
      (sum, line) =>
        sum +
        resolveIncomeOutstandingBalance({
          amount: Number(line.amount) || 0,
          amount_received: Number(line.amount_received) || 0,
          outstanding_balance: line.outstanding_balance,
        }),
      0,
    );

    const status = computeReceiptStatus(sorted, args.returnedQtyByIncomeId);
    const paymentStatuses = [...new Set(sorted.map((line) => line.payment_status))];
    const paymentStatus =
      paymentStatuses.length === 1 ? (paymentStatuses[0] ?? "—") : "Mixed";

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
      totalOutstanding: Math.round(totalOutstanding * 100) / 100,
      paymentStatus,
      paymentMethod: resolveStoredProductSalePaymentMethod(first),
      source: resolveIncomeRegisterSource(invoiceNo),
      salesRepLabel: resolveSalesRepLabel(first, args.employees),
      status,
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
    return "Returned";
  }
  if (row.status === "partly_returned") {
    return "Partly returned";
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
