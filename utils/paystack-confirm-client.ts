/** Client-safe helpers for confirming a Paystack product-sale payment. */

export const PAYSTACK_NOT_CONFIRMED_MESSAGE =
  "Payment not confirmed yet. Use Check payment in a moment.";

export const PAYSTACK_CONFIRM_ROUTE = "/api/sales/paystack/momo/confirm";

export type PaystackClientConfirmSource =
  | "popup_success"
  | "popup_closed"
  | "popup_poll"
  | "check_payment";

export type PaystackClientConfirmResult =
  | {
      kind: "applied" | "already_applied";
      invoiceNo: string;
      incomeIds: string[];
      reference: string;
      message: string;
    }
  | { kind: "not_paid"; message: string }
  | { kind: "error"; message: string };

type ConfirmPayload = {
  ok?: boolean;
  outcome?: string;
  error?: string;
  message?: string;
  invoice_no?: string;
  income_ids?: string[];
  reference?: string;
  already_applied?: boolean;
  not_paid?: boolean;
};

/** Pure: turn the confirm route's HTTP result into a client result. */
export function interpretPaystackConfirmResponse(
  httpOk: boolean,
  payload: ConfirmPayload | null,
): PaystackClientConfirmResult {
  if (payload?.ok === true) {
    return {
      kind: payload.already_applied === true ? "already_applied" : "applied",
      invoiceNo: payload.invoice_no?.trim() ?? "",
      incomeIds: Array.isArray(payload.income_ids) ? payload.income_ids : [],
      reference: payload.reference?.trim() ?? "",
      message: payload.message?.trim() ?? "",
    };
  }
  if (payload?.not_paid === true || payload?.outcome === "not_paid") {
    return { kind: "not_paid", message: PAYSTACK_NOT_CONFIRMED_MESSAGE };
  }
  return {
    kind: "error",
    message:
      payload?.error?.trim() ||
      (httpOk
        ? "Payment could not be confirmed."
        : "Could not reach the payment confirmation service."),
  };
}

/** Ask the server to verify with Paystack and apply the payment. */
export async function confirmPaystackPayment(input: {
  paymentRequestId: string;
  reference?: string | null;
  source: PaystackClientConfirmSource;
}): Promise<PaystackClientConfirmResult> {
  try {
    const response = await fetch(PAYSTACK_CONFIRM_ROUTE, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        payment_request_id: input.paymentRequestId,
        reference: input.reference?.trim() || undefined,
        source: input.source,
      }),
    });
    const payload = (await response.json().catch(() => null)) as ConfirmPayload | null;
    return interpretPaystackConfirmResponse(response.ok, payload);
  } catch (error) {
    return {
      kind: "error",
      message:
        error instanceof Error ? error.message : "Could not confirm the payment.",
    };
  }
}
