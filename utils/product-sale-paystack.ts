import {
  calculateIncomeOutstanding,
  resolveIncomeOutstandingBalance,
} from "@/app/dashboard/finance/income-register-utils";
import { resolveSiteUrlFromRequest } from "@/utils/public-site-url";

export { resolveSiteUrlFromRequest };

export const PRODUCT_SALE_PAYSTACK_CONTEXT = "product_sale" as const;

/**
 * Machine-readable error code returned by product-sale Paystack initialize
 * routes when the tenant has no ready Online Payments settlement. Client-safe
 * so the POS UI can detect it and link to Finance Settings → Online Payments.
 */
export const PAYMENT_SETTINGS_REQUIRED_CODE = "payment_settings_required" as const;

/** Centred modal title when Mobile Money / Paystack collection is not configured. */
export const MOBILE_MONEY_NOT_SETUP_TITLE = "Mobile Money isn't set up yet";

/**
 * Body (and server 409 error) when Paystack Mobile Money collection is not ready.
 * Plain "Record payment" with method Mobile Money (no Paystack popup) stays allowed.
 */
export const MOBILE_MONEY_NOT_SETUP_BODY =
  "Payments can't be received by Mobile Money until a Mobile Money account is connected. Use Cash payment for now.";

/** Shown only to super_admin and director under the modal body. */
export const MOBILE_MONEY_NOT_SETUP_ADMIN_HINT =
  "Connect it in Administration → Finance Settings → Online Payments.";

/** Canonical Online Payments page (Paystack settlement). */
export const ONLINE_PAYMENTS_HREF =
  "/dashboard/administration/online-payments" as const;

/** @deprecated Prefer ONLINE_PAYMENTS_HREF — old Billing Settings deep link. */
export const PAYMENT_SETTINGS_HREF = ONLINE_PAYMENTS_HREF;

/** Legacy Billing Settings ?tab=payment URL — pages should redirect here. */
export const LEGACY_PAYMENT_SETTINGS_HREF =
  "/dashboard/administration/billing?tab=payment" as const;

/** @deprecated Prefer MOBILE_MONEY_NOT_SETUP_BODY — kept as the initialize 409 text. */
export const PAYMENT_SETTINGS_REQUIRED_MESSAGE = MOBILE_MONEY_NOT_SETUP_BODY;

/** Verification older than this triggers a background re-check (does not block alone). */
export const SETTLEMENT_VERIFICATION_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export function isSettlementVerificationStale(
  lastVerifiedAt: string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  if (!lastVerifiedAt?.trim()) {
    return true;
  }
  const verifiedMs = Date.parse(lastVerifiedAt);
  if (!Number.isFinite(verifiedMs)) {
    return true;
  }
  return nowMs - verifiedMs > SETTLEMENT_VERIFICATION_MAX_AGE_MS;
}

/** True when lastVerifiedAt is missing (never checked) or older than 7 days. */
export function shouldScheduleSettlementVerification(
  lastVerifiedAt: string | null | undefined,
  nowMs: number = Date.now(),
): boolean {
  return isSettlementVerificationStale(lastVerifiedAt, nowMs);
}

/** In-flight background verifies — at most one per tenant at a time. */
const settlementVerificationInFlight = new Set<string>();

/**
 * Claim the single in-flight verification slot for a tenant.
 * @returns true when this caller owns the slot (must release later).
 */
export function claimSettlementVerificationSlot(tenantId: string): boolean {
  const trimmed = tenantId.trim();
  if (!trimmed || settlementVerificationInFlight.has(trimmed)) {
    return false;
  }
  settlementVerificationInFlight.add(trimmed);
  return true;
}

export function releaseSettlementVerificationSlot(tenantId: string): void {
  settlementVerificationInFlight.delete(tenantId.trim());
}

/** Test helper — clears the in-flight set between cases. */
export function resetSettlementVerificationInFlightForTests(): void {
  settlementVerificationInFlight.clear();
}

/**
 * True when billing_settings can collect Mobile Money via Paystack.
 * Requires active status and a subaccount code. Only verified_ok === false
 * blocks. NULL (never checked after deploy) and true both allow collection;
 * callers should schedule a background check when NULL or stale (>7 days).
 */
export function isSettlementSubaccountReady(input: {
  paystack_subaccount_status?: string | null;
  paystack_subaccount_code?: string | null;
  paystack_subaccount_verified_ok?: boolean | null;
  paystack_subaccount_last_verified_at?: string | null;
}): boolean {
  const code = input.paystack_subaccount_code?.trim() ?? "";
  if (input.paystack_subaccount_status !== "active" || code.length === 0) {
    return false;
  }
  // Only an explicit failed verification blocks Mobile Money.
  return input.paystack_subaccount_verified_ok !== false;
}

