import { formatGHS } from "../finance/income-register-utils";

export const POS_DUE_DATE_FIELD_ID = "pos-checkout-due-date";
export const POS_PAYER_PHONE_FIELD_ID = "pos-checkout-payer-phone";

export function posPartPaymentShortLine(shortBy: number): string {
  return `Short by ${formatGHS(shortBy)} — this will be a part payment`;
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
