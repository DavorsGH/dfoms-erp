/**
 * Staging: Check payment for DF-PSI-0009 / a5fnj1itpj (Part 7.6).
 *   npx tsx --conditions=react-server scripts/tmp/r51-check-df-psi-0009-staging.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadEnvForce(filePath: string) {
  for (const line of readFileSync(resolve(filePath), "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    let v = t.slice(i + 1).trim();
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    ) {
      v = v.slice(1, -1);
    }
    process.env[t.slice(0, i).trim()] = v;
  }
}

async function main() {
  loadEnvForce(".env.staging.local");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("staging env missing");
  if (!process.env.PAYSTACK_SECRET_KEY) {
    throw new Error("PAYSTACK_SECRET_KEY missing in staging env");
  }

  const admin = createClient(url, key, { auth: { persistSession: false } });
  const requestId = "453bc7e2-a223-419c-8cc0-088d64a78400";
  const reference = "a5fnj1itpj";

  const { data: before, error: beforeErr } = await admin
    .from("product_sale_payment_requests")
    .select("id, status, paystack_reference, amount, invoice_no, tenant_id")
    .eq("id", requestId)
    .maybeSingle();
  if (beforeErr) throw beforeErr;
  console.log("before request", before);

  const { confirmProductSalePaystackPayment } = await import(
    "../../utils/paystack-product-sale-confirm"
  );

  const result = await confirmProductSalePaystackPayment({
    paymentRequestId: requestId,
    reference,
    source: "check_payment",
    tenantId: before?.tenant_id ?? null,
  });
  console.log("confirm result", result);

  const { data: after } = await admin
    .from("product_sale_payment_requests")
    .select("id, status, paystack_reference, amount, invoice_no")
    .eq("id", requestId)
    .maybeSingle();
  console.log("after request", after);

  const { data: income } = await admin
    .from("income_register")
    .select("id, invoice_no, amount, amount_received, payment_status, notes")
    .eq("invoice_no", "DF-PSI-0009");
  console.log("income", income);

  const incomeIds = (income ?? []).map((r) => r.id);
  if (incomeIds.length) {
    const { data: payments } = await admin
      .from("product_sale_payments")
      .select("id, amount, payment_method, notes, income_id, payment_date")
      .in("income_id", incomeIds);
    console.log("payments", payments);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
