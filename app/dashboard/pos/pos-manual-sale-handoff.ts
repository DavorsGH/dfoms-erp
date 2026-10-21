import { formatGHS } from "../finance/income-register-utils";
import { formatPosChipDueDate } from "./pos-more-options";
import {
  POS_CUSTOMER_OTHER_VALUE,
  lineSubtotal,
  roundMoney,
  type PosCartLine,
} from "./pos-utils";
import type { PosSelectedStoreCredit } from "./pos-store-credit-utils";

export const POS_MANUAL_SALE_HANDOFF_PARAM = "posHandoff";
export const POS_MANUAL_SALE_RESTORE_PARAM = "posRestore";
export const POS_MANUAL_SALE_HANDOFF_STORAGE_PREFIX =
  "dfoms:pos-manual-sale-handoff:";
/** One-time handoff expires after 30 minutes. */
export const POS_MANUAL_SALE_HANDOFF_TTL_MS = 30 * 60 * 1000;

export const POS_MANUAL_SALE_HANDOFF_MISSING_MESSAGE =
  "The POS cart could not be loaded. Please re-enter the sale.";

export type PosManualSaleHandoffLine = {
  productId: string;
  productCode: string;
  productName: string;
  unitOfMeasure: string;
  quantity: number;
  /** Unit price after cart-level promo/loyalty discounts are distributed. */
  unitPrice: number;
  availableStock: number;
};

export type PosManualSalePrefill = {
  lines: PosManualSaleHandoffLine[];
  clientId: string | null;
  customerName: string | null;
  /** ISO date when set at the till; null when the form should require its own due date. */
  dueDate: string | null;
  notes: string;
  salesRepId: string | null;
  paymentMethod: string;
  amountReceived: number;
  saleDate: string;
  businessUnitId: string | null;
  promoCode: string | null;
  promoDiscount: number;
  loyaltyDiscount: number;
};

export type PosManualSalePosRestore = {
  cartLines: PosCartLine[];
  clientId: string;
  customerName: string;
  salesRepId: string;
  paymentMethod: string;
  amountTendered: string;
  dueDate: string;
  notes: string;
  appliedPromoCode: string | null;
  promoDiscount: number;
  loyaltyDiscount: number;
  loyaltyPointsRedeemed: number;
  loyaltyRedeemInput: string;
  selectedStoreCredit: PosSelectedStoreCredit | null;
  payerPhone: string;
};

export type PosManualSaleHandoffPayload = {
  version: 1;
  createdAt: number;
  expiresAt: number;
  prefill: PosManualSalePrefill;
  posRestore: PosManualSalePosRestore;
};

export function posHasCustomerSelected(
  clientSelect: string,
  walkInName: string,
): boolean {
  const trimmed = clientSelect.trim();
  if (!trimmed) {
    return false;
  }
  if (trimmed === POS_CUSTOMER_OTHER_VALUE) {
    return walkInName.trim().length > 0;
  }
  return true;
}

/** Prefix text for the amber shortfall line (always includes trailing space when a button follows). */
export function posShortfallShortByPrefix(shortBy: number): string {
  return `Short by ${formatGHS(shortBy)}. `;
}

/**
 * When no customer is selected: full shortfall prompt.
 * "Choose a customer" is the interactive segment (indexes into the string).
 */
export function posShortfallChooseCustomerPrompt(shortBy: number): {
  full: string;
  linkText: string;
  linkStart: number;
  linkEnd: number;
} {
  const prefix = posShortfallShortByPrefix(shortBy);
  const linkText = "Choose a customer";
  const rest = " to continue as manual sale.";
  const full = `${prefix}${linkText}${rest}`;
  const linkStart = prefix.length;
  return {
    full,
    linkText,
    linkStart,
    linkEnd: linkStart + linkText.length,
  };
}

