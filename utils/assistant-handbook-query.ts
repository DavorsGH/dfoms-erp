/**
 * Pure handbook retrieval / answer helpers (no server-only — unit-testable).
 */

const PAY_DEDUCTION_QUERY_PATTERN =
  /\b(pay|payroll|deduct|deduction|absence|absent|half[-\s]?day|gross|net pay|ssnit|paye|welfare|salary|wages)\b/i;

const SECTION_82_RETRIEVAL_HINT =
  "handbook section 8.2 Payroll: unpaid absence and half day reduce gross pay before SSNIT and PAYE from October 2026; welfare on earned gross after tax";

/**
 * True when the user is asking about pay, deductions, absence, or half day —
 * retrieval should also pull handbook §8.2 (absence before tax).
 */
export function isPayOrDeductionHandbookQuestion(query: string): boolean {
  return PAY_DEDUCTION_QUERY_PATTERN.test(query.trim());
}

/** Augment the Voyage query so §8.2 is more likely to be retrieved. */
export function augmentHandbookRetrievalQuery(query: string): string {
  const trimmed = query.trim();
  if (!trimmed || !isPayOrDeductionHandbookQuestion(trimmed)) {
    return trimmed;
  }
  return `${trimmed}\n\n${SECTION_82_RETRIEVAL_HINT}`;
}

/**
 * Acceptance check for answers to "How is a half day deducted from pay?"
 * Must mention gross (before tax / SSNIT / PAYE) and must not say "net pay".
 */
export function isAcceptableHalfDayDeductionAnswer(reply: string): boolean {
  const text = reply.trim();
  if (!text) {
    return false;
  }
  if (/\bnet pay\b/i.test(text)) {
    return false;
  }
  const lower = text.toLowerCase();
  const mentionsGross = lower.includes("gross");
  const mentionsBeforeTax =
    lower.includes("before tax") ||
    lower.includes("before paye") ||
    lower.includes("before ssnit") ||
    (lower.includes("before") &&
      (lower.includes("paye") || lower.includes("ssnit")));
  return mentionsGross && mentionsBeforeTax;
}
