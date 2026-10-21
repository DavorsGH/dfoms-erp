/**
 * POS shortfall → Continue as manual sale handoff helpers.
 *   npx tsx scripts/test-pos-manual-sale-handoff.ts
 */
import {
  POS_MANUAL_SALE_HANDOFF_MISSING_MESSAGE,
  allocateAmountReceivedAcrossLines,
  buildPosManualSaleHandoffPayload,
  clearPosManualSaleHandoff,
  consumePosManualSaleHandoff,
  createPosManualSaleHandoffId,
  distributeCartDiscountToUnitPrices,
  formatPosManualSaleSavedToast,
  handoffStorageKey,
  manualSaleLinesTotal,
  posHasCustomerSelected,
  posShortfallChooseCustomerPrompt,
  posShortfallShortByPrefix,
  readPosManualSaleHandoff,
  writePosManualSaleHandoff,
} from "../app/dashboard/pos/pos-manual-sale-handoff";
import { POS_CUSTOMER_OTHER_VALUE, type PosCartLine } from "../app/dashboard/pos/pos-utils";
import { posPartPaymentShortLine } from "../app/dashboard/pos/pos-more-options";

function eq(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

function approx(actual: number, expected: number, message: string) {
  if (Math.abs(actual - expected) > 0.001) {
    throw new Error(`${message}: expected ${expected}, got ${actual}`);
  }
}

const memory = new Map<string, string>();
const storage: Pick<Storage, "getItem" | "setItem" | "removeItem"> = {
  getItem: (key) => memory.get(key) ?? null,
  setItem: (key, value) => {
    memory.set(key, value);
  },
  removeItem: (key) => {
    memory.delete(key);
  },
};

eq(posHasCustomerSelected("", ""), false, "no customer");
eq(posHasCustomerSelected("C-1", ""), true, "contract customer");
eq(
  posHasCustomerSelected(POS_CUSTOMER_OTHER_VALUE, ""),
  false,
  "other without name",
);
eq(
  posHasCustomerSelected(POS_CUSTOMER_OTHER_VALUE, "Ama"),
  true,
  "other with name",
);

eq(posPartPaymentShortLine(9), "Short by GHS 9.00.", "shortfall prefix only");
eq(
  posShortfallShortByPrefix(9),
  "Short by GHS 9.00. ",
  "prefix with trailing space for button",
);

const noCustomer = posShortfallChooseCustomerPrompt(12.5);
eq(
  noCustomer.full,
  "Short by GHS 12.50. Choose a customer to continue as manual sale.",
  "no-customer prompt",
);
eq(noCustomer.linkText, "Choose a customer", "choose customer link text");
eq(
  noCustomer.full.slice(noCustomer.linkStart, noCustomer.linkEnd),
  "Choose a customer",
  "link slice matches",
);

const cart: PosCartLine[] = [
  {
    id: "1",
    productId: "p1",
    productCode: "A",
    productName: "Alpha",
    unitOfMeasure: "pcs",
    quantity: 2,
    unitPrice: 50,
    availableStock: 10,
  },
  {
    id: "2",
    productId: "p2",
    productCode: "B",
    productName: "Beta",
    unitOfMeasure: "pcs",
    quantity: 1,
    unitPrice: 100,
    availableStock: 5,
  },
];

const discounted = distributeCartDiscountToUnitPrices(cart, 20);
approx(manualSaleLinesTotal(discounted), 180, "promo distributed keeps net total");
eq(
  allocateAmountReceivedAcrossLines([100, 80], 40).join(","),
  "40,0",
  "cash allocated to first lines",
);
eq(
  allocateAmountReceivedAcrossLines([100, 80], 130).join(","),
  "100,30",
  "cash spans lines",
);

const now = 1_700_000_000_000;
const payload = buildPosManualSaleHandoffPayload({
  cartLines: cart,
  clientSelect: "C-9",
  walkInName: "",
  dueDate: "2026-10-25",
  todayIso: "2026-10-21",
  dueDateSet: true,
  notes: "Fragile",
  salesRepId: "E-1",
  paymentMethod: "Cash",
  amountReceived: 40,
  saleDate: "2026-10-21",
  businessUnitId: null,
  promoCode: "SAVE10",
  promoDiscount: 20,
  loyaltyDiscount: 0,
  loyaltyPointsRedeemed: 0,
  loyaltyRedeemInput: "",
  amountTendered: "40",
  selectedStoreCredit: null,
  payerPhone: "",
  nowMs: now,
  ttlMs: 60_000,
});

eq(payload.prefill.clientId, "C-9", "prefill client");
eq(payload.prefill.amountReceived, 40, "prefill amount received");
eq(payload.prefill.dueDate, "2026-10-25", "prefill due date when set");
eq(payload.prefill.paymentMethod, "Cash", "prefill payment method");
eq(payload.prefill.lines.length, 2, "every cart line in prefill");
eq(payload.posRestore.amountTendered, "40", "restore keeps cash typed");
eq(payload.posRestore.cartLines.length, 2, "restore keeps cart");

const id = createPosManualSaleHandoffId();
writePosManualSaleHandoff(payload, id, storage);
eq(
  readPosManualSaleHandoff(id, now + 1, storage)?.prefill.clientId,
  "C-9",
  "read handoff",
);
eq(
  readPosManualSaleHandoff(id, now + 120_000, storage),
  null,
  "expired handoff missing",
);

writePosManualSaleHandoff(payload, id, storage);
const consumed = consumePosManualSaleHandoff(id, now + 1, storage);
eq(consumed?.prefill.clientId, "C-9", "consume returns payload");
eq(storage.getItem(handoffStorageKey(id)), null, "consume clears storage");
eq(
  consumePosManualSaleHandoff(id, now + 1, storage),
  null,
  "second consume missing → empty form + modal path",
);
eq(
  POS_MANUAL_SALE_HANDOFF_MISSING_MESSAGE,
  "The POS cart could not be loaded. Please re-enter the sale.",
  "missing modal copy",
);

writePosManualSaleHandoff(payload, id, storage);
clearPosManualSaleHandoff(id, storage);
eq(storage.getItem(handoffStorageKey(id)), null, "clear removes handoff");

eq(
  formatPosManualSaleSavedToast({
    invoiceNo: "PSI-0042",
    balance: 140,
    dueDate: "2026-10-25",
  }),
  "Saved as PSI-0042 — balance GHS 140.00 due 25 Oct",
  "success toast",
);

const noDue = buildPosManualSaleHandoffPayload({
  cartLines: cart.slice(0, 1),
  clientSelect: "C-1",
  walkInName: "",
  dueDate: "2026-10-21",
  todayIso: "2026-10-21",
  dueDateSet: false,
  notes: "",
  salesRepId: "",
  paymentMethod: "Mobile Money",
  amountReceived: 10,
  saleDate: "2026-10-21",
  businessUnitId: null,
  promoCode: null,
  promoDiscount: 0,
  loyaltyDiscount: 0,
  loyaltyPointsRedeemed: 0,
  loyaltyRedeemInput: "",
  amountTendered: "10",
  selectedStoreCredit: null,
  payerPhone: "0240000000",
  nowMs: now,
});
eq(noDue.prefill.dueDate, null, "due date left for form when not set");
eq(noDue.prefill.paymentMethod, "Mobile Money", "momo method preserved");

console.log("pos manual sale handoff tests passed");
