import type { LabelSize, ReceiptPaper } from "@/utils/tenant-device-settings";

export function labelDimensions(size: LabelSize): {
  width: string;
  height: string;
} {
  switch (size) {
    case "40x30":
      return { width: "40mm", height: "30mm" };
    case "60x40":
      return { width: "60mm", height: "40mm" };
    case "a4_sheet":
    case "50x25":
    default:
      return { width: "50mm", height: "25mm" };
  }
}

const RECEIPT_PAGE_STYLE_ID = "dfoms-receipt-page-size";
const RECEIPT_PRINT_HOST_ID = "dfoms-receipt-print-host";

/** Product, Qty, Unit Price, Subtotal. They sum to 100%. */
export const RECEIPT_COLUMN_WIDTHS = ["44%", "14%", "21%", "21%"] as const;

/** Physical roll from Scanners & Devices → Printers. A4 stays a full sheet. */
export function receiptPaperWidthMm(paper: ReceiptPaper): number {
  if (paper === "58mm") {
    return 58;
  }
  if (paper === "a4") {
    return 210;
  }
  return 80;
}

/**
 * Width the printer can actually mark. An 80mm roll prints about 72mm;
 * a 58mm roll prints about 48mm.
 */
export function receiptPrintableWidthMm(paper: ReceiptPaper): number {
  if (paper === "58mm") {
    return 48;
  }
  if (paper === "a4") {
    return 210;
  }
  return 72;
}

export function roundReceiptMm(value: number): number {
  return Math.ceil(value * 10) / 10;
}

/** 3mm padding on each side of the receipt. */
const RECEIPT_SIDE_PADDING_MM = 6;
/** Unit price and subtotal each take 21% of the content width. */
const RECEIPT_MONEY_COLUMN_SHARE = 0.21;
/**
 * Approximate width of one character at the 9pt amount size.
 * Amounts that no longer fit wrap "GHS" above the figure instead of shrinking.
 */
const RECEIPT_MONEY_CHAR_MM = 1.6;

export function formatReceiptAmount(value: number): string {
  const negative = value < 0;
  const [whole, frac] = Math.abs(Number(value) || 0).toFixed(2).split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}.${frac}`;
}

export function receiptContentWidthMm(paper: ReceiptPaper): number {
  return Math.max(receiptPrintableWidthMm(paper) - RECEIPT_SIDE_PADDING_MM, 1);
}

export function receiptMoneyColumnMm(paper: ReceiptPaper): number {
  return receiptContentWidthMm(paper) * RECEIPT_MONEY_COLUMN_SHARE;
}

/** Width of a nowrap amount at the 9pt receipt size. */
export function receiptAmountWidthMm(value: number): number {
  return `GHS ${formatReceiptAmount(value)}`.length * RECEIPT_MONEY_CHAR_MM;
}

/**
 * True when the amount itself is wider than the printable content.
 * A wrapping product name is never wider than the paper.
 */
export function receiptAmountFitsPaper(value: number, paper: ReceiptPaper): boolean {
  return receiptAmountWidthMm(value) <= receiptContentWidthMm(paper) + 0.05;
}

/** True only when "GHS 1,234.00" cannot sit on one line across the receipt. */
export function receiptMoneyStacks(value: number, paper: ReceiptPaper): boolean {
  return !receiptAmountFitsPaper(value, paper);
}

/** @page rule injected at print time. Width is the printable width. Missing height falls back to auto. */
export function buildReceiptPageCss(
  widthMm: number,
  heightMm: number | null,
): string {
  const sized =
    heightMm != null && heightMm > 0
      ? `${widthMm}mm ${roundReceiptMm(heightMm)}mm`
      : `${widthMm}mm auto`;
  return `@media print { @page { margin: 0; size: ${sized}; } html, body { height: auto !important; margin: 0 !important; padding: 0 !important; } body > *:not(#${RECEIPT_PRINT_HOST_ID}) { display: none !important; } #${RECEIPT_PRINT_HOST_ID}, #${RECEIPT_PRINT_HOST_ID} * { visibility: visible !important; } #${RECEIPT_PRINT_HOST_ID} { display: block !important; position: static !important; left: auto !important; top: auto !important; width: ${widthMm}mm !important; max-width: ${widthMm}mm !important; height: auto !important; margin: 0 !important; padding: 0 !important; overflow: visible !important; } }`;
}

/** Drop every @page rule except the one injected for this print. */
export function cssWithoutPageRules(css: string): string {
  return css.replace(/@page\s*[^{]*\{[^}]*\}/g, "");
}

export function formatSaleDateTime(value: string | null | undefined): string {
  const raw = value?.trim() ?? "";
  if (!raw) {
    return "—";
  }
  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(raw);
  const parsed = new Date(dateOnly ? `${raw}T00:00:00Z` : raw);
  if (Number.isNaN(parsed.getTime())) {
    return raw;
  }
  const datePart = parsed.toLocaleDateString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    timeZone: "Africa/Accra",
  });
  if (dateOnly) {
    return datePart;
  }
  const timePart = parsed.toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "Africa/Accra",
  });
  return `${datePart}, ${timePart}`;
}

