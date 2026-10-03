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

const NOT_FOUND_HEADLINE = "We couldn't find this payment";
const NOT_FOUND_DETAIL =
  "Check the payment link you were sent or contact the seller if you need help.";

function formatAmountGhs(amount: number | null | undefined): string | null {
  if (amount == null || !Number.isFinite(amount)) {
    return null;
  }
  return `GHS ${roundGhs(amount).toFixed(2)}`;
};

export default async function ProductSalePaymentCallbackPage({
  searchParams,
}: PageProps) {
  const params = await searchParams;
  const referenceParam = (params.reference ?? params.trxref ?? "").trim();
  const paymentRequestId = (params.payment_request_id ?? "").trim();

  let headline = NOT_FOUND_HEADLINE;
  let detail = NOT_FOUND_DETAIL;
  let statusLabel: string | null = null;
  let amountLabel: string | null = null;
  let invoiceLabel: string | null = null;

  const admin = createAdminClient();

  async function tryFulfillCartSnapshot(options: {
    paymentRequestId: string;
    reference: string;
    paidAmountGhs?: number | null;
    paidAt?: string | null;
    channel?: string | null;
  }): Promise<string | null> {
    try {
      const requestRow = await loadPaymentRequestForFulfillment(admin, {
        paymentRequestId: options.paymentRequestId,
        reference: options.reference,
      });
      if (!requestRow) {
        return null;
      }
      const incomeIds = Array.isArray(requestRow.income_ids)
        ? requestRow.income_ids.filter(Boolean)
        : [];
      if (incomeIds.length > 0 || !requestRow.cart_snapshot) {
        return requestRow.status === "paid" ? requestRow.invoice_no : null;
      }
      const fulfilled = await fulfillPosCartSnapshotPaymentRequest(
        admin,
        requestRow,
        {
          reference: options.reference,
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

  async function loadBoundPaymentRequest(paystackReference: string) {
    let query = admin
      .from("product_sale_payment_requests")
      .select("id, invoice_no, status, amount_requested, paystack_reference")
      .eq("paystack_reference", paystackReference);

    if (paymentRequestId) {
      query = query.eq("id", paymentRequestId);
    }

    const { data, error } = await query.maybeSingle();
    if (error || !data) {
      return null;
    }

    if (
      paymentRequestId &&
      String(data.id) !== paymentRequestId
    ) {
      return null;
    }

    return data;
  }

  if (!referenceParam) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-16">
        <h1 className="text-2xl font-semibold text-slate-900">{headline}</h1>
        <p className="mt-3 text-slate-600">{detail}</p>
      </main>
    );
  }

  const verified = await verifyPaystackTransaction(referenceParam);
  const paystackReference = verified.ok ? verified.reference : referenceParam;

  const paymentRow = await loadBoundPaymentRequest(paystackReference);

  if (!paymentRow) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-16">
        <h1 className="text-2xl font-semibold text-slate-900">{headline}</h1>
        <p className="mt-3 text-slate-600">{detail}</p>
      </main>
    );
  }

  amountLabel = formatAmountGhs(
    Number(paymentRow.amount_requested),
  );
  invoiceLabel = paymentRow.invoice_no?.trim() || null;
  statusLabel = paymentRow.status ?? null;

  if (verified.ok) {
    statusLabel = verified.status;
    if (verified.status === "success") {
      const paidAmountGhs =
        verified.amount != null ? roundGhs(verified.amount / 100) : null;
      if (paidAmountGhs != null) {
        amountLabel = formatAmountGhs(paidAmountGhs);
      }
      const invoiceNo =
        paymentRequestId || paymentRow.id
          ? await tryFulfillCartSnapshot({
              paymentRequestId: paymentRequestId || String(paymentRow.id),
              reference: paystackReference,
              paidAmountGhs,
              paidAt: verified.paidAt,
              channel: verified.channel,
            })
          : null;
      headline = "Payment successful";
      detail = "Your payment was confirmed. You can close this window.";
      if (invoiceNo ?? invoiceLabel) {
        invoiceLabel = invoiceNo ?? invoiceLabel;
      }
      statusLabel = "paid";
    } else {
      headline = "Payment pending";
      detail =
        "Your payment is not confirmed yet. If you just paid, wait a moment and refresh.";
    }
  } else {
    headline = "Payment pending confirmation";
    detail =
      "We found your payment request but could not confirm it with Paystack yet. Try again shortly.";
    statusLabel = paymentRow.status ?? null;
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center px-6 py-16">
      <h1 className="text-2xl font-semibold text-slate-900">{headline}</h1>
      <p className="mt-3 text-slate-600">{detail}</p>
      <dl className="mt-6 space-y-2 text-sm text-slate-700">
        {amountLabel ? (
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">Amount</dt>
            <dd className="font-medium">{amountLabel}</dd>
          </div>
        ) : null}
        {statusLabel ? (
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">Status</dt>
            <dd className="font-medium capitalize">{statusLabel}</dd>
          </div>
        ) : null}
        {invoiceLabel ? (
          <div className="flex justify-between gap-4">
            <dt className="text-slate-500">Invoice</dt>
            <dd className="font-medium">{invoiceLabel}</dd>
          </div>
        ) : null}
      </dl>
    </main>
  );
}
