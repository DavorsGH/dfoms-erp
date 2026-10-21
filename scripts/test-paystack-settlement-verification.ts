/**
 * Nightly settlement verification summary behaviour (pure helpers).
 *   npx tsx scripts/test-paystack-settlement-verification.ts
 *
 * Mirrors how the reconciliation job flips readiness after a failed verify:
 * previously verified_ok true + Paystack error → verified_ok false → not ready.
 */
import assert from "node:assert/strict";
import {
  claimSettlementVerificationSlot,
  isSettlementSubaccountReady,
  isSettlementVerificationStale,
  releaseSettlementVerificationSlot,
  resetSettlementVerificationInFlightForTests,
  resolveOnlinePaymentsConnectionStatus,
  shouldScheduleSettlementVerification,
} from "../utils/product-sale-paystack";

type SettlementRow = {
  paystack_subaccount_status: string;
  paystack_subaccount_code: string;
  paystack_subaccount_verified_ok: boolean | null;
  paystack_subaccount_last_verified_at: string | null;
  paystack_subaccount_last_verify_error: string | null;
};

/** Apply a nightly verification outcome onto a settlement row (test double). */
function applyNightlyVerification(
  row: SettlementRow,
  outcome: { ok: true } | { ok: false; error: string },
  nowIso: string,
): SettlementRow {
  if (outcome.ok) {
    return {
      ...row,
      paystack_subaccount_verified_ok: true,
      paystack_subaccount_last_verified_at: nowIso,
      paystack_subaccount_last_verify_error: null,
    };
  }
  return {
    ...row,
    paystack_subaccount_verified_ok: false,
    paystack_subaccount_last_verified_at: nowIso,
    paystack_subaccount_last_verify_error: outcome.error,
  };
}

const nowIso = "2026-10-21T12:00:00.000Z";

const connected: SettlementRow = {
  paystack_subaccount_status: "active",
  paystack_subaccount_code: "ACCT_caanta",
  paystack_subaccount_verified_ok: true,
  paystack_subaccount_last_verified_at: "2026-10-14T12:00:00.000Z",
  paystack_subaccount_last_verify_error: null,
};

assert.equal(
  isSettlementSubaccountReady(connected),
  true,
  "before nightly: connected tenant is ready",
);

const afterNotFound = applyNightlyVerification(connected, {
  ok: false,
  error: "Subaccount not found",
}, nowIso);

assert.equal(
  afterNotFound.paystack_subaccount_verified_ok,
  false,
  "nightly job sets verified_ok false on Paystack error",
);
assert.equal(
  afterNotFound.paystack_subaccount_last_verify_error,
  "Subaccount not found",
);
assert.equal(
  isSettlementSubaccountReady(afterNotFound),
  false,
  "after nightly failure: MoMo not ready",
);
assert.equal(
  resolveOnlinePaymentsConnectionStatus(afterNotFound),
  "needs_attention",
  "after nightly failure: Needs attention",
);

const recovered = applyNightlyVerification(afterNotFound, { ok: true }, nowIso);
assert.equal(isSettlementSubaccountReady(recovered), true);
assert.equal(resolveOnlinePaymentsConnectionStatus(recovered), "connected");

// --- Never-checked / schedule once per tenant ---
assert.equal(
  shouldScheduleSettlementVerification(null),
  true,
  "NULL lastVerifiedAt → schedule check",
);
assert.equal(
  isSettlementVerificationStale(null),
  true,
  "NULL is stale for scheduling",
);
assert.equal(
  isSettlementSubaccountReady({
    paystack_subaccount_status: "active",
    paystack_subaccount_code: "ACCT_null",
    paystack_subaccount_verified_ok: null,
  }),
  true,
  "NULL verified_ok still ready while check is scheduled",
);

resetSettlementVerificationInFlightForTests();
assert.equal(
  claimSettlementVerificationSlot("tenant-a"),
  true,
  "first claim schedules",
);
assert.equal(
  claimSettlementVerificationSlot("tenant-a"),
  false,
  "second claim while in-flight skipped (no repeated calls)",
);
assert.equal(
  claimSettlementVerificationSlot("tenant-b"),
  true,
  "different tenant can claim in parallel",
);
releaseSettlementVerificationSlot("tenant-a");
assert.equal(
  claimSettlementVerificationSlot("tenant-a"),
  true,
  "after release, tenant can schedule again",
);
resetSettlementVerificationInFlightForTests();

console.log("OK: paystack settlement verification tests passed");
