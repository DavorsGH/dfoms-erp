/**
 * Permanent Lock Period guards: month-end first, then pending exceptions.
 * Usage: npx tsx scripts/test-payroll-full-lock-guard.ts
 */
import assert from "node:assert/strict";
import {
  fullLockServerBlock,
  permanentLockMonthEndMessage,
} from "../lib/payroll-full-lock-guard";
import { PAYROLL_STATUS_LOCKED } from "../app/dashboard/hr-payroll/payroll-period-utils";

const OCTOBER = {
  lockStatus: PAYROLL_STATUS_LOCKED,
  payrollMonth: "2026-10-01",
  periodYear: 2026,
  periodMonth: 10,
};

// (1) Before month end — blocked with the standard message.
const beforeEnd = permanentLockMonthEndMessage(2026, 10, "2026-10-21");
assert.equal(beforeEnd, "Permanent lock is available on or after 31 Oct 2026.");

const earlyDirect = fullLockServerBlock({
  ...OCTOBER,
  todayIso: "2026-10-21",
  pendingExceptionCount: 0,
});
assert.ok(earlyDirect);
assert.equal(earlyDirect.status, 400);
assert.equal(
  earlyDirect.error,
  "Permanent lock is available on or after 31 Oct 2026.",
);

// Omitting periodYear/periodMonth must not skip the month-end rule.
const earlyWithoutPeriodFields = fullLockServerBlock({
  lockStatus: PAYROLL_STATUS_LOCKED,
  payrollMonth: "2026-10-01",
  todayIso: "2026-10-21",
  pendingExceptionCount: 0,
});
assert.ok(earlyWithoutPeriodFields);
assert.equal(earlyWithoutPeriodFields.status, 400);
assert.match(earlyWithoutPeriodFields.error, /31 Oct 2026/);

// (2) After month end with a pending exception — blocked (409).
const afterWithPending = fullLockServerBlock({
  ...OCTOBER,
  todayIso: "2026-11-01",
  pendingExceptionCount: 1,
});
assert.ok(afterWithPending);
assert.equal(afterWithPending.status, 409);
if (afterWithPending.status === 409) {
  assert.match(afterWithPending.error, /1 attendance exception is still pending/);
  assert.equal(afterWithPending.pendingExceptionCount, 1);
  assert.match(
    afterWithPending.exceptionsHref,
    /year=2026&month=10&exceptions=pending/,
  );
}

// (3) After month end with none pending — allows lock (null).
const afterClear = fullLockServerBlock({
  ...OCTOBER,
  todayIso: "2026-11-01",
  pendingExceptionCount: 0,
});
assert.equal(afterClear, null);

// Partial lock status is not gated by this permanent-lock helper.
assert.equal(
  fullLockServerBlock({
    lockStatus: "Partially Locked",
    payrollMonth: "2026-10-01",
    todayIso: "2026-10-21",
    pendingExceptionCount: 5,
  }),
  null,
);

console.log("OK: payroll full-lock guard tests passed");
