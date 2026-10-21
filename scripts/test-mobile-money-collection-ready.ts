/**
 * Mobile Money collection readiness helpers (UI + server messages).
 *   npx tsx scripts/test-mobile-money-collection-ready.ts
 */
import assert from "node:assert/strict";
import {
  LEGACY_PAYMENT_SETTINGS_HREF,
  MOBILE_MONEY_NOT_SETUP_ADMIN_HINT,
  MOBILE_MONEY_NOT_SETUP_BODY,
  MOBILE_MONEY_NOT_SETUP_TITLE,
  ONLINE_PAYMENTS_HREF,
  PAYMENT_SETTINGS_HREF,
  PAYMENT_SETTINGS_REQUIRED_CODE,
  PAYMENT_SETTINGS_REQUIRED_MESSAGE,
  SETTLEMENT_VERIFICATION_MAX_AGE_MS,
  buildMobileMoneyStatusAssistantPayload,
  canShowMobileMoneyPaymentSettingsHint,
  claimSettlementVerificationSlot,
  isSettlementSubaccountReady,
  isSettlementVerificationStale,
  mobileMoneyPaymentMethodOptionLabel,
  onlinePaymentsConnectionStatusLabel,
  releaseSettlementVerificationSlot,
  resetSettlementVerificationInFlightForTests,
  resolveOnlinePaymentsConnectionStatus,
  shouldScheduleSettlementVerification,
} from "../utils/product-sale-paystack";

// --- Caanta-like: active + code but verification failed → not ready ---
assert.equal(
  isSettlementSubaccountReady({
    paystack_subaccount_status: "active",
    paystack_subaccount_code: "ACCT_missing",
    paystack_subaccount_verified_ok: false,
    paystack_subaccount_last_verified_at: new Date().toISOString(),
  }),
  false,
  "Caanta: active + not found (verified_ok false) → not ready",
);
assert.equal(
  resolveOnlinePaymentsConnectionStatus({
    paystack_subaccount_status: "active",
    paystack_subaccount_code: "ACCT_missing",
    paystack_subaccount_verified_ok: false,
  }),
  "needs_attention",
  "Caanta UI: Needs attention (never Active + Subaccount not found)",
);

// --- Never verified yet (null) → ready + Checking + schedule ---
assert.equal(
  isSettlementSubaccountReady({
    paystack_subaccount_status: "active",
    paystack_subaccount_code: "ACCT_x",
    paystack_subaccount_verified_ok: null,
  }),
  true,
  "active + code + never verified (NULL) → ready (must not block after deploy)",
);
assert.equal(
  resolveOnlinePaymentsConnectionStatus({
    paystack_subaccount_status: "active",
    paystack_subaccount_code: "ACCT_x",
    paystack_subaccount_verified_ok: null,
  }),
  "checking",
  "NULL verified_ok UI: Checking",
);
assert.equal(
  onlinePaymentsConnectionStatusLabel("checking"),
  "Checking",
);
assert.equal(
  isSettlementVerificationStale(null),
  true,
  "never checked (null lastVerifiedAt) → stale → background check scheduled by callers",
);
assert.equal(
  shouldScheduleSettlementVerification(null),
  true,
  "NULL → check should be scheduled",
);
resetSettlementVerificationInFlightForTests();
assert.equal(
  claimSettlementVerificationSlot("tenant-null-ready"),
  true,
  "NULL → check scheduled (slot claimed)",
);
assert.equal(
  claimSettlementVerificationSlot("tenant-null-ready"),
  false,
  "no repeated schedule while in-flight",
);
releaseSettlementVerificationSlot("tenant-null-ready");
resetSettlementVerificationInFlightForTests();

// --- Verified account → ready ---
assert.equal(
  isSettlementSubaccountReady({
    paystack_subaccount_status: "active",
    paystack_subaccount_code: "ACCT_ok",
    paystack_subaccount_verified_ok: true,
    paystack_subaccount_last_verified_at: new Date().toISOString(),
  }),
  true,
  "verified account → ready",
);
assert.equal(
  resolveOnlinePaymentsConnectionStatus({
    paystack_subaccount_status: "active",
    paystack_subaccount_code: "ACCT_ok",
    paystack_subaccount_verified_ok: true,
  }),
  "connected",
  "verified UI: Connected",
);

// --- Stale verification still ready (background re-check, not a block) ---
const eightDaysAgo = new Date(
  Date.now() - SETTLEMENT_VERIFICATION_MAX_AGE_MS - 24 * 60 * 60 * 1000,
).toISOString();
assert.equal(
  isSettlementVerificationStale(eightDaysAgo),
  true,
  "verification older than 7 days is stale",
);
assert.equal(
  isSettlementSubaccountReady({
    paystack_subaccount_status: "active",
    paystack_subaccount_code: "ACCT_ok",
    paystack_subaccount_verified_ok: true,
    paystack_subaccount_last_verified_at: eightDaysAgo,
  }),
  true,
  "stale verified_ok still ready (re-check is background only)",
);
assert.equal(
  isSettlementVerificationStale(eightDaysAgo),
  true,
  "stale (>7 days) → background check scheduled by callers",
);
assert.equal(
  isSettlementVerificationStale(new Date().toISOString()),
  false,
  "fresh verification is not stale",
);

