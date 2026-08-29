import {
  roundMoney,
  toNumber,
  type ClientInvoiceStatus,
} from "@/utils/client-invoices-types";

const SETTLED_EPSILON = 0.009;

/** Cash still expected after WHT credit on the invoice header. */
export function computeClientInvoiceNetCashDue(
  totalDue: unknown,
  whtAmount: unknown,
): number {
  const total = roundMoney(toNumber(totalDue));
  const wht = roundMoney(toNumber(whtAmount));
  return roundMoney(Math.max(0, total - wht));
}

/** Remaining cash to record against an invoice (partial payments supported). */
export function computeClientInvoiceCashOutstanding(
  totalDue: unknown,
  whtAmount: unknown,
  amountReceived: unknown,
): number {
  const netCashDue = computeClientInvoiceNetCashDue(totalDue, whtAmount);
  const received = roundMoney(toNumber(amountReceived));
  return roundMoney(Math.max(0, netCashDue - received));
}

/** Whether cash received plus invoice WHT fully settles the invoice total. */
export function isClientInvoiceSettledFromPayments(
  cashReceived: unknown,
  totalDue: unknown,
  whtAmount: unknown,
): boolean {
  const cash = roundMoney(toNumber(cashReceived));
  const total = roundMoney(toNumber(totalDue));
  const wht = roundMoney(toNumber(whtAmount));
  return cash + wht >= total - SETTLED_EPSILON;
}

export function deriveClientInvoiceStatusFromPayments(
  cashReceived: unknown,
  totalDue: unknown,
  whtAmount: unknown,
  currentStatus: ClientInvoiceStatus,
): ClientInvoiceStatus {
  const cash = roundMoney(toNumber(cashReceived));

  if (cash <= 0) {
    return currentStatus === "draft" ? "draft" : "sent";
  }

  if (isClientInvoiceSettledFromPayments(cash, totalDue, whtAmount)) {
    return "paid";
  }

  return "partial";
}