export function distributeCartDiscountToUnitPrices(
  lines: PosCartLine[],
  cartDiscount: number,
): PosManualSaleHandoffLine[] {
  const discount = roundMoney(Math.max(0, cartDiscount));
  const gross = roundMoney(
    lines.reduce((sum, line) => sum + lineSubtotal(line), 0),
  );
  if (lines.length === 0) {
    return [];
  }
  if (discount <= 0 || gross <= 0) {
    return lines.map((line) => ({
      productId: line.productId,
      productCode: line.productCode,
      productName: line.productName,
      unitOfMeasure: line.unitOfMeasure,
      quantity: line.quantity,
      unitPrice: roundMoney(line.unitPrice),
      availableStock: line.availableStock,
    }));
  }

  let allocated = 0;
  return lines.map((line, index) => {
    const sub = lineSubtotal(line);
    let share: number;
    if (index === lines.length - 1) {
      share = roundMoney(Math.min(sub, Math.max(0, discount - allocated)));
    } else {
      share = roundMoney((sub / gross) * discount);
      allocated = roundMoney(allocated + share);
    }
    const net = roundMoney(Math.max(0, sub - share));
    const unitPrice =
      line.quantity > 0 ? roundMoney(net / line.quantity) : 0;
    return {
      productId: line.productId,
      productCode: line.productCode,
      productName: line.productName,
      unitOfMeasure: line.unitOfMeasure,
      quantity: line.quantity,
      unitPrice,
      availableStock: line.availableStock,
    };
  });
}

/** Greedy allocation of cash paid across lines (earlier lines first). */
export function allocateAmountReceivedAcrossLines(
  lineTotals: number[],
  amountReceived: number,
): number[] {
  let remaining = roundMoney(Math.max(0, amountReceived));
  return lineTotals.map((total) => {
    const lineTotal = roundMoney(Math.max(0, total));
    const pay = roundMoney(Math.min(remaining, lineTotal));
    remaining = roundMoney(remaining - pay);
    return pay;
  });
}

export function formatPosManualSaleSavedToast(input: {
  invoiceNo: string;
  balance: number;
  dueDate: string;
}): string {
  const invoice = input.invoiceNo.trim() || "—";
  const due = formatPosChipDueDate(input.dueDate.trim()) || input.dueDate.trim();
  return `Saved as ${invoice} — balance ${formatGHS(input.balance)} due ${due}`;
}

export function handoffStorageKey(id: string): string {
  return `${POS_MANUAL_SALE_HANDOFF_STORAGE_PREFIX}${id}`;
}

