import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const TEST_INVOICES = [
  "PH3-1784020981979",
  "PH3-1784021432302",
  "PH5-1784023816048",
];

function loadEnvFile(filePath) {
  const contents = readFileSync(filePath, "utf8");
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separatorIndex = trimmed.indexOf("=");
    if (separatorIndex === -1) continue;
    const key = trimmed.slice(0, separatorIndex).trim();
    const value = trimmed.slice(separatorIndex + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

function assertClose(actual, expected, label) {
  const diff = Math.abs(Number(actual) - Number(expected));
  if (diff > 0.0001) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

async function verifyVoidedSale(supabase, verifyInvoice, verifySale) {
  const restoreQty = Number(verifySale.sale_quantity) || 0;

  const { data: voidedSale, error: voidedError } = await supabase
    .from("income_register")
    .select(
      "id, sale_status, voided_at, cogs_expense_id, cogs_reversal_expense_id, product:finished_products!product_id(current_stock)",
    )
    .eq("id", verifySale.id)
    .single();

  if (voidedError) throw new Error(voidedError.message);
  if (voidedSale.sale_status !== "voided") {
    throw new Error("Sale status was not set to voided");
  }
  if (!voidedSale.voided_at) {
    throw new Error("voided_at was not set");
  }
  if (!voidedSale.cogs_reversal_expense_id) {
    throw new Error("COGS reversal expense was not linked");
  }

  const { data: movements, error: movementError } = await supabase
    .from("stock_movements")
    .select("movement_type, quantity, notes")
    .eq("reference_id", verifySale.id)
    .order("created_at", { ascending: true });

  if (movementError) throw new Error(movementError.message);

  const saleOutRows = (movements ?? []).filter((row) => row.movement_type === "sale_out");
  const adjustmentRows = (movements ?? []).filter(
    (row) => row.movement_type === "adjustment",
  );

  if (saleOutRows.length !== 1) {
    throw new Error(`Expected 1 sale_out movement, found ${saleOutRows.length}`);
  }
  if (adjustmentRows.length !== 1) {
    throw new Error(`Expected 1 adjustment movement, found ${adjustmentRows.length}`);
  }
  if (!adjustmentRows[0].notes?.includes(verifyInvoice)) {
    throw new Error("Adjustment movement notes missing invoice reference");
  }
  assertClose(adjustmentRows[0].quantity, restoreQty, "Adjustment quantity");

  const { data: reversalExpense, error: reversalError } = await supabase
    .from("expense_register")
    .select("amount, receipt_no")
    .eq("id", voidedSale.cogs_reversal_expense_id)
    .single();

  if (reversalError) throw new Error(reversalError.message);
  if (Number(reversalExpense.amount) >= 0) {
    throw new Error("COGS reversal expense should be negative");
  }

  console.log("PASS: sale_out and adjustment movements both present.");
  console.log("PASS: COGS reversal expense posted.");
}

async function main() {
  loadEnvFile(resolve(process.cwd(), ".env.local"));
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  const { data: sales, error: salesError } = await supabase
    .from("income_register")
    .select(
      "id, invoice_no, sale_status, product_id, sale_quantity, cogs_expense_id, cogs_reversal_expense_id, amount, entry_type, customer_name, product:finished_products!product_id(product_name, unit_of_measure, current_stock)",
    )
    .eq("entry_type", "product_sale")
    .in("invoice_no", TEST_INVOICES);

  if (salesError) throw new Error(salesError.message);

  console.log("Matching test sales:");
  for (const invoice of TEST_INVOICES) {
    const sale = sales?.find((row) => row.invoice_no === invoice);
    if (!sale) {
      throw new Error(`Missing test sale ${invoice}`);
    }

    const product = Array.isArray(sale.product) ? sale.product[0] : sale.product;
    console.log(
      `- ${invoice}: payer=${sale.customer_name ?? "(client)"}, qty=${sale.sale_quantity}, status=${sale.sale_status}, product=${product?.product_name}`,
    );
  }

  const verifyInvoice = "PH5-1784023816048";
  const verifySale = sales.find((row) => row.invoice_no === verifyInvoice);
  if (!verifySale) {
    throw new Error(`Verify sale ${verifyInvoice} not found`);
  }

  if (verifySale.sale_status !== "voided") {
    const product = Array.isArray(verifySale.product)
      ? verifySale.product[0]
      : verifySale.product;
    const stockBefore = Number(product?.current_stock) || 0;
    const restoreQty = Number(verifySale.sale_quantity) || 0;

    const { error: voidError } = await supabase.rpc("void_product_sale", {
      p_income_id: verifySale.id,
    });

    if (voidError) {
      throw new Error(`void_product_sale failed: ${voidError.message}`);
    }

    const { data: voidedSale, error: voidedError } = await supabase
      .from("income_register")
      .select(
        "product:finished_products!product_id(current_stock)",
      )
      .eq("id", verifySale.id)
      .single();

    if (voidedError) throw new Error(voidedError.message);
    const voidedProduct = Array.isArray(voidedSale.product)
      ? voidedSale.product[0]
      : voidedSale.product;
    const stockAfter = Number(voidedProduct?.current_stock) || 0;
    assertClose(stockAfter, stockBefore + restoreQty, "Stock restored after void");
    console.log("PASS: Void restored stock correctly.");
  } else {
    console.log(`SKIP: ${verifyInvoice} already voided; verifying audit trail only`);
  }

  await verifyVoidedSale(supabase, verifyInvoice, verifySale);

  for (const invoice of ["PH3-1784020981979", "PH3-1784021432302"]) {
    const { data: sale, error } = await supabase
      .from("income_register")
      .select("id, sale_status")
      .eq("invoice_no", invoice)
      .single();

    if (error) throw new Error(error.message);
    if (sale.sale_status === "voided") {
      console.log(`SKIP: ${invoice} already voided`);
      continue;
    }

    const { error: voidError } = await supabase.rpc("void_product_sale", {
      p_income_id: sale.id,
    });
    if (voidError) {
      throw new Error(`Failed to void ${invoice}: ${voidError.message}`);
    }
    console.log(`PASS: Voided ${invoice}`);
  }

  const { data: refreshedSales, error: refreshError } = await supabase
    .from("income_register")
    .select("invoice_no, sale_status, amount")
    .eq("entry_type", "product_sale")
    .in("invoice_no", TEST_INVOICES);

  if (refreshError) throw new Error(refreshError.message);

  const activeSales = (refreshedSales ?? []).filter((row) => row.sale_status !== "voided");
  if (activeSales.length !== 0) {
    throw new Error(
      `Expected 0 active test sales after voiding all, got ${activeSales.length}`,
    );
  }

  const activeTotal = activeSales.reduce((sum, row) => sum + Number(row.amount), 0);
  if (activeTotal !== 0) {
    throw new Error(`Expected 0 active sales revenue total, got ${activeTotal}`);
  }

  console.log("PASS: All test sales voided and excluded from report scope.");
}

main().catch((error) => {
  console.error(`\nVERIFY FAILED: ${error.message}`);
  process.exit(1);
});
