/**
 * Staging smoke checks for POS Request Payment link (charge-first / cart_snapshot).
 * Does not complete a real charge; verifies cancel-path DB + optional Paystack init.
 * Usage: npx tsx scripts/test-pos-request-payment-link-staging.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

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

function paymentMethodFromPaystackChannel(
  channel: string | null | undefined,
  fallback: string,
): string {
  const normalized = (channel ?? "").trim().toLowerCase();
  if (
    normalized === "mobile_money" ||
    normalized.includes("mobile_money") ||
    normalized === "mobile money"
  ) {
    return "Mobile Money";
  }
  if (normalized === "card") {
    return "Card";
  }
  if (
    normalized === "bank" ||
    normalized === "bank_transfer" ||
    normalized.includes("bank")
  ) {
    return "Bank Transfer";
  }
  return fallback.trim() || "POS";
}

async function main() {
  loadEnvForce(resolve(process.cwd(), ".env.staging.local"));

  const secret = (process.env.PAYSTACK_SECRET_KEY ?? "").trim();
  const publicKey = (process.env.NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY ?? "").trim();
  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim();
  const serviceKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? "").trim();

  assert(
    supabaseUrl.includes("wieflwbfdmjtsdnwbfii"),
    "Refusing non-staging Supabase URL",
  );

  console.log(
    "NEXT_PUBLIC_PAYSTACK_PUBLIC_KEY:",
    publicKey ? `PRESENT (len=${publicKey.length})` : "MISSING",
  );
  console.log(
    "PAYSTACK_SECRET_KEY:",
    secret
      ? `PRESENT (len=${secret.length}, prefix=${secret.slice(0, 8)}…)`
      : "MISSING",
  );

  assert(
    secret.startsWith("sk_test_") || secret.startsWith("sk_live_"),
    "PAYSTACK_SECRET_KEY missing",
  );
  assert(supabaseUrl, "NEXT_PUBLIC_SUPABASE_URL missing");
  assert(serviceKey, "SUPABASE_SERVICE_ROLE_KEY missing");

  assert(
    paymentMethodFromPaystackChannel("card", "POS") === "Card",
    "channel map card",
  );
  assert(
    paymentMethodFromPaystackChannel("mobile_money", "POS") === "Mobile Money",
    "channel map momo",
  );
  console.log("Channel mapping helpers: OK");

  const amountGhs = 2.25;
  const snapshot = {
    saleDate: new Date().toISOString().slice(0, 10),
    clientId: null as string | null,
    customerName: "Request Payment Link Smoke",
    notes: "cancel-path smoke — no sale until webhook",
    dueDate: new Date().toISOString().slice(0, 10),
    lines: [
      {
        id: crypto.randomUUID(),
        productId: "00000000-0000-4000-8000-000000000002",
        productCode: "LINK-SMOKE-1",
        productName: "Link Smoke Line",
        unitOfMeasure: "ea",
        quantity: 1,
        unitPrice: amountGhs,
      },
    ],
  };

  let paystackOk = false;
  let paystackMessage = "";
  let reference = `link_smoke_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
  let authorizationUrl: string | null = null;

  try {
    const initResponse = await fetch(
      "https://api.paystack.co/transaction/initialize",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: "pos-request-payment-smoke@davorsfacilities.com",
          amount: Math.round(amountGhs * 100),
          currency: "GHS",
          channels: ["card", "mobile_money"],
          callback_url: "https://example.com/pay/product-sale/callback",
          metadata: {
            context: "product_sale",
            flow: "pos_request_payment_link_smoke",
          },
        }),
      },
    );
    const initPayload = (await initResponse.json()) as {
      status?: boolean;
      message?: string;
      data?: {
        authorization_url?: string;
        reference?: string;
      };
    };
    if (!initResponse.ok || initPayload.status === false) {
      paystackMessage =
        initPayload.message ?? `HTTP ${initResponse.status}`;
      console.log("Paystack Request Payment initialize: BLOCKED —", paystackMessage);
    } else {
      authorizationUrl =
        initPayload.data?.authorization_url?.trim() ?? null;
      reference = initPayload.data?.reference?.trim() || reference;
      assert(authorizationUrl, "Paystack did not return authorization_url");
      assert(reference, "Paystack did not return reference");
      paystackOk = true;
      console.log(
        "Paystack Request Payment initialize: OK (card+mobile_money channels, authorization_url present)",
      );
    }
  } catch (error) {
    paystackMessage =
      error instanceof Error ? error.message : String(error);
    console.log(
      "Paystack Request Payment initialize: BLOCKED —",
      paystackMessage,
    );
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: tenantRow, error: tenantError } = await admin
    .from("tenants")
    .select("id")
    .limit(1)
    .maybeSingle();
  assert(!tenantError, tenantError?.message ?? "tenant lookup failed");
  assert(tenantRow?.id, "No tenant found on staging");

  // Capture stock of a real product before insert (cancel path must not touch stock)
  const { data: product } = await admin
    .from("finished_products")
    .select("id, current_stock")
    .gte("current_stock", 1)
    .order("product_name")
    .limit(1)
    .maybeSingle();

  const stockBefore =
    product != null ? Number(product.current_stock) || 0 : null;

  const provisionalInvoice = `LINK-PENDING-${crypto.randomUUID().slice(0, 8)}`;
  const { data: inserted, error: insertError } = await admin
    .from("product_sale_payment_requests")
    .insert({
      tenant_id: tenantRow.id,
      invoice_no: provisionalInvoice,
      income_ids: [],
      cart_snapshot: snapshot,
      amount_requested: amountGhs,
      currency: "GHS",
      status: "sent",
      payment_method: "POS",
      paystack_reference: reference,
      authorization_url: authorizationUrl,
      delivery_email: "pos-request-payment-smoke@davorsfacilities.com",
      delivery_phone: null,
      send_email: true,
      send_sms: false,
    })
    .select("id, income_ids, cart_snapshot, status, invoice_no")
    .single();

  assert(!insertError && inserted?.id, insertError?.message ?? "insert failed");
  const incomeIds = Array.isArray(inserted.income_ids)
    ? inserted.income_ids.filter(Boolean)
    : [];
  assert(
    incomeIds.length === 0,
    "Cancel-path expectation failed: income_ids should be empty before payment",
  );
  assert(
    inserted.cart_snapshot != null,
    "cart_snapshot missing on payment request",
  );
  assert(
    inserted.status === "sent",
    `expected status sent, got ${inserted.status}`,
  );
  assert(
    String(inserted.invoice_no).startsWith("LINK-PENDING-"),
    "provisional invoice should be LINK-PENDING-*",
  );

  const { count, error: incomeCountError } = await admin
    .from("income_register")
    .select("id", { count: "exact", head: true })
    .eq("invoice_no", provisionalInvoice);
  assert(!incomeCountError, incomeCountError?.message ?? "income count failed");
  assert(
    (count ?? 0) === 0,
    "Cancel path must not create income_register rows before payment",
  );

  if (product && stockBefore != null) {
    const { data: stockAfterRow } = await admin
      .from("finished_products")
      .select("current_stock")
      .eq("id", product.id)
      .maybeSingle();
    const stockAfter = Number(stockAfterRow?.current_stock) || 0;
    assert(
      stockAfter === stockBefore,
      `Stock changed on unpaid link (before=${stockBefore}, after=${stockAfter})`,
    );
  }

  console.log(
    "Cancel-path DB check: OK (payment_request + cart_snapshot, empty income_ids, zero income rows, stock unchanged)",
  );

  // Fulfillment smoke: simulate webhook create-sale-from-cart_snapshot using a
  // real finished product + create_product_sale (skipVerify), then void/cleanup.
  let fulfillOk = false;
  if (product) {
    // amount_requested must satisfy product_sale_payment_requests_amount_positive
    const unitPrice = 1;
    const qty = 1;
    const lineTotal = unitPrice * qty;
    const fulfillSnapshot = {
      ...snapshot,
      customerName: "Request Payment Fulfill Smoke",
      lines: [
        {
          id: crypto.randomUUID(),
          productId: product.id as string,
          productCode: "FULFILL",
          productName: "Fulfill Smoke",
          unitOfMeasure: "ea",
          quantity: qty,
          unitPrice,
        },
      ],
    };

    const fulfillInvoice = `LINK-PENDING-${crypto.randomUUID().slice(0, 8)}`;
    const { data: fulfillReq, error: fulfillInsertError } = await admin
      .from("product_sale_payment_requests")
      .insert({
        tenant_id: tenantRow.id,
        invoice_no: fulfillInvoice,
        income_ids: [],
        cart_snapshot: fulfillSnapshot,
        amount_requested: lineTotal,
        currency: "GHS",
        status: "sent",
        payment_method: "POS",
        paystack_reference: `sim_fulfill_${crypto.randomUUID().slice(0, 8)}`,
        send_email: false,
        send_sms: false,
      })
      .select("id")
      .single();
    assert(
      !fulfillInsertError && fulfillReq?.id,
      fulfillInsertError?.message ?? "fulfill insert failed",
    );

    const stockBeforeFulfill = Number(
      (
        await admin
          .from("finished_products")
          .select("current_stock")
          .eq("id", product.id)
          .maybeSingle()
      ).data?.current_stock,
    );

    // Inline minimal fulfill (mirrors fulfillPosCartSnapshotPaymentRequest)
    const { data: incomeId, error: saleError } = await admin.rpc(
      "create_product_sale",
      {
        p_date: fulfillSnapshot.saleDate,
        p_invoice_no: null,
        p_client_id: null,
        p_customer_name: fulfillSnapshot.customerName,
        p_product_id: product.id,
        p_quantity: qty,
        p_unit_price: unitPrice,
        p_amount_received: lineTotal,
        p_payment_status: "Paid",
        p_due_date: fulfillSnapshot.dueDate,
        p_description: null,
        p_notes: "Payment method: Card\nfulfill smoke",
        p_invoice_entity_type: "POS",
      },
    );
    assert(!saleError && incomeId, saleError?.message ?? "create_product_sale failed");

    const { data: saleRow } = await admin
      .from("income_register")
      .select("id, invoice_no, payment_status")
      .eq("id", incomeId as string)
      .maybeSingle();
    assert(saleRow?.invoice_no, "sale missing invoice_no");
    assert(
      String(saleRow?.payment_status).toLowerCase() === "paid",
      `expected Paid, got ${saleRow?.payment_status}`,
    );

    await admin
      .from("product_sale_payment_requests")
      .update({
        status: "paid",
        invoice_no: saleRow.invoice_no,
        income_ids: [incomeId],
        payment_method: "Card",
        paid_amount: lineTotal,
        paid_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", fulfillReq.id);

    const stockAfterFulfill = Number(
      (
        await admin
          .from("finished_products")
          .select("current_stock")
          .eq("id", product.id)
          .maybeSingle()
      ).data?.current_stock,
    );
    assert(
      stockAfterFulfill < stockBeforeFulfill - 0.0000001 ||
        Math.abs(stockAfterFulfill - (stockBeforeFulfill - qty)) < 0.0001,
      `Expected stock decrease after fulfill (before=${stockBeforeFulfill}, after=${stockAfterFulfill})`,
    );

    await admin.rpc("void_product_sale", { p_income_id: incomeId });
    await admin
      .from("product_sale_payment_requests")
      .delete()
      .eq("id", fulfillReq.id);
    fulfillOk = true;
    console.log(
      "Fulfill-path DB check: OK (Paid sale created, stock moved, then voided/cleaned)",
    );
  } else {
    console.log(
      "Fulfill-path DB check: SKIPPED (no finished_products with stock)",
    );
  }

  await admin
    .from("product_sale_payment_requests")
    .delete()
    .eq("id", inserted.id);
  console.log("Cleanup: deleted smoke payment_request", inserted.id);

  if (!paystackOk) {
    console.log(
      JSON.stringify(
        {
          cancel_path: "PASS",
          fulfill_path: fulfillOk ? "PASS" : "SKIPPED",
          paystack_initialize: { ok: false, error: paystackMessage },
        },
        null,
        2,
      ),
    );
    console.log(
      "DB cancel-path PASSED; Paystack initialize BLOCKED (fix secret key).",
    );
    process.exit(2);
  }

  console.log(
    JSON.stringify(
      {
        cancel_path: "PASS",
        fulfill_path: fulfillOk ? "PASS" : "SKIPPED",
        paystack_initialize: { ok: true, reference },
      },
      null,
      2,
    ),
  );
  console.log("ALL SMOKE CHECKS PASSED");
}

main().catch((error) => {
  console.error(
    "SMOKE FAILED:",
    error instanceof Error ? error.message : error,
  );
  process.exit(1);
});
