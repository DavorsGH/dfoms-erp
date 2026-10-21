/**
 * Legacy Payment Settings URL redirects to Online Payments.
 *   npx tsx scripts/test-online-payments-redirect.ts
 */
import assert from "node:assert/strict";
import {
  LEGACY_PAYMENT_SETTINGS_HREF,
  ONLINE_PAYMENTS_HREF,
  PAYMENT_SETTINGS_HREF,
} from "../utils/product-sale-paystack";
import { ADMINISTRATION_GROUPS } from "../app/dashboard/administration/administration-nav-config";
import { isDirectorAdministrationPath } from "../app/dashboard/administration/administration-access";

assert.equal(
  PAYMENT_SETTINGS_HREF,
  ONLINE_PAYMENTS_HREF,
  "PAYMENT_SETTINGS_HREF aliases Online Payments",
);
assert.notEqual(
  LEGACY_PAYMENT_SETTINGS_HREF,
  ONLINE_PAYMENTS_HREF,
  "legacy billing?tab=payment is distinct from Online Payments",
);
assert.match(LEGACY_PAYMENT_SETTINGS_HREF, /billing\?tab=payment$/);

const finance = ADMINISTRATION_GROUPS.find((g) => g.id === "finance-settings");
assert(finance, "Finance Settings group exists");
const labels = finance.items.map((item) => item.label);
const paymentAccountsIdx = labels.indexOf("Payment Accounts");
const onlinePaymentsIdx = labels.indexOf("Online Payments");
assert(paymentAccountsIdx >= 0, "Payment Accounts in Finance Settings");
assert(onlinePaymentsIdx >= 0, "Online Payments in Finance Settings");
assert.equal(
  onlinePaymentsIdx,
  paymentAccountsIdx + 1,
  "Online Payments sits directly after Payment Accounts",
);
assert.deepEqual(
  labels,
  [
    "Expense Categories",
    "Payment Methods",
    "Payment Accounts",
    "Online Payments",
    "VAT/WHT Calculation Basis",
    "Asset Categories",
    "Depreciation Methods",
    "Inventory Go-Live",
    "Approvers",
  ],
  "Finance Settings tab order",
);

assert(
  isDirectorAdministrationPath("/dashboard/administration/online-payments"),
  "directors can open Online Payments",
);

console.log("OK: online payments redirect / nav tests passed");
