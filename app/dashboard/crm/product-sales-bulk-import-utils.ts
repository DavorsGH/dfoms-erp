import { readSpreadsheetFileToRows } from "@/lib/spreadsheet/safe-spreadsheet-parse";
import { listSpreadsheetLayoutRecords } from "@/lib/spreadsheet/spreadsheet-layout-parse";
import { pickSpreadsheetRecordValue } from "@/lib/spreadsheet/spreadsheet-record-access";
import { parseImportDate } from "../hr-payroll/attendance-bulk-import-utils";
import type { FinishedProductRecord } from "../inventory/finished-products-utils";
import type { ClientEntry } from "../operations/clients-utils";

export type ProductSaleImportRpcPayload = {
  p_date: string;
  p_invoice_no: string;
  p_client_id: string | null;
  p_customer_name: string | null;
  p_product_id: string;
  p_quantity: number;
  p_unit_price: number;
  p_amount_received: number;
  p_payment_status: string;
  p_due_date: string;
  p_description: null;
  p_notes: string | null;
};

export type RawProductSaleImportRow = {
  rowNumber: number;
  dateRaw: unknown;
  invoiceNoRaw: unknown;
  customerIdRaw: unknown;
  customerNameRaw: unknown;
  productCodeRaw: unknown;
  quantityRaw: unknown;
  unitPriceRaw: unknown;
  amountReceivedRaw: unknown;
  paymentStatusRaw: unknown;
  dueDateRaw: unknown;
  notesRaw: unknown;
};

export type ClassifiedProductSaleImportRow = {
  rowNumber: number;
  category: "ready" | "error";
  message: string;
  invoiceNo: string;
  dateLabel: string;
  productCode: string;
  payload: ProductSaleImportRpcPayload | null;
};

export type ProductSaleImportPreview = {
  ready: ClassifiedProductSaleImportRow[];
  errors: ClassifiedProductSaleImportRow[];
};

export type ProductSaleImportRowResult = {
  rowNumber: number;
  invoiceNo: string;
  success: boolean;
  incomeId?: string;
  errorMessage?: string;
};

export type ProductSaleImportRunSummary = {
  succeeded: ProductSaleImportRowResult[];
  failed: ProductSaleImportRowResult[];
};

type RpcInvokeResult = {
  data: string | null;
  error: { message: string } | null;
};

function normalizeOptionalText(value: unknown): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed : null;
}

