import { readSpreadsheetFileToRows } from "@/lib/spreadsheet/safe-spreadsheet-parse";
import { listSpreadsheetLayoutRecords } from "@/lib/spreadsheet/spreadsheet-layout-parse";
import { pickSpreadsheetRecordValue } from "@/lib/spreadsheet/spreadsheet-record-access";
import type { CrmProductEntry } from "./products-utils";

export type ProductImportInsertPayload = {
  name: string;
  product_type: string;
  category: string | null;
  unit_price: number;
  billing_cycle: string | null;
  is_active: boolean;
};

export type RawProductImportRow = {
  rowNumber: number;
  nameRaw: unknown;
  productTypeRaw: unknown;
  categoryRaw: unknown;
  unitPriceRaw: unknown;
  billingCycleRaw: unknown;
  isActiveRaw: unknown;
};

export type ImportRowCategory = "ready" | "duplicate" | "error";

export type ClassifiedProductImportRow = {
  rowNumber: number;
  category: ImportRowCategory;
  message: string;
  name: string;
  productCategory: string;
  payload: ProductImportInsertPayload | null;
};

export type ProductImportPreview = {
  ready: ClassifiedProductImportRow[];
  duplicates: ClassifiedProductImportRow[];
  errors: ClassifiedProductImportRow[];
};

const VALID_PRODUCT_TYPES = new Set([
  "service",
  "digital_subscription",
  "physical_good",
]);

const VALID_BILLING_CYCLES = new Set(["one_time", "monthly", "yearly"]);

function normalizeOptionalText(value: unknown): string | null {
  const trimmed = String(value ?? "").trim();
  return trimmed ? trimmed : null;
}

function normalizeProductType(value: unknown): string | null {
  const trimmed = String(value ?? "").trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  const normalized = trimmed.replace(/\s+/g, "_");
  return VALID_PRODUCT_TYPES.has(normalized) ? normalized : null;
}

function parseImportUnitPrice(value: unknown): number | null {
  if (value === null || value === undefined) {
    return null;
  }

  const trimmed = String(value).trim();
  if (!trimmed) {
    return null;
  }

  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed < 0) {
    return null;
  }

  return parsed;
}

function parseImportBillingCycle(value: unknown): {
  value: string | null;
  invalid: boolean;
} {
  const trimmed = String(value ?? "").trim().toLowerCase();
  if (!trimmed) {
    return { value: null, invalid: false };
  }

  const normalized = trimmed.replace(/\s+/g, "_");
  if (VALID_BILLING_CYCLES.has(normalized)) {
    return { value: normalized, invalid: false };
  }

  return { value: null, invalid: true };
}

export function parseImportBoolean(value: unknown): boolean {
  const trimmed = String(value ?? "").trim().toLowerCase();
  if (!trimmed) {
    return true;
  }

  if (["true", "yes", "1"].includes(trimmed)) {
    return true;
  }

  if (["false", "no", "0"].includes(trimmed)) {
    return false;
  }

  return true;
}

function isInvalidActiveValue(value: unknown): boolean {
  const trimmed = String(value ?? "").trim().toLowerCase();
  if (!trimmed) {
    return false;
  }

  return !["true", "false", "yes", "no", "1", "0"].includes(trimmed);
}

export function parseProductLayoutRecords(
  records: Array<{ rowNumber: number; record: Record<string, unknown> }>,
): RawProductImportRow[] {
  return records.map(({ rowNumber, record }) => ({
    rowNumber,
    nameRaw: pickSpreadsheetRecordValue(record, ["Name", "name", "Product Name"]),
    productTypeRaw: pickSpreadsheetRecordValue(record, [
      "Product Type",
      "product_type",
      "Product type",
    ]),
    categoryRaw: pickSpreadsheetRecordValue(record, ["Category", "category"]),
    unitPriceRaw: pickSpreadsheetRecordValue(record, [
      "Unit Price",
      "unit_price",
      "Unit price",
    ]),
    billingCycleRaw: pickSpreadsheetRecordValue(record, [
      "Billing Cycle",
      "billing_cycle",
      "Billing cycle",
    ]),
    isActiveRaw: pickSpreadsheetRecordValue(record, [
      "Is Active",
      "is_active",
      "Active",
    ]),
  }));
}

export async function readProductImportFile(
  file: File,
  options: { sheetName?: string; headerRowIndex?: number } = {},
): Promise<RawProductImportRow[]> {
  try {
    const rows = await readSpreadsheetFileToRows(file, {
      sheetName: options.sheetName,
      rawCells: true,
    });
    const { records } = listSpreadsheetLayoutRecords(rows, {
      headerRowIndex: options.headerRowIndex,
    });
    return parseProductLayoutRecords(records);
  } catch (error) {
    throw error instanceof Error
      ? error
      : new Error("Could not read this spreadsheet. Check the file format and try again.");
  }
}

