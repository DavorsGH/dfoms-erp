import { formatGHS } from "../finance/income-register-utils";

export const POS_DUE_DATE_FIELD_ID = "pos-checkout-due-date";
export const POS_PAYER_PHONE_FIELD_ID = "pos-checkout-payer-phone";
export const POS_CUSTOMER_FIELD_ID = "pos-checkout-customer";
export const POS_SALES_REP_FIELD_ID = "pos-checkout-sales-rep";
export const POS_PROMO_FIELD_ID = "pos-checkout-promo";
export const POS_STORE_CREDIT_FIELD_ID = "pos-checkout-store-credit";
export const POS_NOTES_FIELD_ID = "pos-checkout-notes";

/**
 * Amber shortfall prefix. Part payments are not allowed at the till —
 * staff continue as a manual sale (see pos-manual-sale-handoff) instead.
 */
export function posPartPaymentShortLine(shortBy: number): string {
  return `Short by ${formatGHS(shortBy)}.`;
}

/** Label for a payment method button; the stored method value is unchanged. */
export function posPaymentMethodDisplayLabel(method: string): string {
  return method === "Cash" ? "Cash payment" : method;
}

/** Minimum free viewport height (px) for the More options popover; below it we use a centred modal. */
export const POS_MORE_OPTIONS_MIN_ROOM_PX = 420;
const POS_MORE_OPTIONS_GAP_PX = 8;
const POS_MORE_OPTIONS_EDGE_PX = 8;

export type PosMoreOptionsPlacement =
  | { mode: "above"; maxHeight: number }
  | { mode: "below"; maxHeight: number }
  | { mode: "modal"; maxHeight: number };

/**
 * Decide where More options opens so it always fits in the viewport:
 * above or below the anchor (whichever has more room), height capped to that room,
 * or a centred modal when neither side has at least ~420px.
 */
export function posMoreOptionsPlacement(input: {
  anchorTop: number;
  anchorBottom: number;
  viewportHeight: number;
}): PosMoreOptionsPlacement {
  const spaceAbove = Math.floor(
    input.anchorTop - POS_MORE_OPTIONS_GAP_PX - POS_MORE_OPTIONS_EDGE_PX,
  );
  const spaceBelow = Math.floor(
    input.viewportHeight -
      input.anchorBottom -
      POS_MORE_OPTIONS_GAP_PX -
      POS_MORE_OPTIONS_EDGE_PX,
  );
  const best = Math.max(spaceAbove, spaceBelow);
  if (best < POS_MORE_OPTIONS_MIN_ROOM_PX) {
    return {
      mode: "modal",
      maxHeight: Math.max(
        200,
        Math.floor(input.viewportHeight - 2 * POS_MORE_OPTIONS_EDGE_PX * 2),
      ),
    };
  }
  return spaceAbove >= spaceBelow
    ? { mode: "above", maxHeight: spaceAbove }
    : { mode: "below", maxHeight: spaceBelow };
}

export type PosMoreOptionsChip = {
  key: string;
  label: string;
  fieldId: string;
};

/** Chips shown next to More options — one per value that is set. */
export function posMoreOptionsChips(input: {
  customerLabel: string | null;
  salesRepName: string | null;
  dueDate: string;
  todayIso: string;
  promoCode: string | null;
  storeCreditAmount: number | null;
  payerPhone: string;
  notes: string;
}): PosMoreOptionsChip[] {
  const chips: PosMoreOptionsChip[] = [];
  if (input.customerLabel) {
    chips.push({
      key: "customer",
      label: input.customerLabel,
      fieldId: POS_CUSTOMER_FIELD_ID,
    });
  }
  const due = input.dueDate.trim();
  if (due && due !== input.todayIso) {
    chips.push({
      key: "due",
      label: `Due ${formatPosChipDueDate(due)}`,
      fieldId: POS_DUE_DATE_FIELD_ID,
    });
  }
  if (input.promoCode) {
    chips.push({
      key: "promo",
      label: `Promo ${input.promoCode}`,
      fieldId: POS_PROMO_FIELD_ID,
    });
  }
  if (input.storeCreditAmount != null && input.storeCreditAmount > 0) {
    chips.push({
      key: "store-credit",
      label: `Store credit −${input.storeCreditAmount.toFixed(2)}`,
      fieldId: POS_STORE_CREDIT_FIELD_ID,
    });
  }
  if (input.payerPhone.trim()) {
    chips.push({
      key: "payer-phone",
      label: `Phone ${input.payerPhone.trim()}`,
      fieldId: POS_PAYER_PHONE_FIELD_ID,
    });
  }
  if (input.notes.trim()) {
    chips.push({ key: "note", label: "Note", fieldId: POS_NOTES_FIELD_ID });
  }
  if (input.salesRepName) {
    chips.push({
      key: "sales-rep",
      label: `Sales rep: ${input.salesRepName}`,
      fieldId: POS_SALES_REP_FIELD_ID,
    });
  }
  return chips;
}

const CHIP_MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/** "2026-10-24" → "24 Oct" (falls back to the raw value when not an ISO date). */
export function formatPosChipDueDate(iso: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!match) {
    return iso;
  }
  const month = CHIP_MONTHS[Number(match[2]) - 1];
  if (!month) {
    return iso;
  }
  return `${Number(match[3])} ${month}`;
}

export type PosMoreOptionsFocus = {
  fieldId: typeof POS_DUE_DATE_FIELD_ID | typeof POS_PAYER_PHONE_FIELD_ID;
  message: string;
};

/**
 * More options opens from Complete Sale only when a field it contains is still required.
 * Typing a short cash amount does not call this.
 */
export function posMoreOptionsFocusOnComplete(input: {
  cashShortBy: number | null;
  dueDate: string;
  mobileMoney: boolean;
  payerPhone: string;
  payerPhoneRequired: boolean;
}): PosMoreOptionsFocus | null {
  if (
    input.cashShortBy != null &&
    input.cashShortBy > 0.001 &&
    !input.dueDate.trim()
  ) {
    return {
      fieldId: POS_DUE_DATE_FIELD_ID,
      message: "Enter a due date for this part payment.",
    };
  }
  if (
    input.mobileMoney &&
    input.payerPhoneRequired &&
    !input.payerPhone.trim()
  ) {
    return {
      fieldId: POS_PAYER_PHONE_FIELD_ID,
      message: "Enter the payer's phone number.",
    };
  }
  return null;
}
