import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const PRODUCT_SALES_REPORT_SELECT =
  "id, date, invoice_no, client_id, customer_name, amount, sale_quantity, unit_price, product_id, cogs_expense_id, client:clients!client_id(client_id, client_name), product:finished_products!product_id(product_code, product_name, unit_of_measure), cogs:expense_register!cogs_expense_id(amount)";

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

function resolveCogsAmount(cogs) {
  if (!cogs) return 0;
  if (Array.isArray(cogs)) return Number(cogs[0]?.amount) || 0;
  return Number(cogs.amount) || 0;
}

function resolveProductSaleBuyerType(sale) {
  if (sale.client_id?.trim()) return "contract_client";
  return "retail";
}

function buildProductSalesReport(sales, buyerTypeFilter = "all") {
  const rows = sales
    .map((sale) => {
      const revenue = Number(sale.amount) || 0;
      const cogs = resolveCogsAmount(sale.cogs);
      const grossMargin = Math.round((revenue - cogs) * 100) / 100;
      const buyerType = resolveProductSaleBuyerType(sale);
      return {
        id: sale.id,
        invoice_no: sale.invoice_no,
        buyerType,
        buyerTypeLabel:
          buyerType === "contract_client" ? "Contract Client" : "Retail / Walk-in",
        revenue,
        grossMargin,
      };
    })
    .filter((row) => buyerTypeFilter === "all" || row.buyerType === buyerTypeFilter);

  const totals = rows.reduce(
    (acc, row) => ({
      revenue: acc.revenue + row.revenue,
      grossMargin: acc.grossMargin + row.grossMargin,
    }),
    { revenue: 0, grossMargin: 0 },
  );

  const splitTotals = {
    contract_client: rows
      .filter((row) => row.buyerType === "contract_client")
      .reduce(
        (acc, row) => ({
          revenue: acc.revenue + row.revenue,
          grossMargin: acc.grossMargin + row.grossMargin,
        }),
        { revenue: 0, grossMargin: 0 },
      ),
    retail: rows
      .filter((row) => row.buyerType === "retail")
      .reduce(
        (acc, row) => ({
          revenue: acc.revenue + row.revenue,
          grossMargin: acc.grossMargin + row.grossMargin,
        }),
        { revenue: 0, grossMargin: 0 },
      ),
  };

  return { rows, totals, splitTotals };
}

function assertClose(actual, expected, label) {
  const diff = Math.abs(Number(actual) - Number(expected));
  if (diff > 0.01) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

async function main() {
  loadEnvFile(resolve(process.cwd(), ".env.local"));
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  const today = new Date().toISOString().slice(0, 10);
  const stamp = Date.now();
  const contractInvoice = `BT-CON-${stamp}`;
  const retailInvoice = `BT-RET-${stamp}`;

  const [{ data: products, error: productsError }, { data: clients, error: clientsError }] =
    await Promise.all([
      supabase
        .from("finished_products")
        .select("id, product_name, current_stock, standard_selling_price")
        .gt("current_stock", 0.2)
        .order("product_name", { ascending: true })
        .limit(1),
      supabase
        .from("customers")
        .select("client_id, client_name")
        .order("client_name", { ascending: true })
        .limit(1),
    ]);

  if (productsError) throw new Error(productsError.message);
  if (clientsError) throw new Error(clientsError.message);
  if (!products?.length) throw new Error("No finished product with stock available.");
  if (!clients?.length) throw new Error("No clients available.");

  const product = products[0];
  const client = clients[0];
  const unitPrice = Number(product.standard_selling_price ?? 12.5);
  const contractQty = 1;
  const retailQty = 1;
  const contractRevenue = Math.round(contractQty * unitPrice * 100) / 100;
  const retailRevenue = Math.round(retailQty * unitPrice * 100) / 100;

  console.log(
    `Creating contract sale (${contractInvoice}) for ${client.client_name} and retail sale (${retailInvoice}).`,
  );

  const { error: contractSaleError } = await supabase.rpc("create_product_sale", {
    p_date: today,
    p_invoice_no: contractInvoice,
    p_client_id: client.client_id,
    p_customer_name: null,
    p_product_id: product.id,
    p_quantity: contractQty,
    p_unit_price: unitPrice,
    p_amount_received: 0,
    p_payment_status: "Pending",
    p_due_date: today,
    p_description: null,
    p_notes: "verify-product-sales-buyer-type contract",
  });

  if (contractSaleError) {
    throw new Error(`Contract sale failed: ${contractSaleError.message}`);
  }

  const { error: retailSaleError } = await supabase.rpc("create_product_sale", {
    p_date: today,
    p_invoice_no: retailInvoice,
    p_client_id: null,
    p_customer_name: "Walk-in Buyer Verify",
    p_product_id: product.id,
    p_quantity: retailQty,
    p_unit_price: unitPrice,
    p_amount_received: 0,
    p_payment_status: "Pending",
    p_due_date: today,
    p_description: null,
    p_notes: "verify-product-sales-buyer-type retail",
  });

  if (retailSaleError) {
    throw new Error(`Retail sale failed: ${retailSaleError.message}`);
  }

  const { data: sales, error: salesError } = await supabase
    .from("income_register")
    .select(PRODUCT_SALES_REPORT_SELECT)
    .eq("entry_type", "product_sale")
    .in("invoice_no", [contractInvoice, retailInvoice]);

  if (salesError) throw new Error(salesError.message);
  if ((sales ?? []).length !== 2) {
    throw new Error(`Expected 2 test sales, found ${sales?.length ?? 0}.`);
  }

  const allReport = buildProductSalesReport(sales, "all");
  const contractOnly = buildProductSalesReport(sales, "contract_client");
  const retailOnly = buildProductSalesReport(sales, "retail");

  if (allReport.rows.length !== 2) {
    throw new Error(`All filter should return 2 rows, got ${allReport.rows.length}.`);
  }

  const contractRow = allReport.rows.find((row) => row.invoice_no === contractInvoice);
  const retailRow = allReport.rows.find((row) => row.invoice_no === retailInvoice);

  if (!contractRow || contractRow.buyerType !== "contract_client") {
    throw new Error("Contract sale not tagged as Contract Client.");
  }
  if (!retailRow || retailRow.buyerType !== "retail") {
    throw new Error("Retail sale not tagged as Retail / Walk-in.");
  }

  if (contractOnly.rows.length !== 1 || retailOnly.rows.length !== 1) {
    throw new Error("Buyer type filters did not isolate each sale.");
  }

  assertClose(allReport.totals.revenue, contractRevenue + retailRevenue, "Combined revenue");
  assertClose(
    allReport.splitTotals.contract_client.revenue,
    contractRevenue,
    "Contract split revenue",
  );
  assertClose(allReport.splitTotals.retail.revenue, retailRevenue, "Retail split revenue");
  assertClose(contractOnly.totals.revenue, contractRevenue, "Contract-only revenue");
  assertClose(retailOnly.totals.revenue, retailRevenue, "Retail-only revenue");

  console.log("PASS: Contract sale tagged Contract Client.");
  console.log("PASS: Retail sale tagged Retail / Walk-in.");
  console.log("PASS: Buyer type filters isolate each sale.");
  console.log("PASS: Summary split totals match individual sales.");
  console.log(`Invoices created: ${contractInvoice}, ${retailInvoice}`);
}

main().catch((error) => {
  console.error(`\nVERIFY FAILED: ${error.message}`);
  process.exit(1);
});
