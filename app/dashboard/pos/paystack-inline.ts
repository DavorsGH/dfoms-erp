"use client";

import {
  confirmPaystackPayment,
  PAYSTACK_NOT_CONFIRMED_MESSAGE,
  type PaystackClientConfirmResult,
} from "@/utils/paystack-confirm-client";

type PaystackInlineTransaction =
  | string
  | {
      reference?: string;
      trxref?: string;
    }
  | null
  | undefined;

type PaystackResumeCallbacks = {
  onSuccess?: (transaction: PaystackInlineTransaction) => void;
  onCancel?: () => void;
  onError?: (error: { message?: string }) => void;
};

/** Reference from Paystack Inline onSuccess (shape varies by SDK version). */
export function extractPaystackInlineReference(
  transaction: PaystackInlineTransaction,
  fallbackReference?: string | null,
): string {
  if (typeof transaction === "string") {
    return transaction.trim();
  }

  return (
    transaction?.reference?.trim() ||
    transaction?.trxref?.trim() ||
    fallbackReference?.trim() ||
    ""
  );
}

type PaystackPopInstance = {
  resumeTransaction: (
    accessCode: string,
    callbacks?: PaystackResumeCallbacks,
  ) => void;
};

type PaystackPopConstructor = new () => PaystackPopInstance;

/** Remove Paystack inline iframes/overlays that can block page clicks after close. */
export function dismissPaystackInlineOverlays(): void {
  if (typeof document === "undefined") {
    return;
  }

  for (const element of document.querySelectorAll("iframe")) {
    const src = element.getAttribute("src") ?? "";
    if (/paystack/i.test(src)) {
      element.remove();
    }
  }

  for (const element of document.querySelectorAll("[id*='paystack' i], [class*='paystack' i]")) {
    if (element instanceof HTMLElement) {
      element.remove();
    }
  }
}

/**
 * Opens Paystack Inline checkout for an already-initialized transaction
 * (access_code from Transaction Initialize). MoMo-only channels are set
 * on the server initialize call.
 */
export async function openPaystackInlineWithAccessCode(
  accessCode: string,
  callbacks: PaystackResumeCallbacks,
): Promise<void> {
  const PaystackPopModule = await import("@paystack/inline-js");
  const PaystackPop = (PaystackPopModule.default ??
    PaystackPopModule) as PaystackPopConstructor;
  const popup = new PaystackPop();
  popup.resumeTransaction(accessCode, {
    onSuccess: (transaction) => {
      dismissPaystackInlineOverlays();
      callbacks.onSuccess?.(transaction);
    },
    onCancel: () => {
      dismissPaystackInlineOverlays();
      callbacks.onCancel?.();
    },
    onError: (error) => {
      dismissPaystackInlineOverlays();
      callbacks.onError?.(error);
    },
  });
}

export type PaystackPopupOutcome =
  | {
      status: "paid";
      confirm: Extract<
        PaystackClientConfirmResult,
        { kind: "applied" | "already_applied" }
      >;
    }
  /** Popup closed (or ended) and Paystack does not report the payment as paid yet. */
  | { status: "not_confirmed"; message: string }
  | { status: "failed"; message: string };

type PaystackPopupRunOptions = {
  accessCode: string;
  paymentRequestId: string;
  /** Reference returned by initialize. Used when the popup does not pass one. */
  initReference?: string | null;
  /** Poll the server while the popup is open. 0 turns it off. */
  pollIntervalMs?: number;
  pollStartMs?: number;
  pollMaxMs?: number;
  open?: typeof openPaystackInlineWithAccessCode;
  confirm?: typeof confirmPaystackPayment;
};

/**
 * Opens the Paystack popup and always routes the result through the server
 * confirm route, which verifies with Paystack and applies the payment.
 *
 * - Popup success: confirm once with the popup reference.
 * - Popup closed or errored: confirm once. If Paystack says it is paid, it is
 *   applied. If not, nothing changes and the caller shows
 *   "Payment not confirmed yet. Use Check payment in a moment."
 * - While the popup is open the server is also polled lightly, so a popup that
 *   never calls back (seen on localhost) still gets applied once Paystack reports paid.
 */
export async function runPaystackPopupWithConfirm(
  options: PaystackPopupRunOptions,
): Promise<PaystackPopupOutcome> {
  const open = options.open ?? openPaystackInlineWithAccessCode;
  const confirm = options.confirm ?? confirmPaystackPayment;
  const pollIntervalMs = options.pollIntervalMs ?? 8000;
  const pollStartMs = options.pollStartMs ?? 15000;
  const pollMaxMs = options.pollMaxMs ?? 10 * 60 * 1000;

  return await new Promise<PaystackPopupOutcome>((resolve) => {
    let settled = false;
    let callbackReceived = false;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let pollInFlight = false;
    const startedAt = Date.now();

    function stopPolling() {
      if (pollTimer != null) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
    }

    function finish(outcome: PaystackPopupOutcome) {
      if (settled) {
        return;
      }
      settled = true;
      stopPolling();
      resolve(outcome);
    }

    function toOutcome(
      result: PaystackClientConfirmResult,
      failure: string | null,
    ): PaystackPopupOutcome {
      if (result.kind === "applied" || result.kind === "already_applied") {
        return { status: "paid", confirm: result };
      }
      if (result.kind === "not_paid") {
        return {
          status: failure ? "failed" : "not_confirmed",
          message: failure ?? PAYSTACK_NOT_CONFIRMED_MESSAGE,
        };
      }
      return { status: "failed", message: result.message };
    }

    function schedulePoll(delay: number) {
      if (pollIntervalMs <= 0 || settled || callbackReceived) {
        return;
      }
      pollTimer = setTimeout(() => {
        pollTimer = null;
        if (settled || callbackReceived) {
          return;
        }
        if (Date.now() - startedAt > pollMaxMs) {
          return;
        }
        if (pollInFlight) {
          schedulePoll(pollIntervalMs);
          return;
        }
        pollInFlight = true;
        void confirm({
          paymentRequestId: options.paymentRequestId,
          reference: options.initReference,
          source: "popup_poll",
        })
          .then((result) => {
            if (settled || callbackReceived) {
              return;
            }
            if (result.kind === "applied" || result.kind === "already_applied") {
              dismissPaystackInlineOverlays();
              finish({ status: "paid", confirm: result });
              return;
            }
            schedulePoll(pollIntervalMs);
          })
          .finally(() => {
            pollInFlight = false;
          });
      }, delay);
    }

    function handleCallback(
      source: "popup_success" | "popup_closed",
      reference: string | null,
      failure: string | null,
    ) {
      if (settled || callbackReceived) {
        return;
      }
      callbackReceived = true;
      stopPolling();
      void confirm({
        paymentRequestId: options.paymentRequestId,
        reference,
        source,
      }).then((result) => finish(toOutcome(result, failure)));
    }

    open(options.accessCode, {
      onSuccess: (transaction) =>
        handleCallback(
          "popup_success",
          extractPaystackInlineReference(transaction, options.initReference) || null,
          null,
        ),
      onCancel: () =>
        handleCallback("popup_closed", options.initReference ?? null, null),
      onError: (paystackError) =>
        handleCallback(
          "popup_closed",
          options.initReference ?? null,
          paystackError.message?.trim() || "Paystack payment failed.",
        ),
    })
      .then(() => schedulePoll(pollStartMs))
      .catch((error: unknown) => {
        finish({
          status: "failed",
          message:
            error instanceof Error ? error.message : "Could not open Paystack checkout.",
        });
      });
  });
}

