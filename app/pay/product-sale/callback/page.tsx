import { verifyPaystackTransaction } from "@/utils/paystack";
import { roundGhs } from "@/utils/product-sale-paystack";
import {
  fulfillPosCartSnapshotPaymentRequest,
  loadPaymentRequestForFulfillment,
} from "@/utils/pos-momo-fulfillment";
import { createAdminClient } from "@/utils/supabase/admin";

type PageProps = {
  searchParams: Promise<{
    reference?: string;
    payment_request_id?: string;
    trxref?: string;
  }>;
};

export default async function ProductSalePaymentCallbackPage({
  searchParams,
}: PageProps) {
  const params = await searchParams;
  const reference = (params.reference ?? params.trxref ?? "").trim();
  const paymentRequestId = (params.payment_request_id ?? "").trim();

  let headline = "Payment received";
  let detail =
    "If you completed payment, your receipt will update shortly once Paystack confirms the charge.";
  let statusLabel: string | null = null;

  const admin = createAdminClient();

  async function tryFulfillCartSnapshot(options: {
    paymentRequestId?: string;
    reference?: string;
    paidAmountGhs?: number | null;
    paidAt?: string | null;
    channel?: string | null;
  }): Promise<string | null> {
    try {
      const requestRow = await loadPaymentRequestForFulfillment(admin, {
        paymentRequestId: options.paymentRequestId ?? null,
        reference: options.reference ?? null,
      });
      if (!requestRow) {
        return null;
      }
      const incomeIds = Array.isArray(requestRow.income_ids)
        ? requestRow.income_ids.filter(Boolean)
        : [];
      if (incomeIds.length > 0 || !requestRow.cart_snapshot) {
        // Existing-invoice path: webhook applies payment to income lines.
        return requestRow.status === "paid" ? requestRow.invoice_no : null;
      }
      const fulfilled = await fulfillPosCartSnapshotPaymentRequest(
        admin,
        requestRow,
        {
          reference: options.reference ?? requestRow.paystack_reference,
          paidAmountGhs: options.paidAmountGhs,
          paidAt: options.paidAt,
          skipVerify: true,
          paystackChannel: options.channel,
        },
      );
      return fulfilled.invoiceNo;
    } catch {
      return null;
    }
  }

  if (reference) {
    const verified = await verifyPaystackTransaction(reference);
    if (verified.ok) {
      statusLabel = verified.status;
      if (verified.status === "success") {
        const paidAmountGhs =
          verified.amount != null ? roundGhs(verified.amount / 100) : null;
        const invoiceNo = await tryFulfillCartSnapshot({
          paymentRequestId: paymentRequestId || undefined,
          reference: verified.reference,
          paidAmountGhs,
          paidAt: verified.paidAt,
          channel: verified.channel,
        });
        headline = "Payment successful";
        detail = invoiceNo
          ? `Invoice ${invoiceNo} is recorded. You can close this window.`
          : `Reference ${verified.reference} was confirmed. You can close this window.`;
      } else {
        headline = "Payment pending";
        detail = `Paystack status: ${verified.status}. If you just paid, wait a moment and refresh.`;
      }
    } else {
      headline = "Unable to verify payment";
      detail = verified.error;
    }
  } else if (paymentRequestId) {
    const { data } = await admin
      .from("product_sale_payment_requests")
      .select("status, invoice_no, paystack_reference, authorization_url")
      .eq("id", paymentRequestId)
      .maybeSingle();

    if (data?.status === "paid") {
      headline = "Payment successful";
      detail = `Invoice ${data.invoice_no} is marked paid. You can close this window.`;
      statusLabel = "paid";
    } else if (data?.paystack_reference) {
      const verified = await verifyPaystackTransaction(data.paystack_reference);
      if (verified.ok && verified.status === "success") {
        const paidAmountGhs =
          verified.amount != null ? roundGhs(verified.amount / 100) : null;
        const invoiceNo =
          (await tryFulfillCartSnapshot({
            paymentRequestId,
            reference: verified.reference,
            paidAmountGhs,
            paidAt: verified.paidAt,
            channel: verified.channel,
          })) ?? data.invoice_no;
        headline = "Payment successful";
        detail = `Invoice ${invoiceNo} payment confirmed. You can close this window.`;
        statusLabel = verified.status;
      } else {
        headline = "Payment pending confirmation";
        detail = `Invoice ${data.invoice_no} — waiting for Paystack confirmation.`;
        statusLabel = data.status;
      }
    } else {
      headline = "Payment request found";
      detail = "Complete payment using the link that was sent to you.";
      statusLabel = data?.status ?? null;
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-16">
      <h1 className="text-2xl font-semibold text-slate-900">{headline}</h1>
      <p className="mt-3 text-slate-600">{detail}</p>
      {statusLabel ? (
        <p className="mt-2 text-sm text-slate-500">Status: {statusLabel}</p>
      ) : null}
    </main>
  );
}
