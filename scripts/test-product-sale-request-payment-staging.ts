/**
 * Staging automated checks for POS Request Payment (no browser).
 * Avoids importing server-only Next modules; calls Paystack + DB directly.
 * Usage: npx tsx scripts/test-product-sale-request-payment-staging.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  allocatePaymentAcrossLines,
  isRequestPaymentMethod,
  invoiceOutstanding,
  normalizeGhanaPhone,
  resolvePaystackCustomerEmail,
  roundGhs,
  type ProductSaleIncomeLine,
} from "../utils/product-sale-paystack";
import {
  PRODUCT_SALES_SELECT,
  normalizeProductSaleEntry,
} from "../app/dashboard/crm/product-sales-utils";

function loadEnvForce(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    process.env[t.slice(0, i).trim()] = t.slice(i + 1).trim();
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function ghsToPesewas(ghs: number): number {
  return Math.round(Number(ghs) * 100);
}

async function initializeOneOff(options: {
  email: string;
  amountPesewas: number;
  callbackUrl: string;
  metadata: Record<string, unknown>;
}): Promise<{ authorizationUrl: string; reference: string }> {
  const secret = (process.env.PAYSTACK_SECRET_KEY ?? "").trim();
  assert(
    secret.startsWith("sk_test_") || secret.startsWith("sk_live_"),
    "PAYSTACK_SECRET_KEY missing",
  );

  const response = await fetch("https://api.paystack.co/transaction/initialize", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${secret}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      email: options.email,
      amount: options.amountPesewas,
      callback_url: options.callbackUrl,
      currency: "GHS",
      channels: ["card", "mobile_money"],
      metadata: options.metadata,
    }),
  });
  const payload = (await response.json()) as {
    status?: boolean;
    message?: string;
    data?: { authorization_url?: string; reference?: string };
  };
  assert(
    response.ok && payload.status !== false,
    payload.message ?? "Paystack init failed",
  );
  const authorizationUrl = payload.data?.authorization_url?.trim() ?? "";
  const reference = payload.data?.reference?.trim() ?? "";
  assert(authorizationUrl && reference, "missing authorization_url/reference");
  return { authorizationUrl, reference };
}

async function applyProductSalePayment(
  admin: ReturnType<typeof createClient>,
  options: {
    paymentRequestId: string;
    reference: string;
    amountPesewas: number;
  },
) {
  const { data: requestRow, error } = await admin
    .from("product_sale_payment_requests")
    .select("id, tenant_id, invoice_no, income_ids, amount_requested, status")
    .eq("id", options.paymentRequestId)
    .maybeSingle();
  assert(!error && requestRow, error?.message ?? "request missing");
  if (requestRow.status === "paid") {
    return "already paid";
  }

  const incomeIds = requestRow.income_ids as string[];
  const { data: incomeRows, error: incomeError } = await admin
    .from("income_register")
    .select(
      "id, amount, amount_received, outstanding_balance, payment_status, sale_status, notes",
    )
    .eq("tenant_id", requestRow.tenant_id)
    .in("id", incomeIds);
  assert(!incomeError, incomeError?.message ?? "income query failed");

  const lines = ((incomeRows as ProductSaleIncomeLine[] | null) ?? []).filter(
    (row) => (row.sale_status ?? "active") !== "voided",
  );
  const applyAmount = roundGhs(options.amountPesewas / 100);
  const allocations = allocatePaymentAcrossLines(lines, applyAmount);

  for (const allocation of allocations) {
    const { error: updateError } = await admin
      .from("income_register")
      .update({
        amount_received: allocation.nextAmountReceived,
        outstanding_balance: allocation.nextOutstanding,
        payment_status: allocation.nextPaymentStatus,
      })
      .eq("id", allocation.id)
      .eq("tenant_id", requestRow.tenant_id);
    assert(!updateError, updateError?.message ?? "income update failed");
  }

  const { error: markError } = await admin
    .from("product_sale_payment_requests")
    .update({
      status: "paid",
      paid_amount: applyAmount,
      paid_at: new Date().toISOString(),
      paystack_reference: options.reference,
      updated_at: new Date().toISOString(),
    })
    .eq("id", requestRow.id);
  assert(!markError, markError?.message ?? "mark paid failed");
  return "applied";
}

async function main() {
  loadEnvForce(resolve(process.cwd(), ".env.staging.local"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  assert(url.includes("wieflwbfdmjtsdnwbfii"), "Refusing non-staging");

  const results: Record<string, unknown> = {};

  assert(!isRequestPaymentMethod("Cash"), "Cash must hide");
  assert(!isRequestPaymentMethod("Credit"), "Credit must hide");
  assert(isRequestPaymentMethod("POS"), "POS must show");
  assert(normalizeGhanaPhone("0244123456") === "+233244123456", "phone");
  assert(
    resolvePaystackCustomerEmail({
      deliveryEmail: null,
      invoiceNo: "CAN-POS-0001",
    }).includes("@noreply.davorsfacilities.com"),
    "synthetic email",
  );
  const alloc = allocatePaymentAcrossLines(
    [
      {
        id: "a",
        amount: 100,
        amount_received: 20,
        outstanding_balance: 80,
        payment_status: "Partial",
        sale_status: "active",
        notes: null,
      },
      {
        id: "b",
        amount: 50,
        amount_received: 0,
        outstanding_balance: 50,
        payment_status: "Pending",
        sale_status: "active",
        notes: null,
      },
    ],
    100,
  );
  assert(alloc[0].nextPaymentStatus === "Paid", "alloc A");
  assert(alloc[1].nextPaymentStatus === "Partial", "alloc B");
  results.helpers = "PASS";

  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { error: schemaError } = await admin
    .from("product_sale_payment_requests")
    .select("id")
    .limit(1);
  assert(!schemaError, schemaError?.message ?? "table missing");
  results.schema = "PASS";

  let { data: product } = await admin
    .from("finished_products")
    .select("id, current_stock, standard_selling_price, tenant_id")
    .gt("current_stock", 0)
    .order("product_name")
    .limit(1)
    .maybeSingle();

  let stockBoosted = false;
  let priorStock = 0;
  if (!product) {
    const { data: anyProduct } = await admin
      .from("finished_products")
      .select("id, current_stock, standard_selling_price, tenant_id")
      .order("product_name")
      .limit(1)
      .maybeSingle();
    assert(anyProduct, "No finished products");
    priorStock = Number(anyProduct.current_stock) || 0;
    await admin
      .from("finished_products")
      .update({ current_stock: priorStock + 1 })
      .eq("id", anyProduct.id);
    stockBoosted = true;
    product = { ...anyProduct, current_stock: priorStock + 1 };
  }

  const tenantId = product.tenant_id as string;
  const { data: customer } = await admin
    .from("customers")
    .select("client_id")
    .eq("tenant_id", tenantId)
    .order("client_name")
    .limit(1)
    .maybeSingle();
  assert(customer, "No customer");

  const unitPrice = Number(product.standard_selling_price) || 1;
  const qty = 0.001;
  const noteTag = `test-req-pay-${Date.now()}`;
  let incomeId: string | null = null;
  let paymentRequestId: string | null = null;

  try {
    const { data: createdId, error: createError } = await admin.rpc(
      "create_product_sale",
      {
        p_date: new Date().toISOString().slice(0, 10),
        p_invoice_no: null,
        p_client_id: customer.client_id,
        p_customer_name: null,
        p_product_id: product.id,
        p_quantity: qty,
        p_unit_price: unitPrice,
        p_amount_received: 0,
        p_payment_status: "Pending",
        p_due_date: new Date().toISOString().slice(0, 10),
        p_description: "Request payment staging test",
        p_notes: `Payment method: POS\n${noteTag}`,
      },
    );
    assert(!createError, createError?.message ?? "create failed");
    incomeId = typeof createdId === "string" ? createdId : null;
    if (!incomeId) {
      const { data: found } = await admin
        .from("income_register")
        .select("id")
        .eq("tenant_id", tenantId)
        .ilike("notes", `%${noteTag}%`)
        .limit(1)
        .maybeSingle();
      incomeId = found?.id ?? null;
    }
    assert(incomeId, "missing income id");

    const { data: saleRow } = await admin
      .from("income_register")
      .select(PRODUCT_SALES_SELECT)
      .eq("id", incomeId)
      .maybeSingle();
    assert(saleRow, "sale missing");
    const sale = normalizeProductSaleEntry(saleRow as never);
    const outstanding = invoiceOutstanding([
      {
        id: sale.id,
        amount: Number(sale.amount) || 0,
        amount_received: Number(sale.amount_received) || 0,
        outstanding_balance: sale.outstanding_balance,
        payment_status: sale.payment_status,
        sale_status: sale.sale_status ?? "active",
        notes: sale.notes,
      },
    ]);
    assert(outstanding > 0, "expected outstanding");

    const { data: inserted, error: insertError } = await admin
      .from("product_sale_payment_requests")
      .insert({
        tenant_id: tenantId,
        invoice_no: sale.invoice_no,
        income_ids: [sale.id],
        amount_requested: outstanding,
        currency: "GHS",
        status: "pending",
        payment_method: "POS",
        delivery_email: "request-payment-test@example.com",
        delivery_phone: "+233241234567",
        send_email: true,
        send_sms: false,
      })
      .select("id")
      .single();
    assert(
      !insertError && inserted?.id,
      insertError?.message ?? "insert failed",
    );
    paymentRequestId = inserted.id as string;

    const siteUrl = (
      process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000"
    ).replace(/\/$/, "");
    let initialized: { authorizationUrl: string; reference: string } | null =
      null;
    try {
      initialized = await initializeOneOff({
        email: "request-payment-test@example.com",
        amountPesewas: ghsToPesewas(outstanding),
        callbackUrl: `${siteUrl}/pay/product-sale/callback?payment_request_id=${paymentRequestId}`,
        metadata: {
          context: "product_sale",
          tenant_id: tenantId,
          invoice_no: sale.invoice_no,
          payment_request_id: paymentRequestId,
          income_ids: [sale.id],
        },
      });
      results.paystack_initialize = {
        ok: true,
        reference: initialized.reference,
        has_url: Boolean(initialized.authorizationUrl),
      };
    } catch (paystackError) {
      // Staging key may be unset/invalid — still verify DB apply path.
      results.paystack_initialize = {
        ok: false,
        error:
          paystackError instanceof Error
            ? paystackError.message
            : String(paystackError),
        note: "Skipped live Paystack initialize; simulated reference used for webhook apply.",
      };
      initialized = {
        authorizationUrl: "https://checkout.paystack.com/test-simulated",
        reference: `sim_${paymentRequestId.replace(/-/g, "").slice(0, 16)}`,
      };
    }

    await admin
      .from("product_sale_payment_requests")
      .update({
        paystack_reference: initialized.reference,
        authorization_url: initialized.authorizationUrl,
        status: "sent",
        updated_at: new Date().toISOString(),
      })
      .eq("id", paymentRequestId);

    const first = await applyProductSalePayment(admin, {
      paymentRequestId,
      reference: initialized.reference,
      amountPesewas: ghsToPesewas(outstanding),
    });
    assert(first === "applied", first);
    results.webhook_apply = first;

    const { data: afterSale } = await admin
      .from("income_register")
      .select("amount, amount_received, payment_status")
      .eq("id", incomeId)
      .maybeSingle();
    assert(afterSale, "sale after apply missing");
    assert(
      String(afterSale.payment_status).toLowerCase() === "paid",
      `expected Paid, got ${afterSale.payment_status}`,
    );

    const second = await applyProductSalePayment(admin, {
      paymentRequestId,
      reference: initialized.reference,
      amountPesewas: ghsToPesewas(outstanding),
    });
    assert(second === "already paid", second);
    results.idempotent = "PASS";

    console.log("PASS");
    console.log(JSON.stringify(results, null, 2));
  } finally {
    if (paymentRequestId) {
      await admin
        .from("product_sale_payment_requests")
        .delete()
        .eq("id", paymentRequestId);
    }
    if (incomeId) {
      const { error: voidError } = await admin.rpc("void_product_sale", {
        p_income_id: incomeId,
      });
      if (voidError) console.error("Cleanup void failed:", voidError.message);
    }
    if (stockBoosted && product) {
      await admin
        .from("finished_products")
        .update({ current_stock: priorStock })
        .eq("id", product.id);
    }
  }
}

main().catch((err) => {
  console.error("FAIL", err instanceof Error ? err.message : err);
  process.exit(1);
});
