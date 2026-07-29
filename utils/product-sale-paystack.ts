import {
  calculateIncomeOutstanding,
  resolveIncomeOutstandingBalance,
} from "@/app/dashboard/finance/income-register-utils";

export const PRODUCT_SALE_PAYSTACK_CONTEXT = "product_sale" as const;

/**
 * Machine-readable error code returned by product-sale Paystack initialize
 * routes when the tenant has no active settlement subaccount. Client-safe so
 * the POS UI can detect it and link to Payment Settings.
 */
export const PAYMENT_SETTINGS_REQUIRED_CODE = "payment_settings_required" as const;

export const PAYMENT_SETTINGS_REQUIRED_MESSAGE =
  "Payment Settings required - set up your settlement account before accepting Mobile Money or card payments." as const;

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
      nextAmountReceived,
      nextOutstanding,
      nextPaymentStatus,
    };
  });
}

export function resolveSiteUrlFromRequest(request: Request): string {
  const configured = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/$/, "");
  if (configured) {
    return configured;
  }

  const host =
    request.headers.get("x-forwarded-host") ?? request.headers.get("host");
  const proto = request.headers.get("x-forwarded-proto") ?? "http";
  if (host) {
    return `${proto}://${host}`;
  }

  return "http://localhost:3000";
}
