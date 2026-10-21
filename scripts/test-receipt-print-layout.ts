import assert from "node:assert/strict";
import {
  formatReceiptPaymentMethods,
  receiptBalanceDue,
  receiptChangeDue,
  receiptPaymentStanding,
  receiptSaleTimestamp,
  settleIncomeReceiptLines,
} from "../app/dashboard/pos/receipt-settlement";
import {
  buildReceiptPageCss,
  cssWithoutPageRules,
  formatReceiptAmount,
  formatSaleDateTime,
  receiptAmountFitsPaper,
  receiptContentWidthMm,
  receiptMoneyStacks,
  receiptPaperWidthMm,
  receiptPrintCss,
  receiptPrintableWidthMm,
} from "../utils/device-print-layout";

assert.equal(receiptPaperWidthMm("58mm"), 58);
assert.equal(receiptPaperWidthMm("80mm"), 80);
assert.equal(receiptPrintableWidthMm("58mm"), 48);
assert.equal(receiptPrintableWidthMm("80mm"), 72);
assert.equal(receiptPrintableWidthMm("a4"), 210);

const measuredHeight = 92.34;
const measured = buildReceiptPageCss(
  receiptPrintableWidthMm("80mm"),
  measuredHeight,
);
assert.match(measured, /@page \{ margin: 0; size: 72mm 92\.4mm; \}/);
assert.match(measured, /height: auto/);
assert.match(measured, /overflow: visible/);
assert.doesNotMatch(measured, /max-height/);

const narrow = buildReceiptPageCss(receiptPrintableWidthMm("58mm"), 40);
assert.match(narrow, /@page \{ margin: 0; size: 48mm 40mm; \}/);

const fallback = buildReceiptPageCss(receiptPrintableWidthMm("80mm"), null);
assert.match(fallback, /@page \{ margin: 0; size: 72mm auto; \}/);