function pixelsPerMillimetre(): number {
  const probe = document.createElement("div");
  probe.style.position = "absolute";
  probe.style.left = "-10000px";
  probe.style.top = "0";
  probe.style.width = "100mm";
  probe.style.height = "0";
  probe.style.visibility = "hidden";
  document.body.appendChild(probe);
  const pxPerMm = probe.getBoundingClientRect().width / 100;
  probe.remove();
  return pxPerMm;
}

function suspendOtherPageRules(keep: HTMLStyleElement): () => void {
  const snapshots: { element: HTMLStyleElement; text: string }[] = [];
  for (const element of document.querySelectorAll("style")) {
    if (!(element instanceof HTMLStyleElement) || element === keep) {
      continue;
    }
    const text = element.textContent ?? "";
    if (!text.includes("@page")) {
      continue;
    }
    snapshots.push({ element, text });
    element.textContent = cssWithoutPageRules(text);
  }
  return () => {
    for (const snapshot of snapshots) {
      snapshot.element.textContent = snapshot.text;
    }
  };
}

/**
 * Measure the receipt at the printable width, then print a page of that height.
 */
export function printFittedReceipt(elementId: string, paper: ReceiptPaper): void {
  const widthMm = receiptPrintableWidthMm(paper);
  const node = document.getElementById(elementId);

  document.getElementById(RECEIPT_PAGE_STYLE_ID)?.remove();
  document.getElementById(RECEIPT_PRINT_HOST_ID)?.remove();

  const host = document.createElement("div");
  host.id = RECEIPT_PRINT_HOST_ID;
  host.style.position = "absolute";
  host.style.left = "0";
  host.style.top = "0";
  host.style.width = `${widthMm}mm`;
  host.style.margin = "0";
  host.style.padding = "0";
  host.style.overflow = "visible";
  host.style.visibility = "hidden";

  let clone: HTMLElement | null = null;
  if (node) {
    const copied = node.cloneNode(true);
    if (copied instanceof HTMLElement) {
      node.removeAttribute("id");
      copied.id = elementId;
      copied.style.boxSizing = "border-box";
      copied.style.width = `${widthMm}mm`;
      copied.style.maxWidth = `${widthMm}mm`;
      copied.style.padding = "3mm";
      copied.style.border = "0";
      copied.style.boxShadow = "none";
      copied.style.borderRadius = "0";
      copied.style.minHeight = "0";
      copied.style.height = "auto";
      copied.style.overflow = "visible";
      host.appendChild(copied);
      clone = copied;
    }
  }
  document.body.appendChild(host);

  let heightMm: number | null = null;
  if (clone) {
    const pxPerMm = pixelsPerMillimetre();
    const heightPx = clone.getBoundingClientRect().height;
    heightMm = pxPerMm > 0 ? heightPx / pxPerMm : null;
  }

  const style = document.createElement("style");
  style.id = RECEIPT_PAGE_STYLE_ID;
  style.textContent = `${buildReceiptPageCss(
    widthMm,
    heightMm != null && heightMm > 0 ? heightMm : null,
  )}#${RECEIPT_PRINT_HOST_ID} { visibility: hidden; } @media print { #${elementId} { position: static !important; width: ${widthMm}mm !important; max-width: ${widthMm}mm !important; height: auto !important; min-height: 0 !important; margin: 0 !important; padding: 3mm !important; box-sizing: border-box !important; overflow-x: hidden !important; overflow-y: visible !important; } }`;
  host.appendChild(style);
  const restorePageRules = suspendOtherPageRules(style);

  const cleanup = () => {
    restorePageRules();
    style.remove();
    host.remove();
    if (node && !node.id) {
      node.id = elementId;
    }
    window.removeEventListener("afterprint", cleanup);
  };
  window.addEventListener("afterprint", cleanup);
  window.print();
}

