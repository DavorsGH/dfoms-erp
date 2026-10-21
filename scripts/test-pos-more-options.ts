/**
 * POS More options stays closed while cash is being typed.
 *   npx tsx scripts/test-pos-more-options.ts
 */
import {
  posMoreOptionsChips,
  posMoreOptionsFocusOnComplete,
  posMoreOptionsPlacement,
  posPartPaymentShortLine,
  posPaymentMethodDisplayLabel,
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
  "Short by GHS 9.00.",
  "shortfall line",
);

eq(posPaymentMethodDisplayLabel("Cash"), "Cash payment", "cash display label");
eq(posPaymentMethodDisplayLabel("Mobile Money"), "Mobile Money", "momo display label");

eq(
  posMoreOptionsPlacement({ anchorTop: 600, anchorBottom: 640, viewportHeight: 800 }).mode,
  "above",
  "more room above opens above",
);
eq(
  posMoreOptionsPlacement({ anchorTop: 100, anchorBottom: 140, viewportHeight: 800 }).mode,
  "below",
  "more room below opens below",
);
eq(
  posMoreOptionsPlacement({ anchorTop: 300, anchorBottom: 340, viewportHeight: 600 }).mode,
  "modal",
  "under 420px either way opens a centred modal",
);
const above = posMoreOptionsPlacement({ anchorTop: 600, anchorBottom: 640, viewportHeight: 800 });
eq(above.maxHeight, 600 - 16, "height capped to space above");

const chipBase = {
  customerLabel: null,
  salesRepName: null,
  dueDate: "2026-10-21",
  todayIso: "2026-10-21",
  promoCode: null,
  storeCreditAmount: null,
  payerPhone: "",
  notes: "",
};
eq(posMoreOptionsChips(chipBase).length, 0, "no chips when nothing set");
const allChips = posMoreOptionsChips({
  customerLabel: "Ama Mensah",
  salesRepName: "Kofi",
  dueDate: "2026-10-24",
  todayIso: "2026-10-21",
  promoCode: "SAVE10",
  storeCreditAmount: 5,
  payerPhone: "0240000000",
  notes: "Fragile",
});
eq(
  allChips.map((chip) => chip.label).join("|"),
  "Ama Mensah|Due 24 Oct|Promo SAVE10|Store credit −5.00|Phone 0240000000|Note|Sales rep: Kofi",
  "chip labels",
);
eq(
  posMoreOptionsChips({ ...chipBase, dueDate: "2026-10-21" }).some((c) => c.key === "due"),
  false,
  "due chip hidden when due today",
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