/** UI / assistant badge for Online Payments connection. */
export type OnlinePaymentsConnectionStatus =
  | "connected"
  | "not_connected"
  | "needs_attention"
  | "checking";

export function resolveOnlinePaymentsConnectionStatus(input: {
  paystack_subaccount_status?: string | null;
  paystack_subaccount_code?: string | null;
  paystack_subaccount_verified_ok?: boolean | null;
}): OnlinePaymentsConnectionStatus {
  const code = input.paystack_subaccount_code?.trim() ?? "";
  const active =
    input.paystack_subaccount_status === "active" && code.length > 0;
  if (!active) {
    return "not_connected";
  }
  if (input.paystack_subaccount_verified_ok === true) {
    return "connected";
  }
  if (input.paystack_subaccount_verified_ok === false) {
    return "needs_attention";
  }
  // NULL = never checked (migration / new subaccount) — not a hard failure.
  return "checking";
}

/** Plain labels for Ask DavSuite / Online Payments badges. */
export function onlinePaymentsConnectionStatusLabel(
  status: OnlinePaymentsConnectionStatus,
): string {
  switch (status) {
    case "connected":
      return "Connected";
    case "not_connected":
      return "Not connected";
    case "needs_attention":
      return "Needs attention";
    case "checking":
      return "Checking";
  }
}

/**
 * Ask DavSuite payload for get_mobile_money_status (pure — unit-testable).
 * Path is included only for roles that can open Online Payments.
 */
export function buildMobileMoneyStatusAssistantPayload(input: {
  paystack_subaccount_status?: string | null;
  paystack_subaccount_code?: string | null;
  paystack_subaccount_verified_ok?: boolean | null;
  paystack_subaccount_last_verified_at?: string | null;
  paystack_subaccount_last_verify_error?: string | null;
  role?: string | null;
}): {
  status: OnlinePaymentsConnectionStatus;
  statusLabel: string;
  ready: boolean;
  message: string;
  lastVerifiedAt: string | null;
  reason: string | null;
  paymentSettingsPath?: string;
  note?: string;
} {
  const connection = resolveOnlinePaymentsConnectionStatus(input);
  const ready = isSettlementSubaccountReady(input);
  const lastVerifiedAt =
    input.paystack_subaccount_last_verified_at?.trim() || null;
  const showPath = canShowMobileMoneyPaymentSettingsHint(input.role);
  const pathSentence = showPath
    ? " Connect or update it under Administration → Finance Settings → Online Payments."
    : "";
  const pathField = showPath
    ? { paymentSettingsPath: ONLINE_PAYMENTS_HREF }
    : {};

  if (connection === "connected") {
    return {
      status: "connected",
      statusLabel: onlinePaymentsConnectionStatusLabel(connection),
      ready: true,
      message:
        "Mobile Money collection is Connected for this workspace (Paystack settlement confirmed).",
      lastVerifiedAt,
      reason: null,
    };
  }

  if (connection === "checking") {
    return {
      status: "checking",
      statusLabel: onlinePaymentsConnectionStatusLabel(connection),
      ready: true,
      message:
        "Mobile Money is available while DavSuite confirms the Paystack settlement connection (Checking — never verified yet).",
      lastVerifiedAt,
      reason: null,
      note: "A background check runs once per workspace; the nightly job also verifies every connected account.",
    };
  }

  if (connection === "needs_attention") {
    const reason =
      input.paystack_subaccount_last_verify_error?.trim() ||
      "Paystack can't find this settlement account.";
    return {
      status: "needs_attention",
      statusLabel: onlinePaymentsConnectionStatusLabel(connection),
      ready: false,
      message: `${MOBILE_MONEY_NOT_SETUP_BODY}${pathSentence}`,
      lastVerifiedAt,
      reason,
      ...pathField,
      note: "Recording a Mobile Money payment received outside DavSuite via Record payment is still allowed.",
    };
  }

  return {
    status: "not_connected",
    statusLabel: onlinePaymentsConnectionStatusLabel(connection),
    ready: false,
    message: `${MOBILE_MONEY_NOT_SETUP_BODY}${pathSentence}`,
    lastVerifiedAt,
    reason: null,
    ...pathField,
    note: "Recording a Mobile Money payment received outside DavSuite via Record payment is still allowed.",
  };
}

/** Admin hint on the Mobile Money not-set-up modal. */
export function canShowMobileMoneyPaymentSettingsHint(
  role: string | null | undefined,
): boolean {
  const normalized = (role ?? "").trim().toLowerCase();
  return normalized === "super_admin" || normalized === "director";
}

/** Dropdown label for Mobile Money when collection may be unavailable. */
export function mobileMoneyPaymentMethodOptionLabel(ready: boolean): string {
  return ready ? "Mobile Money" : "Mobile Money (not set up)";
}

export type ProductSaleIncomeLine = {
  id: string;
  amount: number;
  amount_received: number;
  outstanding_balance: number | null;
  payment_status: string;
  sale_status: string | null;
  notes: string | null;
  wht_amount?: number | null;
};

