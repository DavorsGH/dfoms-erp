import assert from "node:assert/strict";
import {
  buildReceiptPaymentLines,
  formatReceiptListedPayment,
  receiptPreviewFingerprint,
  sumReceiptListedPayments,
} from "../app/dashboard/pos/receipt-settlement";

// DF-PSI-0008: sale 25, 20 paid at sale (20 Oct), 5 Cash later (21 Oct).
const dfPsi0008 = buildReceiptPaymentLines(
  [
    {
      id: "inc-1",
      date: "2026-10-20",
      amount: 25,
      amount_received: 25,
      payment_method: "Cash",
      notes: "Payment method: Mobile Money",
    },
  ],
  [
    {
      income_id: "inc-1",
      payment_date: "2026-10-21",
      payment_method: "Cash",
      amount: 5,
      notes: null,
    },
  ],
);
assert.equal(dfPsi0008.length, 2);
assert.equal(formatReceiptListedPayment(dfPsi0008[0]), "20 Oct · Mobile Money · GHS 20.00");
assert.equal(formatReceiptListedPayment(dfPsi0008[1]), "21 Oct · Cash · GHS 5.00");
assert.equal(sumReceiptListedPayments(dfPsi0008), 25);

// No "Payment method:" note: fallback is Cash.
const fallbackCash = buildReceiptPaymentLines(
  [{ id: "inc-1", date: "2026-10-20", amount: 25, amount_received: 25, notes: null }],
  [{ income_id: "inc-1", payment_date: "2026-10-21", payment_method: "Cash", amount: 5 }],
);
assert.equal(fallbackCash[0].method, "Cash");
assert.equal(fallbackCash[0].amount, 20);
assert.equal(sumReceiptListedPayments(fallbackCash), 25);

// Fully paid at sale: exactly one line.
const fullyPaid = buildReceiptPaymentLines(
  [
    {
      id: "inc-2",
      date: "2026-10-20",
      amount: 25,
      amount_received: 25,
      notes: "Payment method: Cash",
    },
  ],
  [],
);
assert.equal(fullyPaid.length, 1);
assert.equal(fullyPaid[0].amount, 25);
assert.equal(formatReceiptListedPayment(fullyPaid[0]), "20 Oct · Cash · GHS 25.00");

// Paystack already has a payment row: not double-counted.
const paystackRow = buildReceiptPaymentLines(
  [
    {
      id: "inc-3",
      date: "2026-10-20",
      amount: 30,
      amount_received: 30,
      notes: "Payment method: Mobile Money\nPaystack ref: abc123",
    },
  ],
  [
    {
      income_id: "inc-3",
      payment_date: "2026-10-20",
      payment_method: "Mobile Money",
      amount: 30,
      notes: "Paystack ref: abc123",
    },
  ],
);
assert.equal(paystackRow.length, 1);
assert.equal(sumReceiptListedPayments(paystackRow), 30);
assert.equal(paystackRow[0].reference, "abc123");

// Multi-line invoice: at-sale residuals merge, later payments sum across rows.
const multiLine = buildReceiptPaymentLines(
  [
    { id: "a", date: "2026-10-20", amount: 10, amount_received: 10, notes: "Payment method: Cash" },
    { id: "b", date: "2026-10-20", amount: 15, amount_received: 15, notes: "Payment method: Cash" },
  ],
  [
    { income_id: "b", payment_date: "2026-10-22", payment_method: "Cash", amount: 5 },
    { income_id: "a", payment_date: "2026-10-21", payment_method: "Bank transfer", amount: 4 },
  ],
);
assert.equal(sumReceiptListedPayments(multiLine), 25);
assert.deepEqual(
  multiLine.map((line) => [line.date, line.method, line.amount]),
  [
    ["2026-10-20", "Cash", 16],
    ["2026-10-21", "Bank transfer", 4],
    ["2026-10-22", "Cash", 5],
  ],
);

// Unpaid sale with nothing received: no lines.
assert.equal(
  buildReceiptPaymentLines(
    [{ id: "u", date: "2026-10-20", amount: 25, amount_received: 0, notes: null }],
    [],
  ).length,
  0,
);

// Return rows never add a payment line.
const withReturn = buildReceiptPaymentLines(
  [
    { id: "s", date: "2026-10-20", amount: 8.5, amount_received: 8.5, notes: "Payment method: Cash" },
    {
      id: "r",
      date: "2026-10-21",
      amount: -8.5,
      amount_received: 0,
      is_sale_return: true,
      notes: "Credit note DF-CRNPS-0006",
    },
  ],
  [],
);
assert.equal(withReturn.length, 1);

// Preview fingerprint: stable for the same receipt, changes with totals.
const base = { invoiceNo: "DF-PSI-0008", lineCount: 3, totals: [25, 25, 0, "Paid"] };
assert.equal(receiptPreviewFingerprint(base), receiptPreviewFingerprint({ ...base }));
assert.notEqual(
  receiptPreviewFingerprint(base),
  receiptPreviewFingerprint({ ...base, totals: [25, 20, 5, "Part-paid"] }),
);

console.log("receipt payments ok");
