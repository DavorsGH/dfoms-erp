"use client";

import { runPaystackPopupWithConfirm } from "@/app/dashboard/pos/paystack-inline";

type InitializeResponse = {
  ok?: boolean;
  error?: string;
  code?: string;
  payment_request_id?: string;
  reference?: string;
  access_code?: string;
  invoice_no?: string;
};

export type ManualSalePaystackResult =
  | { ok: true; invoiceNo: string }
  | {
      ok: false;
      cancelled: boolean;
      /** Popup closed and Paystack does not show the payment as paid yet. */
      notConfirmed?: boolean;
      error: string;
      code?: string;
    };

export async function openManualSalePaystackInline(
  body: Record<string, unknown>,
): Promise<ManualSalePaystackResult> {
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

  const outcome = await runPaystackPopupWithConfirm({
    accessCode: initPayload.access_code,
    paymentRequestId: initPayload.payment_request_id,
    initReference: initPayload.reference,
  });

  if (outcome.status === "paid") {
    return {
      ok: true,
      invoiceNo:
        outcome.confirm.invoiceNo || initPayload.invoice_no?.trim() || "the sale",
    };
  }
  if (outcome.status === "not_confirmed") {
    return {
      ok: false,
      cancelled: false,
      notConfirmed: true,
      error: outcome.message,
    };
  }
  return { ok: false, cancelled: false, error: outcome.message };
}
