/**
 * POS More options stays closed while cash is being typed.
 *   npx tsx scripts/test-pos-more-options.ts
 */
import {
  posMoreOptionsFocusOnComplete,
  posPartPaymentShortLine,
} from "../app/dashboard/pos/pos-more-options";

function eq(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

eq(
  posPartPaymentShortLine(9),
  "Short by GHS 9.00 — this will be a part payment",
  "shortfall line",
);

eq(
  posMoreOptionsFocusOnComplete({
    cashShortBy: 9,
    dueDate: "2026-10-20",
    mobileMoney: false,
    payerPhone: "",
    payerPhoneRequired: false,
  }),
  null,
  "a filled due date does not open More options",
);

const dueDateGap = posMoreOptionsFocusOnComplete({
  cashShortBy: 9,
  dueDate: "  ",
  mobileMoney: false,
  payerPhone: "",
  payerPhoneRequired: false,
});
eq(dueDateGap?.fieldId, "pos-checkout-due-date", "blank due date focuses that field");
eq(
  dueDateGap?.message,
  "Enter a due date for this part payment.",
  "blank due date message",
);

eq(
  posMoreOptionsFocusOnComplete({
    cashShortBy: null,
    dueDate: "",
    mobileMoney: true,
    payerPhone: "",
    payerPhoneRequired: false,
  }),
  null,
  "optional MoMo phone stays closed",
);

const phoneGap = posMoreOptionsFocusOnComplete({
  cashShortBy: null,
  dueDate: "2026-10-20",
  mobileMoney: true,
  payerPhone: "",
  payerPhoneRequired: true,
});
eq(phoneGap?.fieldId, "pos-checkout-payer-phone", "required MoMo phone focuses that field");
eq(phoneGap?.message, "Enter the payer's phone number.", "required MoMo phone message");

eq(
  posMoreOptionsFocusOnComplete({
    cashShortBy: 0,
    dueDate: "",
    mobileMoney: false,
    payerPhone: "",
    payerPhoneRequired: false,
  }),
  null,
  "exact cash does not ask for a due date",
);

console.log("pos more options tests passed");
