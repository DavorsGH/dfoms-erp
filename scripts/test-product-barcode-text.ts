/**
 * Barcode text rules: Excel scientific notation is refused, blanks clear, leading zeros stay.
 *   npx tsx scripts/test-product-barcode-text.ts
 */
import { validateFinishedProductBarcodeForImport } from "../lib/bulk-import/finished-product-barcode-import";
import {
  barcodeImportCellToText,
  isExcelScientificBarcode,
  parseProductBarcodeText,
} from "../utils/finished-product-barcode-utils";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function eq(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

const excelMessage =
  "Barcode looks like it was converted by Excel (5.90E+09). Format the barcode column as Text in Excel and re-import.";

const scientific = parseProductBarcodeText("5.90E+09");
assert(!scientific.ok, "scientific notation is refused");
if (!scientific.ok) {
  eq(scientific.error, excelMessage, "excel row error");
}

eq(parseProductBarcodeText("  5.90e+09 ").ok, false, "case and spaces");
eq(isExcelScientificBarcode("5.90E+09"), true, "badge pattern");
eq(isExcelScientificBarcode("5900000000"), false, "plain digits are fine");

const cleared = parseProductBarcodeText("   ");
assert(cleared.ok && cleared.barcode === null, "blank barcode clears to null");

const leading = parseProductBarcodeText(" 00123 ");
assert(leading.ok && leading.barcode === "00123", "leading zeros stay");

const letters = parseProductBarcodeText("DF-BC_0042");
assert(letters.ok && letters.barcode === "DF-BC_0042", "letters hyphen underscore");

const spaces = parseProductBarcodeText("12 34");
assert(!spaces.ok, "internal spaces are refused");

eq(
  validateFinishedProductBarcodeForImport("5.90E+09", "Barcode"),
  excelMessage,
  "import row error",
);
eq(validateFinishedProductBarcodeForImport("", "Barcode"), null, "blank import");
eq(validateFinishedProductBarcodeForImport("00123", "Barcode"), null, "text import");
eq(barcodeImportCellToText(5900000000), "5900000000", "integer cell stays digits");
eq(
  validateFinishedProductBarcodeForImport("1.23e+21", "Barcode"),
  "Barcode looks like it was converted by Excel (1.23e+21). Format the barcode column as Text in Excel and re-import.",
  "lowercase scientific import",
);

console.log("product barcode text tests passed");
