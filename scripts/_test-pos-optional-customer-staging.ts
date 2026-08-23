/**
 * Staging: POS optional customer — real customer / Other walk-in / anonymous.
 *
 * Prerequisites: migration 235 applied on staging.
 *
 *   npx tsx scripts/_test-pos-optional-customer-staging.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { getIncomeCustomerDisplayName } from "../app/dashboard/finance/income-register-utils";
import {
  getCustomerDisplayName,
  resolvePosCustomerSelection,
} from "../app/dashboard/pos/pos-utils";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const DAVORS_TENANT_ID = "00000001-0000-4000-8000-000000000001";

function loadEnvForce(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const i = t.indexOf("=");
    if (i === -1) continue;
    let v = t.slice(i + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    process.env[t.slice(0, i).trim()] = v;
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function main() {
  loadEnvForce(resolve(".env.staging.local"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  assert(url.includes(STAGING_REF), "Expected staging");
  assert(serviceKey, "Missing service role key");

  const admin = createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const today = new Date().toISOString().slice(0, 10);
  const tag = `pos-opt-cust-${Date.now()}`;

  const { data: product, error: productError } = await admin
    .from("finished_products")
    .select("id, product_code, product_name, current_stock, standard_selling_price, unit_of_measure")
    .eq("tenant_id", DAVORS_TENANT_ID)
    .gt("current_stock", 3)
    .order("product_code")
    .limit(1)
    .maybeSingle();
  assert(!productError && product, productError?.message ?? "No stocked Davors product");

  const { data: customer, error: customerError } = await admin
    .from("customers")
    .select("client_id, client_name")
    .eq("tenant_id", DAVORS_TENANT_ID)
    .order("client_name")
    .limit(1)
    .maybeSingle();
  assert(!customerError && customer, customerError?.message ?? "No Davors customer");

  const unitPrice = Number(product!.standard_selling_price) || 5;
  const qty = 0.01;
  const createdIds: string[] = [];
  const stockBefore = Number(product!.current_stock);

  console.log("\n=== POS optional customer staging probe ===\n");
  console.log("Product:", product!.product_code, "stock=", stockBefore);
  console.log("Customer:", customer!.client_name);

  // Unit helper mirrors POS resolve
  {
    const a = resolvePosCustomerSelection(customer!.client_id, "ignored");
    assert(a.clientId === customer!.client_id && a.customerName === null, "resolve real customer");
    const b = resolvePosCustomerSelection("__other__", "Walk-in Ada");
    assert(b.clientId === null && b.customerName === "Walk-in Ada", "resolve Other+name");
    const c = resolvePosCustomerSelection("", "");
    assert(c.clientId === null && c.customerName === null, "resolve empty");
    const d = resolvePosCustomerSelection("__other__", "  ");
    assert(d.clientId === null && d.customerName === null, "resolve Other empty name");
    console.log("[PASS] resolvePosCustomerSelection unit cases");
  }

  async function createSale(options: {
    label: string;
    clientId: string | null;
    customerName: string | null;
  }) {
    const stockProbe = await admin
      .from("finished_products")
      .select("current_stock")
      .eq("id", product!.id)
      .single();
    const before = Number(stockProbe.data?.current_stock);

    const { data: incomeId, error } = await admin.rpc("create_product_sale", {
      p_date: today,
      p_invoice_no: null,
      p_client_id: options.clientId,
      p_customer_name: options.customerName,
      p_product_id: product!.id,
      p_quantity: qty,
      p_unit_price: unitPrice,
      p_amount_received: Math.round(qty * unitPrice * 100) / 100,
      p_payment_status: "Paid",
      p_due_date: today,
      p_description: `${tag}-${options.label}`,
      p_notes: `Payment method: Cash\n${tag}`,
      p_invoice_entity_type: "POS",
      p_sales_rep_id: null,
    });
    assert(!error && incomeId, `${options.label}: ${error?.message ?? "no id"}`);
    createdIds.push(String(incomeId));

    const { data: row, error: rowError } = await admin
      .from("income_register")
      .select(
        "id, invoice_no, client_id, customer_name, amount, amount_received, cogs_expense_id, entry_type, client:customers!income_register_client_id_fkey(client_id, client_name)",
      )
      .eq("id", incomeId)
      .single();
    assert(!rowError && row, rowError?.message ?? "missing income row");

    const stockAfterProbe = await admin
      .from("finished_products")
      .select("current_stock")
      .eq("id", product!.id)
      .single();
    const after = Number(stockAfterProbe.data?.current_stock);
    assert(
      Math.abs(before - after - qty) < 0.0001,
      `${options.label}: stock not deducted (before=${before} after=${after})`,
    );
    assert(row!.cogs_expense_id, `${options.label}: missing COGS expense link`);
    assert(row!.entry_type === "product_sale", `${options.label}: wrong entry_type`);

    const display = getIncomeCustomerDisplayName(
      {
        client_id: row!.client_id,
        customer_name: row!.customer_name,
        client: Array.isArray(row!.client) ? row!.client[0] : row!.client,
      },
      [{ client_id: customer!.client_id, client_name: customer!.client_name }],
    );

    console.log(
      `[PASS] ${options.label}: invoice=${row!.invoice_no} client_id=${row!.client_id} customer_name=${row!.customer_name} display="${display}" stock ${before}→${after}`,
    );
    return { row, display };
  }

  try {
    // (a) real customer
    const a = await createSale({
      label: "real-customer",
      clientId: customer!.client_id,
      customerName: null,
    });
    assert(a.row!.client_id === customer!.client_id, "real customer client_id");
    assert(a.row!.customer_name == null, "real customer should clear customer_name");
    assert(a.display === customer!.client_name, "real customer display name");

    // (b) Other / Walk-in + typed name
    const walkIn = `Walk-in ${tag}`;
    const b = await createSale({
      label: "other-walk-in",
      clientId: null,
      customerName: walkIn,
    });
    assert(b.row!.client_id == null, "walk-in client_id null");
    assert(b.row!.customer_name === walkIn, "walk-in customer_name stored");
    assert(b.display === walkIn, "walk-in display");

    // (c) no customer, no name
    const c = await createSale({
      label: "anonymous",
      clientId: null,
      customerName: null,
    });
    assert(c.row!.client_id == null, "anon client_id null");
    assert(c.row!.customer_name == null, "anon customer_name null");
    assert(c.display === "—", `anon display expected "—", got "${c.display}"`);
    assert(
      getCustomerDisplayName(null, null, []) === "—",
      "POS receipt helper shows —",
    );

    console.log("\nALL POS OPTIONAL-CUSTOMER PROBES PASSED\n");
  } finally {
    for (const id of createdIds) {
      const { data: sale } = await admin
        .from("income_register")
        .select("id, cogs_expense_id, product_id, sale_quantity")
        .eq("id", id)
        .maybeSingle();
      if (!sale) continue;
      // Prefer void RPC if available; else restore stock + delete COGS + income.
      const { error: voidError } = await admin.rpc("void_product_sale", {
        p_income_id: id,
      });
      if (voidError) {
        if (sale.cogs_expense_id) {
          await admin.from("expense_register").delete().eq("id", sale.cogs_expense_id);
        }
        await admin.from("stock_movements").delete().eq("reference_id", id);
        if (sale.product_id && sale.sale_quantity) {
          const { data: fp } = await admin
            .from("finished_products")
            .select("current_stock")
            .eq("id", sale.product_id)
            .single();
          if (fp) {
            await admin
              .from("finished_products")
              .update({
                current_stock:
                  Number(fp.current_stock) + Number(sale.sale_quantity),
              })
              .eq("id", sale.product_id);
          }
        }
        await admin.from("income_register").delete().eq("id", id);
      }
    }
    console.log(`Cleaned up ${createdIds.length} probe sale(s)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
