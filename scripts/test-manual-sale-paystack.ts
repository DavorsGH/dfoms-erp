/**
 * Manual sale Paystack helpers.
 *   npx tsx scripts/test-manual-sale-paystack.ts
 */
import { recordedProductSalePaymentMethod } from "../app/dashboard/crm/sales/sales-utils";
import { parsePosPaymentMethodFromNotes } from "../app/dashboard/crm/sales/sales-log-receipt-utils";
import {
  formatReceiptPaymentMethodLine,
  isManualSalePaystackSnapshot,
  isPaystackCollectMethod,
  manualSalePaymentMethodRequired,
  manualSalePaystackChargeAmount,
  notesWithPaystackReference,
  notesWithTransactionReference,
  paystackApplyErrorReason,
  paystackChannelsForMethod,
  paystackOverpaymentReason,
  paystackSaleIncomeNotes,
} from "../utils/manual-sale-paystack";

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

eq(manualSalePaymentMethodRequired(0), false, "zero paid hides the method");
eq(manualSalePaymentMethodRequired(12.5), true, "money taken now requires a method");
eq(isPaystackCollectMethod("Mobile Money"), true, "momo can collect");
eq(isPaystackCollectMethod("Card"), true, "card can collect");
eq(isPaystackCollectMethod("Cash"), false, "cash stays already received");
eq(isPaystackCollectMethod("Bank transfer"), false, "bank transfer stays already received");

eq(manualSalePaystackChargeAmount(100, 40), 40, "partial charge is the amount paid now");
eq(manualSalePaystackChargeAmount(100, 100), 100, "full charge matches the sale");
eq(manualSalePaystackChargeAmount(100, 0), null, "zero is not a Paystack charge");
eq(manualSalePaystackChargeAmount(100, 120), null, "charge cannot exceed the sale");

eq(paystackChannelsForMethod("Card").join(","), "card", "card popup is card only");
eq(
  paystackChannelsForMethod("Mobile Money").join(","),
  "mobile_money",
  "momo popup is mobile money only",
);

eq(
  notesWithTransactionReference("Payment method: Mobile Money", "MM-9"),
  "Payment method: Mobile Money\nTransaction ref: MM-9",
  "already-received reference is stored on the notes",
);
eq(
  notesWithPaystackReference("Payment method: Card", "PSTK123"),
  "Payment method: Card\nPaystack ref: PSTK123",
  "paystack reference is stored on the notes",
);
eq(
  notesWithPaystackReference("Payment method: Card\nPaystack ref: PSTK123", "OTHER"),
  "Payment method: Card\nPaystack ref: PSTK123",
  "a second webhook does not add another paystack reference",
);

const line = [{ productId: "p1", quantity: 1, unitPrice: 10 }];
eq(
  isManualSalePaystackSnapshot({
    incomeIds: [],
    invoiceNo: "PSI-0042",
    snapshot: { lines: line, salesRepId: null },
  }),
  true,
  "a manual sale is empty income ids plus lines, even when salesRepId is null",
);
eq(
  isManualSalePaystackSnapshot({
    incomeIds: [],
    invoiceNo: "LINK-PENDING-abcd1234",
    snapshot: {
      lines: line,
      manualSale: { salesRepId: null, paymentMethod: "Mobile Money", amountToCollect: 10 },
    },
  }),
  true,
  "older manual requests are still recognised by manualSale",
);
eq(
  isManualSalePaystackSnapshot({
    incomeIds: [],
    invoiceNo: "MOMO-PENDING-abcd1234",
    snapshot: { lines: line },
  }),
  false,
  "a POS till cart stays on the POS checkout path",
);

eq(
  paystackSaleIncomeNotes("Customer note", "Mobile Money", "REF1"),
  "Customer note\nPayment method: Mobile Money\nPaystack ref: REF1",
  "income notes are one fact per line",
);
eq(
  paystackOverpaymentReason(12.5, "PSI-0042"),
  "Customer paid GHS 12.50 more than was owed on PSI-0042",
  "overpayment reason names the extra amount and invoice",
);
eq(
  paystackApplyErrorReason(
    "ERROR: Only 1 unit of Widget in stock, cannot sell 2\nCONTEXT: PL/pgSQL function apply_product_sale_paystack_payment",
  ),
  "Only 1 unit of Widget in stock, cannot sell 2",
  "attention reason is the raised text without the Postgres prefix",
);

const newlineNotes = "Payment method: Mobile Money\nPaystack ref: REF1";
eq(
  recordedProductSalePaymentMethod({ notes: newlineNotes }),
  "Mobile Money",
  "the payment method reader accepts newline-separated notes",
);
eq(
  parsePosPaymentMethodFromNotes(newlineNotes),
  "Mobile Money",
  "the receipt parser accepts newline-separated notes",
);
eq(
  formatReceiptPaymentMethodLine("Mobile Money", newlineNotes),
  "Paid via Paystack (Mobile Money) · ref REF1",
  "the receipt tender line reads a Paystack ref on its own line",
);

assert(true, "helpers loaded");
console.log("manual sale paystack tests passed");
