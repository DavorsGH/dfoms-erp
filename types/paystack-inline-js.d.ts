declare module "@paystack/inline-js" {
  type PaystackResumeCallbacks = {
    onSuccess?: (transaction: { reference?: string }) => void;
    onCancel?: () => void;
    onError?: (error: { message?: string }) => void;
  };

  export default class PaystackPop {
    resumeTransaction(
      accessCode: string,
      callbacks?: PaystackResumeCallbacks,
    ): void;
  }
}
