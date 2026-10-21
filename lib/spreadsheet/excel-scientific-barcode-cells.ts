import * as XLSX from "xlsx";
import { EXCEL_SCIENTIFIC_BARCODE } from "@/utils/finished-product-barcode-utils";

/**
 * Excel General format shows long numeric barcodes as text like 5.90E+09.
 * Keep that display text so import validation can reject it instead of
 * storing a rounded number.
 */
export function keepScientificBarcodeCellsAsText(sheet: XLSX.WorkSheet): void {
  for (const address of Object.keys(sheet)) {
    if (address.startsWith("!")) {
      continue;
    }
    const cell = sheet[address] as XLSX.CellObject | undefined;
    if (!cell || cell.t !== "n" || typeof cell.v !== "number") {
      continue;
    }
    let formatted = "";
    try {
      formatted = XLSX.utils.format_cell(cell).trim();
    } catch {
      formatted = "";
    }
    if (!EXCEL_SCIENTIFIC_BARCODE.test(formatted)) {
      continue;
    }
    cell.t = "s";
    cell.v = formatted;
  }
}
