import type { SupabaseClient } from "@supabase/supabase-js";
import { toNumber } from "@/utils/client-invoices-types";
import { notifyProductSalePaymentReceived } from "@/utils/product-sale-payment-notifications";
import {
  allocatePaymentAcrossLines,
  lineOutstanding,
  roundGhs,
  type ProductSaleIncomeLine,
} from "@/utils/product-sale-paystack";
import {
  PRODUCT_SALE_PAYMENT_SELECT,
  type ProductSalePaymentRow,
  type RecordProductSalePaymentBody,
} from "@/utils/product-sale-payments-types";

type DbClient = SupabaseClient;

const INCOME_ROW_SELECT =
  "id, tenant_id, entry_type, invoice_no, client_id, customer_name, amount, amount_received, outstanding_balance, payment_status, sale_status, wht_amount" as const;

type ProductSaleIncomeRow = ProductSaleIncomeLine & {
  tenant_id: string;
  entry_type: string;
  invoice_no: string | null;
  client_id: string | null;
  customer_name: string | null;
  wht_amount: number | null;
};

function nullableText(value: string | null | undefined) {
  const trimmed = (value ?? "").trim();
  return trimmed ? trimmed : null;
}

export async function recordProductSalePayment(
  supabase: DbClient,
  tenantId: string,
  incomeId: string,
  body: RecordProductSalePaymentBody,
  recordedBy: string | null,
): Promise<{
  payment: ProductSalePaymentRow | null;
  income: ProductSaleIncomeRow | null;
  error: string | null;
}> {
  const { data: income, error: incomeError } = await supabase
    .from("income_register")
    .select(INCOME_ROW_SELECT)
    .eq("id", incomeId)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (incomeError) {
    return { payment: null, income: null, error: incomeError.message };
  }

  if (!income) {
    return { payment: null, income: null, error: "Product sale not found." };
  }

  const row = income as ProductSaleIncomeRow;

  if (row.entry_type !== "product_sale") {
    return {
      payment: null,
      income: null,
      error: "This record is not a product sale.",
    };
  }

  if ((row.sale_status ?? "active") === "voided") {
    return {
      payment: null,
      income: null,
      error: "Cannot record payment against a voided sale.",
    };
  }

  const outstanding = lineOutstanding(row);
  if (outstanding <= 0) {
    return {
      payment: null,
      income: null,
      error: "This sale has no outstanding balance.",
    };
  }

  const amount = roundGhs(toNumber(body.amount));
  if (amount > outstanding + 0.009) {
    return {
      payment: null,
      income: null,
      error: `Payment amount exceeds outstanding balance (${outstanding.toFixed(2)}).`,
    };
  }

  const { data: payment, error: paymentError } = await supabase
    .from("product_sale_payments")
    .insert({
      tenant_id: tenantId,
      income_id: incomeId,
      payment_date: body.payment_date,
      amount,
      payment_method: nullableText(body.payment_method ?? null),
      notes: nullableText(body.notes ?? null),
      recorded_by: recordedBy,
    })
    .select(PRODUCT_SALE_PAYMENT_SELECT)
    .single();

  if (paymentError || !payment) {
    return {
      payment: null,
      income: null,
      error: paymentError?.message ?? "Unable to record payment.",
    };
  }

  const [allocation] = allocatePaymentAcrossLines([row], amount);
  if (!allocation) {
    await supabase
      .from("product_sale_payments")
      .delete()
      .eq("id", payment.id)
      .eq("tenant_id", tenantId);
    return {
      payment: null,
      income: null,
      error: "Unable to allocate payment to the sale.",
    };
  }

  const { data: updatedIncome, error: updateError } = await supabase
    .from("income_register")
    .update({
      amount_received: allocation.nextAmountReceived,
      outstanding_balance: allocation.nextOutstanding,
      payment_status: allocation.nextPaymentStatus,
    })
    .eq("id", incomeId)
    .eq("tenant_id", tenantId)
    .select(INCOME_ROW_SELECT)
    .single();

  if (updateError || !updatedIncome) {
    await supabase
      .from("product_sale_payments")
      .delete()
      .eq("id", payment.id)
      .eq("tenant_id", tenantId);
    return {
      payment: null,
      income: null,
      error: updateError?.message ?? "Payment recorded but sale totals could not be updated.",
    };
  }

  const paymentReference =
    nullableText(body.notes ?? null) ??
    nullableText(body.payment_method ?? null) ??
    null;

  void notifyProductSalePaymentReceived({
    tenantId,
    incomeId,
    clientId: row.client_id,
    customerNameFallback: row.customer_name,
    invoiceNo: row.invoice_no?.trim() || "",
    amountReceived: amount,
    outstandingAfter: allocation.nextOutstanding,
    paymentReference,
  });

  return {
    payment: {
      ...(payment as ProductSalePaymentRow),
      amount: toNumber(payment.amount),
    },
    income: updatedIncome as ProductSaleIncomeRow,
    error: null,
  };
}