export function roundGhs(value: number): number {
  return Math.round(Number(value) * 100) / 100;
}

export function lineOutstanding(line: ProductSaleIncomeLine): number {
  return resolveIncomeOutstandingBalance({
    amount: Number(line.amount) || 0,
    amount_received: Number(line.amount_received) || 0,
    wht_amount: line.wht_amount,
    outstanding_balance: line.outstanding_balance,
  });
}

export function invoiceOutstanding(lines: ProductSaleIncomeLine[]): number {
  return roundGhs(lines.reduce((sum, line) => sum + lineOutstanding(line), 0));
}

export function isCashPaymentMethodLabel(method: string): boolean {
  return method.trim().toLowerCase() === "cash";
}

export function isCreditPaymentMethodLabel(method: string): boolean {
  const normalized = method.trim().toLowerCase();
  return (
    normalized === "credit" ||
    normalized.includes("on account") ||
    normalized.includes("on-account")
  );
}

/** Methods that may show Request Payment (excludes Cash and Credit). */
export function isRequestPaymentMethod(method: string): boolean {
  const trimmed = method.trim();
  if (!trimmed) {
    return false;
  }
  return (
    !isCashPaymentMethodLabel(trimmed) && !isCreditPaymentMethodLabel(trimmed)
  );
}

export function paymentMethodFromNotes(notes: string | null | undefined): string {
  if (!notes) {
    return "";
  }
  const match = notes.match(/^Payment method:\s*(.+)$/im);
  return match?.[1]?.trim() ?? "";
}

/** Ghana-friendly E.164 (+233…). Returns null if unusable. */
export function normalizeGhanaPhone(
  phone: string | null | undefined,
): string | null {
  const raw = (phone ?? "").trim();
  if (!raw) {
    return null;
  }

  const digits = raw.replace(/[^\d+]/g, "");
  if (digits.startsWith("+233") && digits.length >= 13) {
    return `+233${digits.slice(4).replace(/\D/g, "").slice(0, 9)}`;
  }
  if (digits.startsWith("233") && digits.length >= 12) {
    return `+233${digits.slice(3).replace(/\D/g, "").slice(0, 9)}`;
  }
  if (digits.startsWith("0") && digits.length >= 10) {
    return `+233${digits.slice(1).replace(/\D/g, "").slice(0, 9)}`;
  }
  if (/^\d{9}$/.test(digits)) {
    return `+233${digits}`;
  }
  return null;
}

export function isValidEmail(email: string | null | undefined): boolean {
  const trimmed = (email ?? "").trim();
  if (!trimmed) {
    return false;
  }
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed);
}

/** Paystack always requires an email; SMS-only uses a synthetic address. */
export function resolvePaystackCustomerEmail(options: {
  deliveryEmail: string | null;
  invoiceNo: string;
}): string {
  if (options.deliveryEmail && isValidEmail(options.deliveryEmail)) {
    return options.deliveryEmail.trim().toLowerCase();
  }

  const safeInvoice = options.invoiceNo
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]/g, "-")
    .slice(0, 48);
  return `pos+${safeInvoice || "sale"}@noreply.davorsfacilities.com`;
}

/**
 * Allocate a payment across invoice lines by remaining outstanding
 * (same idea as POS allocateLinePayments).
 */
export function allocatePaymentAcrossLines(
  lines: ProductSaleIncomeLine[],
  paidAmountGhs: number,
): Array<{
  id: string;
  applied: number;
  nextAmountReceived: number;
  nextOutstanding: number;
  nextPaymentStatus: string;
}> {
  let remaining = roundGhs(Math.max(0, paidAmountGhs));

  return lines.map((line) => {
    const amount = roundGhs(Number(line.amount) || 0);
    const already = roundGhs(Number(line.amount_received) || 0);
    const wht = roundGhs(Number(line.wht_amount) || 0);
    // Allocate from live columns (not stamped balance) so a stale stamp
    // cannot under/over-apply a payment.
    const outstanding = calculateIncomeOutstanding(amount, already, wht);
    const applied = roundGhs(Math.min(outstanding, remaining));
    remaining = roundGhs(remaining - applied);
    const nextAmountReceived = roundGhs(already + applied);
    const nextOutstanding = calculateIncomeOutstanding(
      amount,
      nextAmountReceived,
      wht,
    );

    let nextPaymentStatus = line.payment_status;
    if (nextOutstanding <= 0 && amount > 0) {
      nextPaymentStatus = "Paid";
    } else if (nextAmountReceived > 0 && nextOutstanding > 0) {
      nextPaymentStatus = "Partial";
    }

    return {
      id: line.id,
      applied,
      nextAmountReceived,
      nextOutstanding,
      nextPaymentStatus,
    };
  });
}
