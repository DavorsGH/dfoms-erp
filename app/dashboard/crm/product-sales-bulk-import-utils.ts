import * as XLSX from "xlsx";
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

function isBlankImportRow(row: unknown[]): boolean {
  const meaningfulIndexes = [0, 1, 2, 3, 4, 5, 6, 7, 8];
  return meaningfulIndexes.every(
    (index) => String(row[index] ?? "").trim() === "",
  );
}

function isHeaderRow(row: unknown[]): boolean {
  const dateHeader = String(row[0] ?? "")
    .trim()
    .toLowerCase();
  const invoiceHeader = String(row[1] ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

  return dateHeader === "date" && invoiceHeader === "invoice_no";
}

function rowToRawImportRow(
  row: unknown[],
  rowNumber: number,
): RawProductSaleImportRow {
  return {
    rowNumber,
    dateRaw: row[0],
    invoiceNoRaw: row[1],
    customerIdRaw: row[2],
    customerNameRaw: row[3],
    productCodeRaw: row[4],
    quantityRaw: row[5],
    unitPriceRaw: row[6],
    amountReceivedRaw: row[7],
    paymentStatusRaw: row[8],
    dueDateRaw: row[9],
    notesRaw: row[10],
  };
}

export function parseProductSaleSpreadsheetRows(
  rows: unknown[][],
): RawProductSaleImportRow[] {
  const parsedRows: RawProductSaleImportRow[] = [];

  rows.forEach((row, index) => {
    const rowNumber = index + 1;

    if (!Array.isArray(row) || isBlankImportRow(row)) {
      return;
    }

    if (index === 0 && isHeaderRow(row)) {
      return;
    }

    parsedRows.push(rowToRawImportRow(row, rowNumber));
  });

  return parsedRows;
}

export async function readProductSaleImportFile(
  file: File,
): Promise<RawProductSaleImportRow[]> {
  const extension = file.name.split(".").pop()?.toLowerCase();

  if (extension === "csv") {
    const text = await file.text();
    const workbook = XLSX.read(text, { type: "string" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: "",
      raw: false,
    }) as unknown[][];

    return parseProductSaleSpreadsheetRows(rows);
  }

  if (extension === "xlsx") {
    const buffer = await file.arrayBuffer();
    const workbook = XLSX.read(buffer, { type: "array", cellDates: true });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      defval: "",
      raw: true,
    }) as unknown[][];

    return parseProductSaleSpreadsheetRows(rows);
  }

  throw new Error("Unsupported file type. Upload a .csv or .xlsx file.");
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