const stripped = cssWithoutPageRules(
  "@media print { @page { margin: 0; size: 80mm auto; } #receipt { width: 72mm; } }",
);
assert.doesNotMatch(stripped, /@page/);
assert.match(stripped, /#receipt \{ width: 72mm; \}/);

const dateOnly = formatSaleDateTime("2026-10-20");
assert.match(dateOnly, /20 Oct 2026/);
assert.doesNotMatch(dateOnly, /\d{2}:\d{2}/);

const withTime = formatSaleDateTime("2026-10-20T15:26:00.000Z");
assert.match(withTime, /20 Oct 2026, 15:26/);

assert.equal(formatReceiptAmount(8.5), "8.50");
assert.equal(formatReceiptAmount(12345), "12,345.00");
assert.equal(receiptMoneyStacks(8.5, "58mm"), false);
assert.equal(receiptMoneyStacks(8.5, "80mm"), false);
assert.equal(receiptMoneyStacks(12345, "58mm"), false);
assert.equal(receiptAmountFitsPaper(8.5, "58mm"), true);
assert.equal(receiptAmountFitsPaper(8.5, "80mm"), true);
assert.equal(receiptAmountFitsPaper(12345, "58mm"), true);
assert.equal(receiptAmountFitsPaper(12345, "80mm"), true);
assert.ok(receiptContentWidthMm("58mm") < receiptPrintableWidthMm("58mm"));
assert.ok(receiptContentWidthMm("80mm") < receiptPrintableWidthMm("80mm"));
const longName = "Premium Soft Drink 500ml with extra long wholesale description";
assert.ok(longName.length * 1.6 > receiptContentWidthMm("58mm"));
assert.equal(receiptAmountFitsPaper(12345, "58mm"), true);

const narrowCss = receiptPrintCss("58mm", "receipt-layout-test");
assert.match(narrowCss, /white-space: nowrap/);
assert.match(narrowCss, /receipt-money-stack/);
assert.match(narrowCss, /font-size: 9pt/);
assert.match(narrowCss, /font-size: 10pt/);
assert.match(narrowCss, /font-size: 11pt/);
assert.match(narrowCss, /receipt-item-name/);
assert.match(narrowCss, /overflow-wrap: anywhere/);
assert.match(narrowCss, /receipt-line-total/);
assert.match(narrowCss, /white-space: nowrap/);
assert.match(narrowCss, /max-width: 48mm/);
assert.doesNotMatch(narrowCss, /receipt-col-subtotal/);
assert.doesNotMatch(narrowCss, /font-size: 8px/);
assert.doesNotMatch(narrowCss, /\.receipt-money span \{ display: block/);
assert.match(narrowCss, /size: 48mm auto/);

const dfPos0029 = settleIncomeReceiptLines([
  {
    id: "return",
    notes: "Credit note DF-CRNPS-0006",
    payment_method: "Non-Cash",
    amount: -8.5,
    amount_received: 0,
    sale_quantity: 1,
    unit_price: 8.5,
    product_name: "Soft Drink 500ml",
    is_sale_return: true,
    return_mode: "store_credit",
    credit_note_number: "DF-CRNPS-0006",
    due_date: null,
    date: "2026-10-02",
    created_at: null,
  },
  {
    id: "sale",
    notes: "Payment method: Cash",
    amount: 8.5,
    amount_received: 8.5,
    sale_quantity: 1,
    unit_price: 8.5,
    product_name: "Soft Drink 500ml",
    due_date: "2026-10-02",
    date: "2026-10-02",
    created_at: null,
  },
]);
assert.equal(dfPos0029.standing, "Returned");
assert.equal(dfPos0029.subtotal, 8.5);
assert.equal(dfPos0029.returnsTotal, 8.5);
assert.equal(dfPos0029.netTotal, 0);
assert.equal(dfPos0029.amountReceived, 8.5);
assert.equal(dfPos0029.balanceDue, 0);
assert.equal(dfPos0029.changeDue, 0);
assert.equal(dfPos0029.dueDate, null);
assert.equal(dfPos0029.storeCreditIssued, 8.5);
assert.equal(dfPos0029.returnLines.length, 1);
assert.equal(dfPos0029.returnLines[0]?.amount, -8.5);
assert.equal(formatReceiptPaymentMethods([
  { notes: "Payment method: Cash", amount: 8.5, amount_received: 8.5 },
]), "Cash");

const partly = settleIncomeReceiptLines([
  {
    id: "a",
    amount: 8.5,
    amount_received: 8.5,
    sale_quantity: 1,
    unit_price: 8.5,
    product_name: "Soft Drink 500ml",
    notes: "Payment method: Cash",
  },
  {
    id: "b",
    amount: 8.5,
    amount_received: 8.5,
    sale_quantity: 1,
    unit_price: 8.5,
    product_name: "Water",
    notes: "Payment method: Cash",
  },
  {
    id: "ret",
    is_sale_return: true,
    amount: -8.5,
    amount_received: 0,
    sale_quantity: 1,
    unit_price: 8.5,
    product_name: "Water",
    credit_note_number: "DF-CRNPS-0007",
    return_mode: "store_credit",
    notes: "Credit note DF-CRNPS-0007",
  },
]);
assert.equal(partly.standing, "Partly returned");
assert.equal(partly.netTotal, 8.5);
assert.equal(partly.balanceDue, 0);
assert.equal(partly.subtotal, 17);

const partPaid = settleIncomeReceiptLines([
  {
    id: "sale",
    amount: 17,
    amount_received: 8.5,
    sale_quantity: 2,
    unit_price: 8.5,
    notes: "Payment method: Cash",
    due_date: "2026-10-20",
  },
]);
assert.equal(partPaid.standing, "Part-paid");
assert.equal(partPaid.balanceDue, 8.5);
assert.equal(partPaid.dueDate, "2026-10-20");
assert.equal(partPaid.returnsTotal, 0);

const overpaid = settleIncomeReceiptLines([
  {
    id: "sale",
    amount: 17,
    amount_received: 20,
    sale_quantity: 1,
    unit_price: 17,
    notes: "Payment method: Cash",
  },
]);
assert.equal(overpaid.standing, "Paid");
assert.equal(overpaid.changeDue, 3);
assert.equal(overpaid.balanceDue, 0);

assert.equal(receiptSaleTimestamp([
  { date: "2026-10-02", created_at: null },
]), "2026-10-02");
assert.equal(
  receiptSaleTimestamp([
    { date: "2026-10-02", created_at: "2026-10-02T15:26:00.000Z" },
  ]),
  "2026-10-02T15:26:00.000Z",
);
assert.equal(
  formatReceiptPaymentMethods([
    { notes: "Payment method: Cash", amount: 10, amount_received: 5 },
    { notes: "Payment method: Mobile Money", amount: 7, amount_received: 3.5 },
  ]),
  "Cash GHS 5.00; Mobile Money GHS 3.50",
);
assert.equal(receiptPaymentStanding(17, 17), "Paid");
assert.equal(receiptPaymentStanding(17, 0), "Unpaid");
assert.equal(receiptChangeDue(17, 20), 3);

console.log("receipt print layout ok");
