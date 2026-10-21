/**
 * Sales register display: payment method is never the channel name "Product Sale".
 *   npx tsx scripts/test-sales-register-view.ts
 */
import type { ProductSaleEntry } from "../app/dashboard/crm/product-sales-utils";
import { recordedProductSalePaymentMethod } from "../app/dashboard/crm/sales/sales-utils";
import { notesWithPaymentMethod } from "../utils/product-sale-payments-types";
import {
  buildSalesRegisterRows,
  formatCompactPaymentMethod,
  formatRegisterItemsCompact,
  formatSalesRegisterClock,
  formatSalesRegisterDayMonth,
  formatSalesRegisterPosTime,
  resolveReceiptPaymentMethod,
  resolveStoredProductSalePaymentMethod,
  salesRegisterDefaultView,
  salesRegisterManualStatus,
  salesRegisterPosStatus,
  salesRegisterRowIncludedInCounts,
  salesRegisterRowPassesCancelledFilter,
  type SalesRegisterReceiptRow,
} from "../app/dashboard/crm/sales/sales-register-utils";
import { formatReceiptPaymentMethodLine } from "../utils/manual-sale-paystack";

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) {
    throw new Error(message);
  }
}

function eq(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(`${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
  }
}

function line(
  overrides: Partial<ProductSaleEntry> & Pick<ProductSaleEntry, "id" | "invoice_no">,
): ProductSaleEntry {
  return {
    payment_method: null,
    notes: null,
    amount: 100,
    amount_received: 0,
    outstanding_balance: 100,
    payment_status: "Pending",
    date: "2026-10-10",
    created_at: "2026-10-10T14:05:00.000Z",
    sale_status: "active",
    is_sale_return: false,
    sale_quantity: 1,
    product: { product_code: "SD", product_name: "Soft Drink 500ml" },
    ...overrides,
  } as ProductSaleEntry;
}

function receipt(overrides: Partial<SalesRegisterReceiptRow>): SalesRegisterReceiptRow {
  return {
    kind: "receipt",
    rowKey: "receipt-1",
    invoiceNo: "DF-PSI-0005",
    date: "2026-10-01",
    customerLabel: "University of Ghana Medical Center",
    clientId: null,
    itemsSummary: "Soft Drink 500ml ×1",
    totalAmount: 1200,
    totalReceived: 700,
    totalOutstanding: 500,
    paymentStatus: "Partial",
    paymentMethod: "—",
    source: "manual",
    salesRepLabel: "—",
    status: "active",
    creditNoteNumbers: [],
    dueDate: "2026-10-01",
    saleTimestamp: "2026-10-01T10:00:00.000Z",
    lines: [],
    businessUnitId: null,
    voided: false,
    ...overrides,
  };
}

const emptyMethod = resolveStoredProductSalePaymentMethod(
  line({ id: "1", invoice_no: "DF-PSI-0005", payment_method: null }),
);
eq(emptyMethod, "—", "empty PSI payment_method");

eq(
  resolveStoredProductSalePaymentMethod(
    line({ id: "2", invoice_no: "DF-PSI-0005", payment_method: "Product Sale" }),
  ),
  "—",
  "channel label Product Sale",
);

eq(
  resolveStoredProductSalePaymentMethod(
    line({ id: "3", invoice_no: "DF-POS-0001", payment_method: "POS" }),
  ),
  "—",
  "channel label POS",
);

eq(
  resolveStoredProductSalePaymentMethod(
    line({ id: "4", invoice_no: "DF-PSI-0005", payment_method: "Cash" }),
  ),
  "Cash",
  "stored Cash",
);

eq(
  resolveStoredProductSalePaymentMethod(
    line({
      id: "5",
      invoice_no: "DF-POS-0001",
      payment_method: "",
      notes: "Payment method: Cash",
    }),
  ),
  "Cash",
  "notes payment method",
);

const fromPayments = resolveReceiptPaymentMethod(
  [line({ id: "psi-5", invoice_no: "DF-PSI-0005", payment_method: "Product Sale" })],
  new Map([["psi-5", ["Cash"]]]),
);
eq(fromPayments, "Cash", "product_sale_payments wins over Product Sale");

eq(
  resolveReceiptPaymentMethod(
    [line({ id: "psi-6", invoice_no: "DF-PSI-0005", payment_method: null })],
    new Map(),
  ),
  "—",
  "no recorded method",
);

eq(formatCompactPaymentMethod("Mobile Money"), "MoMo", "compact MoMo");
eq(formatCompactPaymentMethod("Product Sale"), "—", "compact rejects Product Sale");
eq(formatCompactPaymentMethod("—"), "—", "compact dash");

eq(
  formatRegisterItemsCompact([
    line({ id: "a", invoice_no: "DF-POS-1", sale_quantity: 1 }),
  ]),
  "Soft Drink 500ml ×1",
  "single item",
);

eq(
  formatRegisterItemsCompact([
    line({
      id: "b",
      invoice_no: "DF-POS-2",
      product: {
        product_code: "OS",
        product_name: "Opening Stock Test",
      } as ProductSaleEntry["product"],
    }),
    line({ id: "c", invoice_no: "DF-POS-2" }),
    line({ id: "d", invoice_no: "DF-POS-2" }),
  ]),
  "Opening Stock Test +2",
  "extra items",
);

eq(formatSalesRegisterDayMonth("2026-10-10"), "10 Oct", "day month");
eq(formatSalesRegisterClock("2026-10-10T16:23:00.000Z"), "16:23", "Accra clock");

const overdue = salesRegisterManualStatus(receipt({}), "2026-10-11");
eq(overdue.label, "Overdue 10 days", "overdue label");
eq(overdue.tone, "overdue", "overdue tone");

const partPaid = salesRegisterManualStatus(
  receipt({ dueDate: "2026-10-20", paymentStatus: "Partial" }),
  "2026-10-11",
);
eq(partPaid.label, "Part-paid", "part-paid");
eq(partPaid.tone, "part", "part-paid tone");

const paid = salesRegisterManualStatus(
  receipt({
    paymentStatus: "Paid",
    totalOutstanding: 0,
    totalReceived: 1200,
    dueDate: null,
  }),
  "2026-10-11",
);
eq(paid.label, "Paid", "paid");
eq(paid.tone, "paid", "paid tone");

const returned = salesRegisterPosStatus(
  receipt({
    source: "pos",
    invoiceNo: "DF-POS-0029",
    status: "returned",
    creditNoteNumbers: ["CN-0006"],
    paymentMethod: "Mobile Money",
  }),
);
eq(returned.label, "Returned · CN-0006", "returned credit note");
eq(returned.tone, "returned", "returned tone");

eq(salesRegisterDefaultView("sales_rep"), "pos", "sales rep default");
eq(salesRegisterDefaultView("director"), "all", "director default");

const rows = buildSalesRegisterRows({
  incomeEntries: [
    line({
      id: "psi-0005",
      invoice_no: "DF-PSI-0005",
      payment_method: "Product Sale",
      payment_status: "Pending",
      amount: 1200,
      amount_received: 0,
      outstanding_balance: 1200,
    }),
  ],
  webhookSales: [],
  returnedQtyByIncomeId: new Map(),
  refundsByCreditNoteId: new Map(),
  employees: [],
  clients: [],
  includeDigitalRows: false,
  getCustomerLabel: () => "University of Ghana Medical Center",
  paymentsByIncomeId: new Map(),
});
const built = rows.find((row) => row.kind === "receipt");
assert(built && built.kind === "receipt", "built receipt");
eq(built.paymentMethod, "—", "built receipt hides Product Sale");
eq(built.source, "manual", "PSI is a manual sale");
const builtStatus = salesRegisterManualStatus(built, "2026-10-20");
eq(builtStatus.label, "Unpaid", "unpaid when no method was recorded");

eq(
  formatSalesRegisterPosTime("2026-10-20", "2026-10-20", true),
  "20 Oct",
  "date when no clock is stored",
);
eq(
  formatSalesRegisterPosTime("2026-10-20T16:23:00.000Z", "2026-10-20", true),
  "16:23",
  "clock only while Today is on",
);
eq(
  formatSalesRegisterPosTime("2026-10-20T16:23:00.000Z", "2026-10-20", false),
  "20 Oct · 16:23",
  "date and clock when Today is off",
);

eq(
  recordedProductSalePaymentMethod({
    payment_method: null,
    notes: "Payment method: Mobile Money\nWalk-in",
  }),
  "Mobile Money",
  "log uses the notes method",
);
eq(
  recordedProductSalePaymentMethod({
    payment_method: "Product Sale",
    notes: null,
  }),
  "—",
  "log does not label PSI as Product Sale",
);
eq(
  notesWithPaymentMethod("Customer asked for a receipt", "Cash"),
  "Payment method: Cash\nCustomer asked for a receipt",
  "manual sale notes line",
);
eq(
  notesWithPaymentMethod("Payment method: Card\nKept", "Cash"),
  "Payment method: Card\nKept",
  "existing method line is kept",
);

const activeSale = receipt({ invoiceNo: "DF-PSI-0001", voided: false, status: "active" });
const cancelledSale = receipt({
  rowKey: "receipt-void",
  invoiceNo: "DF-PSI-0002",
  voided: true,
  status: "voided",
});
eq(
  salesRegisterRowIncludedInCounts(activeSale),
  true,
  "active sale counts",
);
eq(
  salesRegisterRowIncludedInCounts(cancelledSale),
  false,
  "cancelled sale is excluded from counts",
);
eq(
  salesRegisterRowPassesCancelledFilter(cancelledSale, ""),
  false,
  "cancelled sale is hidden until the status filter asks for it",
);
eq(
  salesRegisterRowPassesCancelledFilter(cancelledSale, "Cancelled"),
  true,
  "cancelled status filter shows cancelled sales",
);
eq(
  salesRegisterRowPassesCancelledFilter(activeSale, "Cancelled"),
  false,
  "cancelled filter hides active sales",
);
eq(
  salesRegisterManualStatus(cancelledSale, "2026-10-20").label,
  "Cancelled",
  "voided receipt is labelled Cancelled",
);
eq(
  formatReceiptPaymentMethodLine(
    "Mobile Money",
    "Payment method: Mobile Money\nPaystack ref: PSTK123",
  ),
  "Paid via Paystack (Mobile Money) · ref PSTK123",
  "receipt paystack line",
);
eq(
  formatReceiptPaymentMethodLine(
    "Mobile Money",
    "Payment method: Mobile Money\nTransaction ref: MM-9",
  ),
  "Mobile Money · ref MM-9",
  "receipt already-received reference",
);

console.log("sales register view tests passed");
