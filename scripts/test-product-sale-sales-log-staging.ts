/**
 * Staging: create a Product Sale, confirm Sales Log includes it, build receipt data.
 * Usage: npx tsx scripts/test-product-sale-sales-log-staging.ts
 * Cleans up by voiding the created sale when possible.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  mergeSalesLogEntries,
  normalizeProductSaleForLog,
  normalizeWebhookSale,
} from "../app/dashboard/crm/sales/sales-utils";
import {
  getIncomeCustomerDisplayName,
  getProductSaleProductLabel,
  normalizeProductSaleEntry,
  PRODUCT_SALES_SELECT,
  type ProductSaleEntry,
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

async function main() {
  loadEnvForce(resolve(process.cwd(), ".env.staging.local"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  assert(url.includes("wieflwbfdmjtsdnwbfii"), "Refusing non-staging");

  const admin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // Prefer any stocked product; if none, temporarily add stock on one Davors/any product.
  let { data: product } = await admin
    .from("finished_products")
    .select(
      "id, product_name, product_code, current_stock, standard_selling_price, tenant_id, unit_of_measure",
    )
    .gt("current_stock", 0)
    .order("product_name")
    .limit(1)
    .maybeSingle();

  let stockBoosted = false;
  let priorStock = 0;

  if (!product) {
    const { data: anyProduct, error: anyError } = await admin
      .from("finished_products")
      .select(
        "id, product_name, product_code, current_stock, standard_selling_price, tenant_id, unit_of_measure",
      )
      .order("product_name")
      .limit(1)
      .maybeSingle();
    assert(!anyError && anyProduct, anyError?.message ?? "No finished products on staging");
    priorStock = Number(anyProduct.current_stock) || 0;
    const { error: boostError } = await admin
      .from("finished_products")
      .update({ current_stock: priorStock + 1 })
      .eq("id", anyProduct.id);
    assert(!boostError, boostError?.message ?? "stock boost failed");
    stockBoosted = true;
    product = { ...anyProduct, current_stock: priorStock + 1 };
  }

  const tenantId = product.tenant_id as string;

  const { data: customer, error: customerError } = await admin
    .from("customers")
    .select("client_id, client_name")
    .eq("tenant_id", tenantId)
    .order("client_name")
    .limit(1)
    .maybeSingle();
  assert(!customerError && customer, customerError?.message ?? "No customer for tenant");

  const unitPrice = Number(product.standard_selling_price) || 1;
  const qty = 0.001;
  const amount = Math.round(qty * unitPrice * 100) / 100;
  const noteTag = `test-sales-log-${Date.now()}`;

  let incomeId: string | null = null;

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
        p_amount_received: amount,
        p_payment_status: "Paid",
        p_due_date: new Date().toISOString().slice(0, 10),
        p_description: "Sales log staging test sale",
        p_notes: noteTag,
      },
    );
    assert(!createError, createError?.message ?? "create_product_sale failed");

    incomeId = typeof createdId === "string" ? createdId : null;
    if (!incomeId) {
      const { data: found } = await admin
        .from("income_register")
        .select("id")
        .eq("tenant_id", tenantId)
        .eq("entry_type", "product_sale")
        .eq("notes", noteTag)
        .order("date", { ascending: false })
        .limit(1)
        .maybeSingle();
      incomeId = found?.id ?? null;
    }
    assert(incomeId, "Could not resolve created income_register id");

    const [
      { data: productSaleRows, error: productSaleError },
      { data: webhookRows, error: webhookError },
    ] = await Promise.all([
      admin
        .from("income_register")
        .select(PRODUCT_SALES_SELECT)
        .eq("tenant_id", tenantId)
        .eq("entry_type", "product_sale")
        .order("date", { ascending: false }),
      admin
        .from("crm_sales")
        .select(
          "id, sale_date, amount, payment_status, payment_method, customer_id, product_id, customer:customers!crm_sales_customer_id_fkey(client_id, client_name), product:crm_products!product_id(name)",
        )
        .eq("tenant_id", tenantId)
        .order("sale_date", { ascending: false }),
    ]);

    assert(!productSaleError, productSaleError?.message ?? "product sale query failed");
    assert(!webhookError, webhookError?.message ?? "webhook sale query failed");

    const productSales = ((productSaleRows as ProductSaleEntry[]) ?? []).map(
      (row) => normalizeProductSaleForLog(row),
    );
    const webhookSales = (webhookRows ?? []).map((row) =>
      normalizeWebhookSale(row as never),
    );
    const merged = mergeSalesLogEntries(productSales, webhookSales);
    const foundInLog = merged.find((sale) => sale.id === incomeId);
    assert(foundInLog, "Created product sale missing from Sales Log merge");

    // Existing product sales also surface (same query)
    assert(
      productSales.length >= 1,
      "Expected at least the new product sale in income_register query",
    );

    const { data: fullSale, error: fullSaleError } = await admin
      .from("income_register")
      .select(PRODUCT_SALES_SELECT)
      .eq("id", incomeId)
      .maybeSingle();
    assert(!fullSaleError && fullSale, fullSaleError?.message ?? "sale missing");

    const entry = normalizeProductSaleEntry(fullSale as ProductSaleEntry);
    const receipt = {
      invoiceNo: entry.invoice_no,
      customerLabel: getIncomeCustomerDisplayName(entry, [customer]),
      productLabel: getProductSaleProductLabel(entry),
      amount: Number(entry.amount) || 0,
      amountReceived: Number(entry.amount_received) || 0,
      paymentStatus: entry.payment_status,
      saleStatus: entry.sale_status === "voided" ? "Voided" : "Active",
    };

    assert(receipt.invoiceNo, "Receipt missing invoice number");
    assert(receipt.paymentStatus === "Paid", "Receipt payment status mismatch");

    console.log(
      JSON.stringify(
        {
          tenant_id: tenantId,
          created_income_id: incomeId,
          invoice_no: foundInLog.invoice_no,
          sales_log_count: merged.length,
          product_sale_count: productSales.length,
          webhook_count: webhookSales.length,
          found_in_sales_log: true,
          receipt,
        },
        null,
        2,
      ),
    );
  } finally {
    if (incomeId) {
      const { error: voidError } = await admin.rpc("void_product_sale", {
        p_income_id: incomeId,
      });
      if (voidError) {
        console.error("Cleanup void failed:", voidError.message);
      } else {
        console.log("Cleanup: voided test sale", incomeId);
      }
    }
    if (stockBoosted && product) {
      await admin
        .from("finished_products")
        .update({ current_stock: priorStock })
        .eq("id", product.id);
    }
  }

  console.log(
    "PASS: Product Sale appears in Sales Log; existing product sales queried; receipt fields OK",
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
