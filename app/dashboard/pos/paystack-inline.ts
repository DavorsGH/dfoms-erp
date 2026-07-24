"use client";

type PaystackResumeCallbacks = {
  onSuccess?: (transaction: { reference?: string }) => void;
  onCancel?: () => void;
  onError?: (error: { message?: string }) => void;
};

type PaystackPopInstance = {
  resumeTransaction: (
    accessCode: string,
    callbacks?: PaystackResumeCallbacks,
  ) => void;
};

type PaystackPopConstructor = new () => PaystackPopInstance;

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
  popup.resumeTransaction(accessCode, callbacks);
}