function parsePositiveNumber(value: unknown): number | null {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function parseNonNegativeNumber(value: unknown): number | null {
  const trimmed = String(value ?? "").trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
}

export function parseProductSaleLayoutRecords(
  records: Array<{ rowNumber: number; record: Record<string, unknown> }>,
): RawProductSaleImportRow[] {
  return records.map(({ rowNumber, record }) => ({
    rowNumber,
    dateRaw: pickSpreadsheetRecordValue(record, ["Date", "date"]),
    invoiceNoRaw: pickSpreadsheetRecordValue(record, [
      "Invoice No",
      "invoice_no",
      "Invoice Number",
    ]),
    customerIdRaw: pickSpreadsheetRecordValue(record, [
      "Customer ID",
      "customer_id",
      "Client ID",
    ]),
    customerNameRaw: pickSpreadsheetRecordValue(record, [
      "Customer Name",
      "customer_name",
      "Client Name",
    ]),
    productCodeRaw: pickSpreadsheetRecordValue(record, [
      "Product Code",
      "product_code",
    ]),
    quantityRaw: pickSpreadsheetRecordValue(record, ["Quantity", "quantity"]),
    unitPriceRaw: pickSpreadsheetRecordValue(record, [
      "Unit Price",
      "unit_price",
    ]),
    amountReceivedRaw: pickSpreadsheetRecordValue(record, [
      "Amount Received",
      "amount_received",
    ]),
    paymentStatusRaw: pickSpreadsheetRecordValue(record, [
      "Payment Status",
      "payment_status",
    ]),
    dueDateRaw: pickSpreadsheetRecordValue(record, ["Due Date", "due_date"]),
    notesRaw: pickSpreadsheetRecordValue(record, ["Notes", "notes"]),
  }));
}

export async function readProductSaleImportFile(
  file: File,
  options: { sheetName?: string; headerRowIndex?: number } = {},
): Promise<RawProductSaleImportRow[]> {
  try {
    const rows = await readSpreadsheetFileToRows(file, {
      sheetName: options.sheetName,
      rawCells: true,
    });
    const { records } = listSpreadsheetLayoutRecords(rows, {
      headerRowIndex: options.headerRowIndex,
    });
    return parseProductSaleLayoutRecords(records);
  } catch (error) {
    throw error instanceof Error
      ? error
      : new Error("Could not read this spreadsheet. Check the file format and try again.");
  }
}

function buildProductByCodeMap(
  finishedProducts: FinishedProductRecord[],
): Map<string, FinishedProductRecord> {
  const map = new Map<string, FinishedProductRecord>();

  for (const product of finishedProducts) {
    const code = product.product_code.trim();
    if (code) {
      map.set(code.toLowerCase(), product);
    }
  }

  return map;
}

function buildClientIdSet(clients: ClientEntry[]): Set<string> {
  return new Set(clients.map((client) => client.client_id.trim()));
}

function buildProductSalePayload(
  raw: RawProductSaleImportRow,
  productId: string,
  clientId: string | null,
  customerName: string | null,
): ProductSaleImportRpcPayload | null {
  const date = parseImportDate(raw.dateRaw);
  const invoiceNo = String(raw.invoiceNoRaw ?? "").trim();
  const quantity = parsePositiveNumber(raw.quantityRaw);
  const unitPrice = parseNonNegativeNumber(raw.unitPriceRaw);
  const amountReceived = parseNonNegativeNumber(raw.amountReceivedRaw);
  const paymentStatus = String(raw.paymentStatusRaw ?? "").trim();
  const dueDate = parseImportDate(raw.dueDateRaw) ?? date;

  if (
    !date ||
    !invoiceNo ||
    quantity === null ||
    unitPrice === null ||
    amountReceived === null ||
    !paymentStatus ||
    !dueDate
  ) {
    return null;
  }

  return {
    p_date: date,
    p_invoice_no: invoiceNo,
    p_client_id: clientId,
    p_customer_name: clientId ? null : customerName,
    p_product_id: productId,
    p_quantity: quantity,
    p_unit_price: unitPrice,
    p_amount_received: amountReceived,
    p_payment_status: paymentStatus,
    p_due_date: dueDate,
    p_description: null,
    p_notes: normalizeOptionalText(raw.notesRaw),
  };
}

export function classifyProductSaleImportRows(
  rawRows: RawProductSaleImportRow[],
  clients: ClientEntry[],
  finishedProducts: FinishedProductRecord[],
): ProductSaleImportPreview {
  const productByCode = buildProductByCodeMap(finishedProducts);
  const clientIds = buildClientIdSet(clients);

  const ready: ClassifiedProductSaleImportRow[] = [];
  const errors: ClassifiedProductSaleImportRow[] = [];

  for (const raw of rawRows) {
    const invoiceNo = String(raw.invoiceNoRaw ?? "").trim() || "—";
    const date = parseImportDate(raw.dateRaw);
    const dateLabel =
      date ?? (String(raw.dateRaw ?? "").trim() || "Invalid date");
    const customerId = normalizeOptionalText(raw.customerIdRaw);
    const customerName = normalizeOptionalText(raw.customerNameRaw);
    const productCode = String(raw.productCodeRaw ?? "").trim() || "—";
    const quantity = parsePositiveNumber(raw.quantityRaw);
    const unitPrice = parseNonNegativeNumber(raw.unitPriceRaw);
    const amountReceived = parseNonNegativeNumber(raw.amountReceivedRaw);
    const paymentStatus = String(raw.paymentStatusRaw ?? "").trim();
    const product = productCode
      ? productByCode.get(productCode.toLowerCase())
      : undefined;

    if (!date) {
      errors.push({
        rowNumber: raw.rowNumber,
        category: "error",
        message: `Invalid or missing date "${String(raw.dateRaw ?? "").trim()}"`,
        invoiceNo,
        dateLabel,
        productCode,
        payload: null,
      });
      continue;
    }

    if (!invoiceNo || invoiceNo === "—") {
      errors.push({
        rowNumber: raw.rowNumber,
        category: "error",
        message: "Invoice number is required",
        invoiceNo: "—",
        dateLabel,
        productCode,
        payload: null,
      });
      continue;
    }

    if (!product) {
      errors.push({
        rowNumber: raw.rowNumber,
        category: "error",
        message: `Unknown product_code "${productCode}"`,
        invoiceNo,
        dateLabel,
        productCode,
        payload: null,
      });
      continue;
    }

    if (!customerId && !customerName) {
      errors.push({
        rowNumber: raw.rowNumber,
        category: "error",
        message: "Provide customer_id or customer_name",
        invoiceNo,
        dateLabel,
        productCode,
        payload: null,
      });
      continue;
    }

    if (customerId && !clientIds.has(customerId)) {
      errors.push({
        rowNumber: raw.rowNumber,
        category: "error",
        message: `Unknown customer_id "${customerId}"`,
        invoiceNo,
        dateLabel,
        productCode,
        payload: null,
      });
      continue;
    }

    if (quantity === null) {
      errors.push({
        rowNumber: raw.rowNumber,
        category: "error",
        message: "Quantity must be a number greater than zero",
        invoiceNo,
        dateLabel,
        productCode,
        payload: null,
      });
      continue;
    }

    if (unitPrice === null) {
      errors.push({
        rowNumber: raw.rowNumber,
        category: "error",
        message: "Unit price must be a valid number zero or greater",
        invoiceNo,
        dateLabel,
        productCode,
        payload: null,
      });
      continue;
    }

    if (amountReceived === null) {
      errors.push({
        rowNumber: raw.rowNumber,
        category: "error",
        message: "Amount received must be a valid number zero or greater",
        invoiceNo,
        dateLabel,
        productCode,
        payload: null,
      });
      continue;
    }

    if (!paymentStatus) {
      errors.push({
        rowNumber: raw.rowNumber,
        category: "error",
        message: "Payment status is required",
        invoiceNo,
        dateLabel,
        productCode,
        payload: null,
      });
      continue;
    }

    const payload = buildProductSalePayload(
      raw,
      product.id,
      customerId,
      customerName,
    );

    if (!payload) {
      errors.push({
        rowNumber: raw.rowNumber,
        category: "error",
        message: "Invalid sale values",
        invoiceNo,
        dateLabel,
        productCode,
        payload: null,
      });
      continue;
    }

    ready.push({
      rowNumber: raw.rowNumber,
      category: "ready",
      message: "Ready to import",
      invoiceNo,
      dateLabel,
      productCode,
      payload,
    });
  }

  return { ready, errors };
}

export function summarizeProductSaleImportPreview(
  preview: ProductSaleImportPreview,
): string {
  return `${preview.ready.length} row${preview.ready.length === 1 ? "" : "s"} ready to import, ${preview.errors.length} row${preview.errors.length === 1 ? "" : "s"} have errors (fix before import)`;
}

export function summarizeProductSaleImportRun(
  summary: ProductSaleImportRunSummary,
): string {
  return `${summary.succeeded.length} sale${summary.succeeded.length === 1 ? "" : "s"} imported successfully, ${summary.failed.length} failed`;
}

export async function runProductSaleImportSequentially(
  readyRows: ClassifiedProductSaleImportRow[],
  invokeRpc: (
    payload: ProductSaleImportRpcPayload,
  ) => Promise<RpcInvokeResult>,
): Promise<ProductSaleImportRunSummary> {
  const succeeded: ProductSaleImportRowResult[] = [];
  const failed: ProductSaleImportRowResult[] = [];

  for (const row of readyRows) {
    if (!row.payload) {
      continue;
    }

    const { data, error } = await invokeRpc(row.payload);

    if (error) {
      failed.push({
        rowNumber: row.rowNumber,
        invoiceNo: row.invoiceNo,
        success: false,
        errorMessage: error.message,
      });
      continue;
    }

    succeeded.push({
      rowNumber: row.rowNumber,
      invoiceNo: row.invoiceNo,
      success: true,
      incomeId: data ?? undefined,
    });
  }

  return { succeeded, failed };
}