export function receiptPrintCss(paper: ReceiptPaper, elementId: string): string {
  const width = `${receiptPrintableWidthMm(paper)}mm`;
  return `@media print {
    @page { margin: 0; size: ${width} auto; }
    html, body { height: auto !important; margin: 0 !important; padding: 0 !important; min-height: 0 !important; background: #fff !important; }
    body * { visibility: hidden !important; }
    #${elementId}, #${elementId} * { visibility: visible !important; }
    nav, aside, [data-dashboard-chrome], [data-assistant-chat], .no-print { display: none !important; }
    #${elementId} {
      position: static !important;
      width: ${width} !important;
      max-width: ${width} !important;
      height: auto !important;
      min-height: 0 !important;
      margin: 0 !important;
      padding: 3mm !important;
      box-sizing: border-box !important;
      box-shadow: none !important;
      border: none !important;
      border-radius: 0 !important;
      background: #fff !important;
      color: #0f172a !important;
      overflow-x: hidden !important;
      overflow-y: visible !important;
    }
    #${elementId} { font-size: 9pt !important; }
    #${elementId} table { width: 100% !important; max-width: 100% !important; table-layout: fixed !important; font-size: 9pt !important; }
    #${elementId} .receipt-body { font-size: 9pt !important; }
    #${elementId} .receipt-business-name { font-size: 11pt !important; font-weight: 700 !important; }
    #${elementId} .receipt-total { font-size: 10pt !important; font-weight: 700 !important; }
    #${elementId} .receipt-emphasis { font-size: 11pt !important; font-weight: 700 !important; }
    #${elementId} .receipt-item-name { overflow-wrap: anywhere !important; word-break: break-word !important; }
    #${elementId} .receipt-line-total, #${elementId} .receipt-totals .receipt-money { white-space: nowrap !important; max-width: 100% !important; }
    #${elementId} th, #${elementId} td { padding: 0.6mm 0.4mm !important; white-space: normal !important; overflow-wrap: anywhere !important; word-wrap: break-word !important; font-size: 9pt !important; }
    #${elementId} .receipt-num { text-align: right !important; }
    #${elementId} .receipt-money { display: inline-block !important; max-width: 100% !important; text-align: right !important; white-space: nowrap !important; font-size: 9pt !important; }
    #${elementId} .receipt-money-stack { white-space: normal !important; font-size: 9pt !important; }
    #${elementId} .receipt-money-stack > span { display: block !important; white-space: normal !important; }
  }`;
}

export function labelPrintCss(size: LabelSize, areaId: string): string {
  const dim = labelDimensions(size);
  if (size === "a4_sheet") {
    return `@media print { @page { size: A4; margin: 8mm; } #${areaId} .product-barcode-label-grid { display: grid !important; grid-template-columns: repeat(3, ${dim.width}); gap: 4mm; } #${areaId} .device-label-sheet { width: ${dim.width}; min-height: ${dim.height}; } }`;
  }
  return `@media print { @page { size: ${dim.width} ${dim.height}; margin: 0; } #${areaId} .product-barcode-label-grid { display: block !important; } #${areaId} .device-label-sheet { width: ${dim.width}; height: ${dim.height}; break-after: page; page-break-after: always; border: none; } }`;
}