function buildProductPayload(
  raw: RawProductImportRow,
): ProductImportInsertPayload | null {
  const name = String(raw.nameRaw ?? "").trim();
  const productType = normalizeProductType(raw.productTypeRaw);
  const unitPrice = parseImportUnitPrice(raw.unitPriceRaw);
  const billingCycle = parseImportBillingCycle(raw.billingCycleRaw);

  if (!name || !productType || unitPrice === null || billingCycle.invalid) {
    return null;
  }

  return {
    name,
    product_type: productType,
    category: normalizeOptionalText(raw.categoryRaw),
    unit_price: unitPrice,
    billing_cycle: billingCycle.value,
    is_active: parseImportBoolean(raw.isActiveRaw),
  };
}

export function productDuplicateKey(
  name: string,
  category: string | null,
): string {
  return `${name.trim().toLowerCase()}|${(category ?? "").trim().toLowerCase()}`;
}

export function classifyProductImportRows(
  rawRows: RawProductImportRow[],
  existingProducts: CrmProductEntry[],
): ProductImportPreview {
  const existingKeys = new Set(
    existingProducts.map((product) =>
      productDuplicateKey(product.name, product.category),
    ),
  );
  const seenImportKeys = new Set<string>();

  const ready: ClassifiedProductImportRow[] = [];
  const duplicates: ClassifiedProductImportRow[] = [];
  const errors: ClassifiedProductImportRow[] = [];

  for (const raw of rawRows) {
    const name = String(raw.nameRaw ?? "").trim();
    const categoryLabel =
      normalizeOptionalText(raw.categoryRaw) ?? "(no category)";
    const productType = normalizeProductType(raw.productTypeRaw);
    const unitPrice = parseImportUnitPrice(raw.unitPriceRaw);
    const billingCycle = parseImportBillingCycle(raw.billingCycleRaw);

    if (!name) {
      errors.push({
        rowNumber: raw.rowNumber,
        category: "error",
        message: "Name is required",
        name: "—",
        productCategory: categoryLabel,
        payload: null,
      });
      continue;
    }

    if (!productType) {
      errors.push({
        rowNumber: raw.rowNumber,
        category: "error",
        message: `Invalid product_type "${String(raw.productTypeRaw ?? "").trim()}" — must be service, digital_subscription, or physical_good`,
        name,
        productCategory: categoryLabel,
        payload: null,
      });
      continue;
    }

    if (unitPrice === null) {
      errors.push({
        rowNumber: raw.rowNumber,
        category: "error",
        message: "Unit price is required and must be a valid number zero or greater",
        name,
        productCategory: categoryLabel,
        payload: null,
      });
      continue;
    }

    if (billingCycle.invalid) {
      errors.push({
        rowNumber: raw.rowNumber,
        category: "error",
        message: `Invalid billing_cycle "${String(raw.billingCycleRaw ?? "").trim()}" — must be one_time, monthly, yearly, or blank`,
        name,
        productCategory: categoryLabel,
        payload: null,
      });
      continue;
    }

    if (isInvalidActiveValue(raw.isActiveRaw)) {
      errors.push({
        rowNumber: raw.rowNumber,
        category: "error",
        message: `Invalid is_active "${String(raw.isActiveRaw ?? "").trim()}" — use true/false/yes/no/1/0 or leave blank`,
        name,
        productCategory: categoryLabel,
        payload: null,
      });
      continue;
    }

    const payload = buildProductPayload(raw);
    if (!payload) {
      errors.push({
        rowNumber: raw.rowNumber,
        category: "error",
        message: "Invalid product values",
        name,
        productCategory: categoryLabel,
        payload: null,
      });
      continue;
    }

    const key = productDuplicateKey(payload.name, payload.category);
    if (existingKeys.has(key) || seenImportKeys.has(key)) {
      duplicates.push({
        rowNumber: raw.rowNumber,
        category: "duplicate",
        message: existingKeys.has(key)
          ? "Already exists in product catalog, will be skipped"
          : "Duplicate row in file, will be skipped",
        name,
        productCategory: categoryLabel,
        payload,
      });
      continue;
    }

    seenImportKeys.add(key);
    ready.push({
      rowNumber: raw.rowNumber,
      category: "ready",
      message: "Ready to import",
      name,
      productCategory: categoryLabel,
      payload,
    });
  }

  return { ready, duplicates, errors };
}

export function summarizeProductImportPreview(
  preview: ProductImportPreview,
): string {
  return `${preview.ready.length} row${preview.ready.length === 1 ? "" : "s"} ready to import, ${preview.duplicates.length} row${preview.duplicates.length === 1 ? "" : "s"} will be skipped (duplicates), ${preview.errors.length} row${preview.errors.length === 1 ? "" : "s"} have errors (invalid name, product type, price, or billing cycle)`;
}
