/**
 * Payment account in-use delete messaging + app-wide FK formatter.
 *   npx tsx scripts/test-payment-account-in-use-delete.ts
 */
import assert from "node:assert/strict";
import { formatActionError } from "../components/feedback/format-action-error";
import {
  PAYMENT_ACCOUNT_IN_USE_CODE,
  PAYMENT_ACCOUNT_IN_USE_TITLE,
  buildPaymentAccountUsageSummary,
  formatPaymentAccountInUseBody,
} from "../utils/payment-account-usage";
import {
  formatFriendlyForeignKeyDeleteMessage,
  looksLikeRawPostgresForeignKeyError,
  resolveApiDeleteErrorMessage,
  tryFormatRawForeignKeyDeleteMessage,
} from "../utils/postgres-fk-violation";

// --- Used account → modal body (no delete) ---
const used = buildPaymentAccountUsageSummary({
  "salary advances": 2,
});
assert.equal(used.total, 2);
assert.deepEqual(used.labels, ["salary advances"]);

const body = formatPaymentAccountInUseBody({
  accountName: "Release 1 staging cash",
  usage: used,
});
assert.match(body, /Release 1 staging cash is linked to 2 salary advances/);
assert.match(body, /for example salary advances/);
assert.match(body, /can't be deleted/);
assert.match(body, /Deactivate it instead/);
assert.equal(PAYMENT_ACCOUNT_IN_USE_TITLE, "This account is in use");
assert.equal(PAYMENT_ACCOUNT_IN_USE_CODE, "payment_account_in_use");

// Unused → zero usage (delete allowed)
const unused = buildPaymentAccountUsageSummary({});
assert.equal(unused.total, 0);

// Multi-type
const multi = buildPaymentAccountUsageSummary({
  "salary advances": 1,
  invoices: 3,
});
assert.equal(multi.total, 4);
assert.deepEqual(multi.labels, ["salary advances", "invoices"]);
assert.match(
  formatPaymentAccountInUseBody({
    accountName: "Ops MoMo",
    usage: multi,
  }),
  /Ops MoMo is linked to 4 salary advances, invoices/,
);

// --- Forced 23503 on another screen → friendly text ---
const rawFk =
  'update or delete on table "payment_accounts" violates foreign key constraint "salary_advance_register_payment_account_id_fkey" on table "salary_advance_register"';

assert.equal(looksLikeRawPostgresForeignKeyError(rawFk), true);

const friendly = formatFriendlyForeignKeyDeleteMessage(rawFk, {
  itemName: "Release 1 staging cash",
});
assert.match(friendly, /Release 1 staging cash is linked to salary advances/);
assert.doesNotMatch(friendly, /salary_advance_register_payment_account_id_fkey/);
assert.doesNotMatch(friendly, /violates foreign key/);

assert.equal(
  tryFormatRawForeignKeyDeleteMessage(rawFk, { itemName: "Widget" })?.includes(
    "Widget",
  ),
  true,
);

assert.equal(
  formatActionError(rawFk, { itemName: "Cash till" }).includes("Cash till"),
  true,
);
assert.doesNotMatch(
  formatActionError(rawFk),
  /violates foreign key constraint/,
);

assert.equal(
  formatActionError({
    code: "23503",
    message: rawFk,
  }).includes("linked to"),
  true,
);

assert.match(
  resolveApiDeleteErrorMessage(
    { code: "23503", message: rawFk },
    { itemName: "This supplier" },
  ),
  /This supplier is linked to salary advances/,
);

assert.equal(
  resolveApiDeleteErrorMessage(
    { code: "PGRST116", message: "JSON object requested, multiple (or no) rows returned" },
    { itemName: "This purchase" },
  ),
  "JSON object requested, multiple (or no) rows returned",
);

console.log("OK: payment account in-use delete tests passed");
