/**
 * Unit tests for Ask DavSuite R55 staff tools (role gates, pure helpers, handbook coverage).
 *
 * Usage: npx tsx scripts/test-assistant-r55-tools.ts
 * Exits non-zero on failure.
 */
import Module from "node:module";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const originalLoad = (
  Module as unknown as { _load: (...args: unknown[]) => unknown }
)._load;
(Module as unknown as { _load: (...args: unknown[]) => unknown })._load =
  function (request: unknown, parent: unknown, isMain: unknown) {
    if (request === "server-only") {
      return {};
    }
    return originalLoad(request, parent, isMain);
  };

function expect(condition: unknown, message: string): asserts condition {
  assert.ok(condition, message);
}

function toolNames(
  tools: Array<{ name: string }>,
): Set<string> {
  return new Set(tools.map((tool) => tool.name));
}

async function main() {
  const {
    formatPaystackPaymentAge,
    isAttendanceModeUsingRoleDefault,
    parseAttendanceExceptionsView,
    payrollAbsenceSummaryAccessError,
    attendanceExceptionsAccessError,
    canAccessShiftTimesAssistant,
    canCollectPaystackPayments,
    canViewPaystackAttentionList,
  } = await import("../utils/assistant-staff-r55-helpers");

  const {
    getStaffAssistantTools,
    GET_ATTENDANCE_EXCEPTIONS_TOOL_NAME,
    GET_SHIFT_TIMES_TOOL_NAME,
    GET_EMPLOYEE_ATTENDANCE_MODE_TOOL_NAME,
    GET_REMOTE_WORK_ARRANGEMENTS_TOOL_NAME,
    GET_PAYSTACK_PAYMENTS_PENDING_TOOL_NAME,
    GET_MOBILE_MONEY_STATUS_TOOL_NAME,
    GET_PAYROLL_ABSENCE_SUMMARY_TOOL_NAME,
  } = await import("../utils/assistant-staff-tools");

  const {
    ONLINE_PAYMENTS_HREF,
    buildMobileMoneyStatusAssistantPayload,
  } = await import("../utils/product-sale-paystack");

  const {
    augmentHandbookRetrievalQuery,
    isAcceptableHalfDayDeductionAnswer,
    isPayOrDeductionHandbookQuestion,
  } = await import("../utils/assistant-handbook-query");

  // --- Pure helpers ---
  expect(
    parseAttendanceExceptionsView(undefined) === "pending",
    "default view is pending",
  );
  expect(
    parseAttendanceExceptionsView({ view: "decided" }) === "decided",
    "view decided",
  );
  expect(
    parseAttendanceExceptionsView({ view: "bogus" }) === "pending",
    "invalid view → pending",
  );

  expect(
    isAttendanceModeUsingRoleDefault(null) === true,
    "null attendance_mode uses role default",
  );
  expect(
    isAttendanceModeUsingRoleDefault("") === true,
    "empty attendance_mode uses role default",
  );
  expect(
    isAttendanceModeUsingRoleDefault("standard") === false,
    "stored standard is not role default",
  );
  expect(
    isAttendanceModeUsingRoleDefault("bogus") === true,
    "invalid stored mode falls back to role default",
  );

  const now = new Date("2026-10-21T12:00:00.000Z");
  expect(
    formatPaystackPaymentAge("2026-10-21T11:30:00.000Z", now).ageLabel ===
      "30m",
    "age minutes",
  );
  expect(
    formatPaystackPaymentAge("2026-10-21T09:00:00.000Z", now).ageLabel ===
      "3h",
    "age hours",
  );
  expect(
    formatPaystackPaymentAge("2026-10-18T12:00:00.000Z", now).ageLabel ===
      "3d",
    "age days",
  );

  // --- Handler-style access refusals (pure gates, no session mock needed) ---
  expect(
    payrollAbsenceSummaryAccessError("sales_rep") ===
      "You do not have access to payroll absence summary.",
    "sales_rep refused payroll absence summary",
  );
  expect(
    payrollAbsenceSummaryAccessError("hr") === null,
    "hr allowed payroll absence summary",
  );
  expect(
    attendanceExceptionsAccessError("sales_rep") ===
      "You do not have access to attendance exceptions.",
    "sales_rep refused attendance exceptions",
  );
  expect(
    attendanceExceptionsAccessError("operations_manager") === null,
    "operations_manager can view attendance exceptions",
  );
  expect(
    canAccessShiftTimesAssistant("finance_admin") === true,
    "finance_admin can access shift times",
  );
  expect(
    canAccessShiftTimesAssistant("sales_rep") === false,
    "sales_rep cannot access shift times",
  );
  expect(
    canCollectPaystackPayments("sales_rep") === true,
    "sales_rep can collect Paystack",
  );
  expect(
    canViewPaystackAttentionList("sales_rep") === true,
    "sales_rep CRM can see attention list",
  );

  // --- getStaffAssistantTools role gating ---
  const salesRepTools = toolNames(getStaffAssistantTools("sales_rep"));
  expect(
    !salesRepTools.has(GET_PAYROLL_ABSENCE_SUMMARY_TOOL_NAME),
    "sales_rep must NOT get get_payroll_absence_summary",
  );
  expect(
    !salesRepTools.has(GET_ATTENDANCE_EXCEPTIONS_TOOL_NAME),
    "sales_rep must NOT get get_attendance_exceptions",
  );
  expect(
    !salesRepTools.has(GET_REMOTE_WORK_ARRANGEMENTS_TOOL_NAME),
    "sales_rep must NOT get get_remote_work_arrangements",
  );
  expect(
    salesRepTools.has(GET_PAYSTACK_PAYMENTS_PENDING_TOOL_NAME),
    "sales_rep gets get_paystack_payments_pending",
  );
  expect(
    salesRepTools.has(GET_MOBILE_MONEY_STATUS_TOOL_NAME),
    "sales_rep gets get_mobile_money_status",
  );

  const supervisorTools = toolNames(getStaffAssistantTools("supervisor"));
  expect(
    !supervisorTools.has(GET_ATTENDANCE_EXCEPTIONS_TOOL_NAME),
    "supervisor (no attendance-exception view) must NOT get get_attendance_exceptions",
  );
  expect(
    !supervisorTools.has(GET_PAYROLL_ABSENCE_SUMMARY_TOOL_NAME),
    "supervisor must NOT get get_payroll_absence_summary",
  );

  const hrTools = toolNames(getStaffAssistantTools("hr"));
  expect(
    hrTools.has(GET_ATTENDANCE_EXCEPTIONS_TOOL_NAME),
    "hr gets get_attendance_exceptions",
  );
  expect(hrTools.has(GET_SHIFT_TIMES_TOOL_NAME), "hr gets get_shift_times");
  expect(
    hrTools.has(GET_EMPLOYEE_ATTENDANCE_MODE_TOOL_NAME),
    "hr gets get_employee_attendance_mode",
  );
  expect(
    hrTools.has(GET_REMOTE_WORK_ARRANGEMENTS_TOOL_NAME),
    "hr gets get_remote_work_arrangements",
  );
  expect(
    hrTools.has(GET_PAYROLL_ABSENCE_SUMMARY_TOOL_NAME),
    "hr gets get_payroll_absence_summary",
  );

  const opsTools = toolNames(getStaffAssistantTools("operations_manager"));
  expect(
    opsTools.has(GET_ATTENDANCE_EXCEPTIONS_TOOL_NAME),
    "operations_manager gets get_attendance_exceptions",
  );
  expect(
    opsTools.has(GET_SHIFT_TIMES_TOOL_NAME),
    "operations_manager gets get_shift_times",
  );
  expect(
    !opsTools.has(GET_PAYROLL_ABSENCE_SUMMARY_TOOL_NAME),
    "operations_manager must NOT get get_payroll_absence_summary (HR payroll only)",
  );

  // --- Why can't I take Mobile Money? (verified_ok = false) ---
  const whyCantTakeMomo = buildMobileMoneyStatusAssistantPayload({
    paystack_subaccount_status: "active",
    paystack_subaccount_code: "ACCT_missing",
    paystack_subaccount_verified_ok: false,
    paystack_subaccount_last_verified_at: "2026-10-21T08:00:00.000Z",
    paystack_subaccount_last_verify_error: "Subaccount not found",
    role: "director",
  });
  expect(
    whyCantTakeMomo.status === "needs_attention",
    "Why can't I take Mobile Money? → Needs attention",
  );
  expect(
    whyCantTakeMomo.statusLabel === "Needs attention",
    "statusLabel is Needs attention",
  );
  expect(whyCantTakeMomo.ready === false, "not ready when verified_ok false");
  expect(
    whyCantTakeMomo.reason === "Subaccount not found",
    "plain reason when Needs attention",
  );
  expect(
    whyCantTakeMomo.paymentSettingsPath === ONLINE_PAYMENTS_HREF,
    "points to Administration → Finance Settings → Online Payments path",
  );
  expect(
    whyCantTakeMomo.message.includes(
      "Administration → Finance Settings → Online Payments",
    ),
    "message includes Online Payments path for director",
  );

  // --- Handbook v3.3 coverage (staff-handbook.md string contains) ---
  const handbookPath = join(
    process.cwd(),
    "content",
    "handbook",
    "staff-handbook.md",
  );
  const handbook = readFileSync(handbookPath, "utf8");

  const handbookExpect = [
    ["Mobile Money greyed out / not set up", "greyed out"],
    ["Mobile Money Not set up", "Not set up"],
    ["Cash received", "Cash received"],
    ["Record payment", "Record payment"],
    ["attendance exceptions", "Attendance exceptions"],
    ["Remote Work", "Remote Work"],
    ["Roster & Shift Settings", "Roster & Shift Settings"],
    ["absence before tax", "Unpaid absence comes off before tax"],
    ["Online Payments section 13.3a", "13.3a Online Payments"],
    ["Online Payments in Finance Settings table", "Online Payments"],
    [
      "POS path Online Payments",
      "Administration → Finance Settings → Online Payments",
    ],
    ["Payment Accounts What they're for", "What they're for"],
    ["Payment Accounts in your records", "In your records"],
    [
      "Payment Accounts deactivate instead of delete",
      "deactivate it instead",
    ],
    [
      "8.5 cross-ref absence gross before tax",
      "The deduction reduces gross pay before PAYE and SSNIT (from October 2026",
    ],
    ["8.5 points to 8.2", "see 8.2."],
  ] as const;

  for (const [label, needle] of handbookExpect) {
    expect(
      handbook.includes(needle),
      `staff-handbook.md should cover "${label}" (contains "${needle}")`,
    );
  }

  expect(
    !handbook.includes("Payment Accounts / Billing Settings as applicable"),
    "no leftover Payment Settlement pointing at Billing Settings",
  );

  // Scanner simulator rule lives in core prompt (not handbook edit).
  const corePrompt = readFileSync(
    join(process.cwd(), "utils", "assistant-system-prompt-core.ts"),
    "utf8",
  );
  expect(
    corePrompt.includes("Simulate scanner"),
    "ASSISTANT_STYLE_AND_FINANCE_RULES mentions Simulate scanner staging rule",
  );
  expect(
    corePrompt.includes("Never say absence comes off net pay"),
    "core prompt forbids absence off net pay from Oct 2026",
  );
  expect(
    corePrompt.includes("reduce GROSS pay before SSNIT and PAYE"),
    "core prompt states absence reduces gross before tax",
  );

  // --- How is a half day deducted from pay? ---
  const halfDayQuestion = "How is a half day deducted from pay?";
  expect(
    isPayOrDeductionHandbookQuestion(halfDayQuestion),
    "half-day question triggers §8.2 retrieval boost",
  );
  expect(
    augmentHandbookRetrievalQuery(halfDayQuestion).includes("8.2"),
    "retrieval query mentions section 8.2",
  );

  const goodHalfDayAnswer =
    "Half day = basic ÷ days to pay × 0.5, taken off gross pay before SSNIT and PAYE (from October 2026). Example: basic 589.47, 27 days, half day → 10.92 off gross; gross 578.55.";
  const badHalfDayAnswer =
    "Half a day's pay is deducted (basic ÷ days to pay × 0.5) off their net pay.";
  expect(
    isAcceptableHalfDayDeductionAnswer(goodHalfDayAnswer),
    "How is a half day deducted from pay? — good answer mentions gross before tax",
  );
  expect(
    !isAcceptableHalfDayDeductionAnswer(badHalfDayAnswer),
    "How is a half day deducted from pay? — must not say net pay",
  );

  console.log("OK: assistant R55 tools tests passed");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
