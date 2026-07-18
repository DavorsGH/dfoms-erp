import * as XLSX from "xlsx";
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

function isBlankImportRow(row: unknown[]): boolean {
  const meaningfulIndexes = [0, 1, 2, 3, 4, 5];
  return meaningfulIndexes.every(
    (index) => String(row[index] ?? "").trim() === "",
  );
}

function isHeaderRow(row: unknown[]): boolean {
  const nameHeader = String(row[0] ?? "")
    .trim()
    .toLowerCase();
  const typeHeader = String(row[1] ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");

  return (
    nameHeader === "name" &&
    (typeHeader === "product_type" || typeHeader === "product type")
  );
}

function rowToRawImportRow(
  row: unknown[],
  rowNumber: number,
): RawProductImportRow {
  return {
    rowNumber,
    nameRaw: row[0],
    productTypeRaw: row[1],
    categoryRaw: row[2],
    unitPriceRaw: row[3],
    billingCycleRaw: row[4],
    isActiveRaw: row[5],
  };
}

export function parseProductSpreadsheetRows(
  rows: unknown[][],
): RawProductImportRow[] {
  const parsedRows: RawProductImportRow[] = [];

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

export async function readProductImportFile(
  file: File,
): Promise<RawProductImportRow[]> {
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

    return parseProductSpreadsheetRows(rows);
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

    return parseProductSpreadsheetRows(rows);
  }

  throw new Error("Unsupported file type. Upload a .csv or .xlsx file.");
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