// --- Classic not-setup cases ---
assert.equal(
  isSettlementSubaccountReady({
    paystack_subaccount_status: "pending",
    paystack_subaccount_code: "ACCT_x",
    paystack_subaccount_verified_ok: true,
  }),
  false,
  "pending → not ready",
);
assert.equal(
  isSettlementSubaccountReady({
    paystack_subaccount_status: "active",
    paystack_subaccount_code: "  ",
    paystack_subaccount_verified_ok: true,
  }),
  false,
  "blank code → not ready",
);
assert.equal(
  isSettlementSubaccountReady({
    paystack_subaccount_status: "not_setup",
    paystack_subaccount_code: null,
    paystack_subaccount_verified_ok: null,
  }),
  false,
  "not_setup → not ready",
);
assert.equal(
  resolveOnlinePaymentsConnectionStatus({
    paystack_subaccount_status: "not_setup",
    paystack_subaccount_code: null,
    paystack_subaccount_verified_ok: null,
  }),
  "not_connected",
  "not_setup UI: Not connected",
);

assert.equal(
  mobileMoneyPaymentMethodOptionLabel(false),
  "Mobile Money (not set up)",
  "Add sale option label when blocked",
);
assert.equal(
  mobileMoneyPaymentMethodOptionLabel(true),
  "Mobile Money",
  "Add sale option label when ready",
);

assert.equal(
  canShowMobileMoneyPaymentSettingsHint("super_admin"),
  true,
  "super_admin sees Online Payments hint",
);
assert.equal(
  canShowMobileMoneyPaymentSettingsHint("director"),
  true,
  "director sees Online Payments hint",
);
assert.equal(
  canShowMobileMoneyPaymentSettingsHint("hr"),
  false,
  "hr does not see admin hint",
);
assert.equal(
  canShowMobileMoneyPaymentSettingsHint("cashier"),
  false,
  "cashier does not see admin hint",
);
assert.equal(
  canShowMobileMoneyPaymentSettingsHint(null),
  false,
  "null role no hint",
);

assert.equal(
  PAYMENT_SETTINGS_REQUIRED_MESSAGE,
  MOBILE_MONEY_NOT_SETUP_BODY,
  "server 409 uses the same body as the modal",
);
assert.equal(PAYMENT_SETTINGS_REQUIRED_CODE, "payment_settings_required");
assert.match(MOBILE_MONEY_NOT_SETUP_TITLE, /isn't set up yet/i);
assert.match(MOBILE_MONEY_NOT_SETUP_BODY, /Cash payment/i);
assert.match(
  MOBILE_MONEY_NOT_SETUP_ADMIN_HINT,
  /Finance Settings → Online Payments/,
);
assert.equal(ONLINE_PAYMENTS_HREF, "/dashboard/administration/online-payments");
assert.equal(PAYMENT_SETTINGS_HREF, ONLINE_PAYMENTS_HREF);
assert.equal(
  LEGACY_PAYMENT_SETTINGS_HREF,
  "/dashboard/administration/billing?tab=payment",
  "legacy URL constant preserved for redirect tests",
);

// --- Assistant: Why can't I take Mobile Money? (verified_ok = false) ---
const needsAttention = buildMobileMoneyStatusAssistantPayload({
  paystack_subaccount_status: "active",
  paystack_subaccount_code: "ACCT_missing",
  paystack_subaccount_verified_ok: false,
  paystack_subaccount_last_verified_at: "2026-10-21T08:00:00.000Z",
  paystack_subaccount_last_verify_error: "Subaccount not found",
  role: "super_admin",
});
assert.equal(needsAttention.status, "needs_attention");
assert.equal(needsAttention.statusLabel, "Needs attention");
assert.equal(needsAttention.ready, false);
assert.equal(needsAttention.reason, "Subaccount not found");
assert.equal(
  needsAttention.paymentSettingsPath,
  ONLINE_PAYMENTS_HREF,
  "admin path for Why can't I take Mobile Money?",
);
assert.match(
  needsAttention.message,
  /Administration → Finance Settings → Online Payments/,
);

const cashierNeedsAttention = buildMobileMoneyStatusAssistantPayload({
  paystack_subaccount_status: "active",
  paystack_subaccount_code: "ACCT_missing",
  paystack_subaccount_verified_ok: false,
  paystack_subaccount_last_verify_error: "Subaccount not found",
  role: "cashier",
});
assert.equal(cashierNeedsAttention.status, "needs_attention");
assert.equal(
  cashierNeedsAttention.paymentSettingsPath,
  undefined,
  "cashier does not get Online Payments path",
);
assert.doesNotMatch(
  cashierNeedsAttention.message,
  /Online Payments/,
  "cashier message omits admin path",
);

const checkingPayload = buildMobileMoneyStatusAssistantPayload({
  paystack_subaccount_status: "active",
  paystack_subaccount_code: "ACCT_x",
  paystack_subaccount_verified_ok: null,
  role: "sales_rep",
});
assert.equal(checkingPayload.status, "checking");
assert.equal(checkingPayload.ready, true);

console.log("OK: mobile money collection ready tests passed");