export function createPosManualSaleHandoffId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `handoff-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function isHandoffPayload(value: unknown): value is PosManualSaleHandoffPayload {
  if (!value || typeof value !== "object") {
    return false;
  }
  const row = value as PosManualSaleHandoffPayload;
  return (
    row.version === 1 &&
    typeof row.createdAt === "number" &&
    typeof row.expiresAt === "number" &&
    row.prefill != null &&
    Array.isArray(row.prefill.lines) &&
    row.posRestore != null &&
    Array.isArray(row.posRestore.cartLines)
  );
}

export function writePosManualSaleHandoff(
  payload: PosManualSaleHandoffPayload,
  id: string = createPosManualSaleHandoffId(),
  storage: Pick<Storage, "setItem"> | null = typeof sessionStorage !== "undefined"
    ? sessionStorage
    : null,
): string {
  if (!storage) {
    throw new Error("sessionStorage is not available");
  }
  storage.setItem(handoffStorageKey(id), JSON.stringify(payload));
  return id;
}

export function readPosManualSaleHandoff(
  id: string,
  nowMs: number = Date.now(),
  storage: Pick<Storage, "getItem"> | null = typeof sessionStorage !== "undefined"
    ? sessionStorage
    : null,
): PosManualSaleHandoffPayload | null {
  const trimmed = id.trim();
  if (!trimmed || !storage) {
    return null;
  }
  const raw = storage.getItem(handoffStorageKey(trimmed));
  if (!raw) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isHandoffPayload(parsed)) {
      return null;
    }
    if (parsed.expiresAt < nowMs) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

/** Read once and remove the storage entry (one-time handoff). */
export function consumePosManualSaleHandoff(
  id: string,
  nowMs: number = Date.now(),
  storage: Pick<Storage, "getItem" | "removeItem"> | null =
    typeof sessionStorage !== "undefined" ? sessionStorage : null,
): PosManualSaleHandoffPayload | null {
  const payload = readPosManualSaleHandoff(id, nowMs, storage);
  if (storage && id.trim()) {
    storage.removeItem(handoffStorageKey(id.trim()));
  }
  return payload;
}

export function clearPosManualSaleHandoff(
  id: string,
  storage: Pick<Storage, "removeItem"> | null = typeof sessionStorage !==
  "undefined"
    ? sessionStorage
    : null,
): void {
  if (!storage || !id.trim()) {
    return;
  }
  storage.removeItem(handoffStorageKey(id.trim()));
}

export function buildPosManualSaleHandoffPayload(input: {
  cartLines: PosCartLine[];
  clientSelect: string;
  walkInName: string;
  dueDate: string;
  todayIso: string;
  /** True when the till due-date field was shown for this shortfall. */
  dueDateSet: boolean;
  notes: string;
  salesRepId: string;
  paymentMethod: string;
  amountReceived: number;
  saleDate: string;
  businessUnitId: string | null;
  promoCode: string | null;
  promoDiscount: number;
  loyaltyDiscount: number;
  loyaltyPointsRedeemed: number;
  loyaltyRedeemInput: string;
  amountTendered: string;
  selectedStoreCredit: PosSelectedStoreCredit | null;
  payerPhone: string;
  nowMs?: number;
  ttlMs?: number;
}): PosManualSaleHandoffPayload {
  const nowMs = input.nowMs ?? Date.now();
  const ttlMs = input.ttlMs ?? POS_MANUAL_SALE_HANDOFF_TTL_MS;
  const cartDiscount = roundMoney(
    Math.max(0, input.promoDiscount) + Math.max(0, input.loyaltyDiscount),
  );
  const lines = distributeCartDiscountToUnitPrices(
    input.cartLines,
    cartDiscount,
  );

  let clientId: string | null = null;
  let customerName: string | null = null;
  const select = input.clientSelect.trim();
  if (select === POS_CUSTOMER_OTHER_VALUE) {
    customerName = input.walkInName.trim() || null;
  } else if (select) {
    clientId = select;
  }

  const dueTrimmed = input.dueDate.trim();
  const dueDate =
    input.dueDateSet && dueTrimmed
      ? dueTrimmed
      : dueTrimmed && dueTrimmed !== input.todayIso
        ? dueTrimmed
        : null;

  let notes = input.notes.trim();
  if (input.promoCode && input.promoDiscount > 0) {
    const promoNote = `Promo ${input.promoCode} −${formatGHS(input.promoDiscount)}`;
    notes = notes ? `${notes}\n${promoNote}` : promoNote;
  }
  if (input.loyaltyDiscount > 0) {
    const loyaltyNote = `Loyalty −${formatGHS(input.loyaltyDiscount)}`;
    notes = notes ? `${notes}\n${loyaltyNote}` : loyaltyNote;
  }

  return {
    version: 1,
    createdAt: nowMs,
    expiresAt: nowMs + ttlMs,
    prefill: {
      lines,
      clientId,
      customerName,
      dueDate,
      notes,
      salesRepId: input.salesRepId.trim() || null,
      paymentMethod: input.paymentMethod,
      amountReceived: roundMoney(Math.max(0, input.amountReceived)),
      saleDate: input.saleDate,
      businessUnitId: input.businessUnitId,
      promoCode: input.promoCode,
      promoDiscount: roundMoney(Math.max(0, input.promoDiscount)),
      loyaltyDiscount: roundMoney(Math.max(0, input.loyaltyDiscount)),
    },
    posRestore: {
      cartLines: input.cartLines.map((line) => ({ ...line })),
      clientId: input.clientSelect,
      customerName: input.walkInName,
      salesRepId: input.salesRepId,
      paymentMethod: input.paymentMethod,
      amountTendered: input.amountTendered,
      dueDate: input.dueDate,
      notes: input.notes,
      appliedPromoCode: input.promoCode,
      promoDiscount: input.promoDiscount,
      loyaltyDiscount: input.loyaltyDiscount,
      loyaltyPointsRedeemed: input.loyaltyPointsRedeemed,
      loyaltyRedeemInput: input.loyaltyRedeemInput,
      selectedStoreCredit: input.selectedStoreCredit,
      payerPhone: input.payerPhone,
    },
  };
}

export function manualSaleLinesTotal(
  lines: Pick<PosManualSaleHandoffLine, "quantity" | "unitPrice">[],
): number {
  return roundMoney(
    lines.reduce(
      (sum, line) => sum + roundMoney(line.quantity * line.unitPrice),
      0,
    ),
  );
}
