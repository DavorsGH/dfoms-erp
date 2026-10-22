/**
 * Paystack attention and receipt payment-line helpers.
 *   npx tsx --conditions=react-server scripts/test-paystack-payment-attention.ts
 */
import { formatReceiptListedPayment } from "../app/dashboard/pos/receipt-settlement";
import { manualSaleStockShortageMessage } from "../utils/manual-sale-stock-check";
import {
  isMissingPaystackAttentionTable,
  paystackAttentionMessage,
  type PaystackAttentionStatus,
} from "../utils/paystack-payment-attention";
import { isMissingPaystackApplyFunction } from "../utils/paystack-payment-apply";
import {
  PAYSTACK_ATTENTION_ACTIONS,
  PAYSTACK_ATTENTION_SALE_RETIRED,
  paystackAttentionActionRefusal,
} from "../utils/paystack-attention-resolve";
import { canResolvePaystackAttention } from "../utils/rbac-access";

function eq(actual: unknown, expected: unknown, message: string) {
  if (actual !== expected) {
    throw new Error(
      `${message}: expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
    );
  }
}

eq(
  manualSaleStockShortageMessage({
    productName: "Soap",
    unit: "pcs",
    available: 2,
    requested: 5,
  }),
  "Only 2 pcs of Soap in stock, cannot sell 5.",
  "stock shortage sentence",
);

eq(
  isMissingPaystackApplyFunction({ code: "PGRST202", message: "schema cache" }),
  true,
  "missing apply function by code",
);
eq(
  isMissingPaystackApplyFunction({
    code: "23505",
    message: "duplicate key",
  }),
  false,
  "a real apply error is not missing",
);

eq(
  isMissingPaystackAttentionTable({ code: "42P01", message: "relation" }),
  true,
  "missing attention table",
);
eq(
  isMissingPaystackAttentionTable({ code: "23505", message: "duplicate" }),
  false,
  "duplicate attention row is not a missing table",
);

const stored = paystackAttentionMessage({
  amount: 50,
  reference: "REF1",
  customer: "Ama",
  reason: "Only 0 pcs of Soap in stock, cannot sell 1.",
  stored: true,
});
if (!stored.includes("Payments needing attention")) {
  throw new Error("stored payment must point at the attention list");
}
if (!stored.includes("REF1") || !stored.includes("50.00")) {
  throw new Error("stored payment must keep the reference and amount");
}

const unstored = paystackAttentionMessage({
  amount: 50,
  reference: "REF1",
  customer: "Ama",
  reason: "Could not record the manual sale.",
  stored: false,
});
if (!unstored.includes("The attention list is not installed yet. Keep this Paystack reference.")) {
  throw new Error("unstored payment must keep the reference in the error");
}

eq(
  formatReceiptListedPayment({
    date: "2026-10-20",
    method: "Mobile Money",
    amount: 50,
    reference: "REF1",
  }),
  "20 Oct · Mobile Money · GHS 50.00 · ref REF1",
  "receipt payment line",
);

eq(canResolvePaystackAttention("operations_manager"), false, "operations manager cannot resolve");
eq(canResolvePaystackAttention("sales_rep"), false, "sales rep cannot resolve");
eq(canResolvePaystackAttention("super_admin"), true, "super admin can resolve");
eq(canResolvePaystackAttention("director"), true, "director can resolve");
eq(canResolvePaystackAttention("finance_admin"), true, "finance admin can resolve");
eq(canResolvePaystackAttention("finance"), false, "finance cannot resolve");

eq(
  PAYSTACK_ATTENTION_ACTIONS.join(","),
  "store_credit,refunded",
  "only store credit and refunded can be chosen",
);
eq(paystackAttentionActionRefusal("store_credit"), null, "store credit is allowed");
eq(paystackAttentionActionRefusal("refunded"), null, "refunded is allowed");
eq(
  paystackAttentionActionRefusal("sale")?.status,
  400,
  "sale returns 400",
);
eq(
  paystackAttentionActionRefusal("sale")?.error,
  PAYSTACK_ATTENTION_SALE_RETIRED,
  "sale explains the action is no longer available",
);

const recordedSale: PaystackAttentionStatus = "recorded_sale";
eq(recordedSale, "recorded_sale", "an existing recorded_sale row stays a valid status");

console.log("paystack payment attention tests passed");
