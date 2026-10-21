"use client";

import {
  extractPaystackInlineReference,
  openPaystackInlineWithAccessCode,
} from "@/app/dashboard/pos/paystack-inline";

type InitializeResponse = {
  ok?: boolean;
  error?: string;
  code?: string;
  payment_request_id?: string;
  reference?: string;
  access_code?: string;
  invoice_no?: string;
};

type ConfirmResponse = {
  ok?: boolean;
  error?: string;
  invoice_no?: string;
};

export async function openManualSalePaystackInline(
  body: Record<string, unknown>,
): Promise<
  | { ok: true; invoiceNo: string }
  | { ok: false; cancelled: boolean; error: string; code?: string }
> {
  const initResponse = await fetch("/api/sales/paystack/initialize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ...body, inline: true, send_email: false, send_sms: false }),
  });
  const initPayload = (await initResponse.json().catch(() => null)) as
    | InitializeResponse
    | null;
  if (!initResponse.ok || !initPayload?.access_code || !initPayload.payment_request_id) {
    return {
      ok: false,
      cancelled: false,
      error: initPayload?.error || "Could not start Paystack checkout.",
      code: initPayload?.code,
    };
  }

  const paymentRequestId = initPayload.payment_request_id;

  return await new Promise((resolve) => {
    void openPaystackInlineWithAccessCode(initPayload.access_code!, {
      onSuccess: (transaction) => {
        void (async () => {
          const confirmResponse = await fetch("/api/sales/paystack/momo/confirm", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              payment_request_id: paymentRequestId,
              reference: extractPaystackInlineReference(
                transaction,
                initPayload.reference,
              ),
            }),
          });
          const confirmPayload = (await confirmResponse.json().catch(() => null)) as
            | ConfirmResponse
            | null;
          if (!confirmResponse.ok || !confirmPayload?.ok) {
            resolve({
              ok: false,
              cancelled: false,
              error:
                confirmPayload?.error ||
                "Paystack confirmed the payment, but it could not be recorded. Check Sales, or wait for the payment notification to finish.",
            });
            return;
          }
          resolve({
            ok: true,
            invoiceNo: confirmPayload.invoice_no?.trim() || "the sale",
          });
        })();
      },
      onCancel: () => {
        void fetch("/api/sales/paystack/momo/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            payment_request_id: paymentRequestId,
            abandon: true,
          }),
        });
        resolve({
          ok: false,
          cancelled: true,
          error: "Payment was cancelled. Nothing was recorded.",
        });
      },
      onError: (paystackError) => {
        void fetch("/api/sales/paystack/momo/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            payment_request_id: paymentRequestId,
            abandon: true,
          }),
        });
        resolve({
          ok: false,
          cancelled: false,
          error:
            paystackError.message?.trim() ||
            "Paystack payment failed. Nothing was recorded.",
        });
      },
    }).catch((error: unknown) => {
      resolve({
        ok: false,
        cancelled: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not open Paystack checkout.",
      });
    });
  });
}
