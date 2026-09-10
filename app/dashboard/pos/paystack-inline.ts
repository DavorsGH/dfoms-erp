"use client";

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
