import type { SupabaseClient } from "@supabase/supabase-js";
import { isPostgresUniqueViolation } from "@/utils/postgres-fk-violation";

/** Excel general format turns long numeric barcodes into text like 5.90E+09. */
export const EXCEL_SCIENTIFIC_BARCODE = /^\d+(\.\d+)?E\+\d+$/i;

const BARCODE_CHARACTERS = /^[0-9A-Za-z_-]+$/;

export const FINISHED_PRODUCT_BARCODE_MAX_LENGTH = 128;

export function isExcelScientificBarcode(
  value: string | null | undefined,
): boolean {
  return EXCEL_SCIENTIFIC_BARCODE.test((value ?? "").trim());
}

export function excelScientificBarcodeMessage(value: string): string {
  return `Barcode looks like it was converted by Excel (${value}). Format the barcode column as Text in Excel and re-import.`;
}

/** Spreadsheet cells stay text. Numbers are not rewritten into scientific notation. */
export function barcodeImportCellToText(value: unknown): string {
  if (value == null) {
    return "";
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    if (Number.isInteger(value)) {
      return String(value);
    }
    return String(value).trim();
  }
  return String(value).trim();
}

export type ParsedProductBarcode =
  | { ok: true; barcode: string | null }
  | { ok: false; error: string };

/** Empty means clear (NULL). Leading zeros are kept. Scientific notation is refused. */
export function parseProductBarcodeText(value: string): ParsedProductBarcode {
  const trimmed = value.trim();
  if (!trimmed) {
    return { ok: true, barcode: null };
  }
  if (isExcelScientificBarcode(trimmed)) {
    return { ok: false, error: excelScientificBarcodeMessage(trimmed) };
  }
  if (trimmed.length > FINISHED_PRODUCT_BARCODE_MAX_LENGTH) {
    return {
      ok: false,
      error: `Barcode is too long (maximum ${FINISHED_PRODUCT_BARCODE_MAX_LENGTH} characters).`,
    };
  }
  if (!BARCODE_CHARACTERS.test(trimmed)) {
    return {
      ok: false,
      error:
        "Barcode can only contain letters, digits, hyphens, and underscores.",
    };
  }
  return { ok: true, barcode: trimmed };
}

export function normalizeProductBarcodeInput(value: string): string {
  return value.trim();
}

export function finishedProductBarcodeFieldError(message: string): string {
  return message;
}

export async function findFinishedProductIdByBarcode(
  supabase: SupabaseClient,
  barcode: string,
  excludeProductId?: string | null,
): Promise<{ productId: string | null; error: string | null }> {
  const normalized = normalizeProductBarcodeInput(barcode);
  if (!normalized) {
    return { productId: null, error: null };
  }

  let query = supabase
    .from("finished_products")
    .select("id")
    .eq("barcode", normalized)
    .limit(1);

  if (excludeProductId) {
    query = query.neq("id", excludeProductId);
  }

  const { data, error } = await query.maybeSingle();

  if (error) {
    return { productId: null, error: error.message };
  }

  return { productId: data?.id ?? null, error: null };
}

export function mapFinishedProductBarcodeSaveError(
  error: { code: string; message: string } | null,
): string | null {
  if (!error) {
    return null;
  }
  if (!isPostgresUniqueViolation(error)) {
    return null;
  }

  const constraint = (error.message ?? "").toLowerCase();
  if (constraint.includes("barcode")) {
    return "This barcode is already used by another product in your workspace.";
  }

  return "This barcode is already in use.";
}
