import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const TEST_PATTERN =
  /test|phase\s*[1-5]|verify/i;

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

function matchesTestText(...values) {
  return values.some((value) => value && TEST_PATTERN.test(String(value)));
}

function shortId(id) {
  return id ? String(id).slice(0, 8) : "—";
}

async function main() {
  loadEnvFile(resolve(process.cwd(), ".env.local"));
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  const [
    { data: rawMaterials, error: rmError },
    { data: purchases, error: purchaseError },
    { data: finishedProducts, error: fpError },
    { data: batches, error: batchError },
    { data: batchMaterials, error: bmError },
    { data: internalConsumption, error: icError },
    { data: stockMovements, error: smError },
    { data: productSales, error: psError },
  ] = await Promise.all([
    supabase
      .from("raw_materials")
      .select("id, material_code, material_name, current_stock, average_cost_per_unit"),
    supabase
      .from("raw_material_purchases")
      .select(
        "id, material_id, purchase_date, quantity, cost_per_unit, total_cost, supplier, notes, material:raw_materials!material_id(material_code, material_name)",
      ),
    supabase
      .from("finished_products")
      .select("id, product_code, product_name, current_stock, standard_selling_price"),
    supabase
      .from("production_batches")
      .select(
        "id, batch_number, production_date, quantity_produced, notes, finished_product_id, product:finished_products!finished_product_id(product_code, product_name)",
      ),
    supabase
      .from("production_batch_materials")
      .select(
        "id, batch_id, material_id, quantity_used, batch:production_batches!batch_id(batch_number, notes), material:raw_materials!material_id(material_code, material_name)",
      ),
    supabase
      .from("internal_consumption")
      .select(
        "id, product_id, quantity, consumption_date, notes, product:finished_products!product_id(product_code, product_name)",
      ),
    supabase
      .from("stock_movements")
      .select(
        "id, product_id, movement_type, quantity, reference_id, movement_date, notes, product:finished_products!product_id(product_code, product_name)",
      ),
    supabase
      .from("income_register")
      .select(
        "id, invoice_no, date, customer_name, sale_quantity, amount, sale_status, notes, product_id, product:finished_products!product_id(product_code, product_name)",
      )
      .eq("entry_type", "product_sale"),
  ]);

  const errors = [
    rmError,
    purchaseError,
    fpError,
    batchError,
    bmError,
    icError,
    smError,
    psError,
  ].filter(Boolean);
  if (errors.length) throw new Error(errors[0].message);

  const testRawMaterials = (rawMaterials ?? []).filter((row) =>
    matchesTestText(row.material_code, row.material_name),
  );
  const testRawMaterialIds = new Set(testRawMaterials.map((row) => row.id));

  const testFinishedProducts = (finishedProducts ?? []).filter((row) =>
    matchesTestText(row.product_code, row.product_name),
  );
  const testFinishedProductIds = new Set(testFinishedProducts.map((row) => row.id));

  const testPurchases = (purchases ?? []).filter((row) => {
    const material = Array.isArray(row.material) ? row.material[0] : row.material;
    return (
      matchesTestText(
        material?.material_code,
        material?.material_name,
        row.supplier,
        row.notes,
      ) || testRawMaterialIds.has(row.material_id)
    );
  });
  const testPurchaseIds = new Set(testPurchases.map((row) => row.id));

  const testBatches = (batches ?? []).filter((row) => {
    const product = Array.isArray(row.product) ? row.product[0] : row.product;
    return (
      matchesTestText(row.batch_number, row.notes, product?.product_code, product?.product_name) ||
      testFinishedProductIds.has(row.finished_product_id)
    );
  });
  const testBatchIds = new Set(testBatches.map((row) => row.id));

  const testBatchMaterials = (batchMaterials ?? []).filter((row) => {
    const batch = Array.isArray(row.batch) ? row.batch[0] : row.batch;
    const material = Array.isArray(row.material) ? row.material[0] : row.material;
    return (
      testBatchIds.has(row.batch_id) ||
      testRawMaterialIds.has(row.material_id) ||
      matchesTestText(
        batch?.batch_number,
        batch?.notes,
        material?.material_code,
        material?.material_name,
      )
    );
  });

  const testInternalConsumption = (internalConsumption ?? []).filter((row) => {
    const product = Array.isArray(row.product) ? row.product[0] : row.product;
    return (
      matchesTestText(row.notes, product?.product_code, product?.product_name) ||
      testFinishedProductIds.has(row.product_id)
    );
  });
  const testInternalConsumptionIds = new Set(
    testInternalConsumption.map((row) => row.id),
  );

  const testProductSales = (productSales ?? []).filter((row) => {
    const product = Array.isArray(row.product) ? row.product[0] : row.product;
    return (
      matchesTestText(
        row.invoice_no,
        row.customer_name,
        row.notes,
        product?.product_code,
        product?.product_name,
      ) || testFinishedProductIds.has(row.product_id)
    );
  });
  const testProductSaleIds = new Set(testProductSales.map((row) => row.id));

  const testStockMovements = (stockMovements ?? []).filter((row) => {
    const product = Array.isArray(row.product) ? row.product[0] : row.product;
    const refId = row.reference_id;
    return (
      matchesTestText(row.notes, product?.product_code, product?.product_name) ||
      testFinishedProductIds.has(row.product_id) ||
      (refId &&
        (testBatchIds.has(refId) ||
          testInternalConsumptionIds.has(refId) ||
          testProductSaleIds.has(refId)))
    );
  });

  const rm001 = (rawMaterials ?? []).find((row) => row.material_code === "RM-001");
  const rm001Purchases = (purchases ?? []).filter(
    (row) => row.material_id === rm001?.id,
  );
  const rm001TestPurchases = rm001Purchases.filter((row) => {
    const material = Array.isArray(row.material) ? row.material[0] : row.material;
    return matchesTestText(row.supplier, row.notes, material?.material_name);
  });
  const rm001RealPurchases = rm001Purchases.filter(
    (row) => !rm001TestPurchases.some((testRow) => testRow.id === row.id),
  );

  const reportRows = [];

  function addRow(table, identifier, name, related) {
    reportRows.push({ table, identifier, name, related });
  }

  for (const row of testRawMaterials) {
    const relatedPurchases = testPurchases.filter((p) => p.material_id === row.id);
    const relatedBatchMaterials = testBatchMaterials.filter(
      (bm) => bm.material_id === row.id,
    );
    addRow(
      "raw_materials",
      row.material_code,
      row.material_name,
      [
        `${relatedPurchases.length} purchase(s)`,
        `${relatedBatchMaterials.length} batch_material(s)`,
        `stock=${row.current_stock}`,
      ].join("; "),
    );
  }

  for (const row of testPurchases) {
    const material = Array.isArray(row.material) ? row.material[0] : row.material;
    const isRm001Noise =
      rm001 &&
      row.material_id === rm001.id &&
      rm001TestPurchases.some((testRow) => testRow.id === row.id);
    addRow(
      "raw_material_purchases",
      shortId(row.id),
      `${material?.material_code ?? "?"} — ${row.supplier ?? "(no supplier)"} — qty ${row.quantity} on ${row.purchase_date}`,
      isRm001Noise
        ? "RM-001 test purchase (KEEP RM-001 master row)"
        : `material=${material?.material_code ?? shortId(row.material_id)}`,
    );
  }

  for (const row of testFinishedProducts) {
    const relatedBatches = testBatches.filter(
      (b) => b.finished_product_id === row.id,
    );
    const relatedSales = testProductSales.filter((s) => s.product_id === row.id);
    const relatedIc = testInternalConsumption.filter((ic) => ic.product_id === row.id);
    const relatedMoves = testStockMovements.filter((sm) => sm.product_id === row.id);
    addRow(
      "finished_products",
      row.product_code,
      row.product_name,
      [
        `${relatedBatches.length} batch(es)`,
        `${relatedSales.length} sale(s)`,
        `${relatedIc.length} consumption(s)`,
        `${relatedMoves.length} stock_movement(s)`,
        `stock=${row.current_stock}`,
      ].join("; "),
    );
  }

  for (const row of testBatches) {
    const product = Array.isArray(row.product) ? row.product[0] : row.product;
    const relatedMaterials = testBatchMaterials.filter((bm) => bm.batch_id === row.id);
    const relatedMoves = testStockMovements.filter((sm) => sm.reference_id === row.id);
    addRow(
      "production_batches",
      row.batch_number,
      `${product?.product_code ?? "?"} — ${row.quantity_produced} on ${row.production_date}`,
      [
        `${relatedMaterials.length} batch_material(s)`,
        `${relatedMoves.length} stock_movement(s)`,
        row.notes ? `notes=${row.notes}` : null,
      ]
        .filter(Boolean)
        .join("; "),
    );
  }

  for (const row of testBatchMaterials) {
    const batch = Array.isArray(row.batch) ? row.batch[0] : row.batch;
    const material = Array.isArray(row.material) ? row.material[0] : row.material;
    addRow(
      "production_batch_materials",
      shortId(row.id),
      `${batch?.batch_number ?? "?"} uses ${material?.material_code ?? "?"} × ${row.quantity_used}`,
      `batch=${batch?.batch_number ?? shortId(row.batch_id)}; material=${material?.material_code ?? shortId(row.material_id)}`,
    );
  }

  for (const row of testInternalConsumption) {
    const product = Array.isArray(row.product) ? row.product[0] : row.product;
    const relatedMoves = testStockMovements.filter((sm) => sm.reference_id === row.id);
    addRow(
      "internal_consumption",
      shortId(row.id),
      `${product?.product_code ?? "?"} — qty ${row.quantity} on ${row.consumption_date}`,
      [
        `${relatedMoves.length} stock_movement(s)`,
        row.notes ? `notes=${row.notes}` : null,
      ]
        .filter(Boolean)
        .join("; "),
    );
  }

  for (const row of testProductSales) {
    const product = Array.isArray(row.product) ? row.product[0] : row.product;
    const relatedMoves = testStockMovements.filter((sm) => sm.reference_id === row.id);
    addRow(
      "income_register (product_sale)",
      row.invoice_no,
      `${row.customer_name ?? "(client)"} — ${product?.product_name ?? "?"} — qty ${row.sale_quantity} — status ${row.sale_status ?? "active"}`,
      [
        `${relatedMoves.length} stock_movement(s)`,
        row.sale_status === "voided" ? "already voided" : "VOID FIRST in Step 2",
      ].join("; "),
    );
  }

  for (const row of testStockMovements) {
    const product = Array.isArray(row.product) ? row.product[0] : row.product;
    addRow(
      "stock_movements",
      shortId(row.id),
      `${product?.product_code ?? "?"} — ${row.movement_type} ${row.quantity} on ${row.movement_date}`,
      [
        row.reference_id ? `ref=${shortId(row.reference_id)}` : "no ref",
        row.notes ? `notes=${row.notes}` : null,
      ]
        .filter(Boolean)
        .join("; "),
    );
  }

  console.log("=== STEP 1: TEST DATA INVENTORY REPORT (NO CHANGES) ===\n");
  console.log(
    `Pattern: case-insensitive match on TEST | Phase 1-5 | verify\n`,
  );

  console.log("--- Summary counts ---");
  console.log(`raw_materials:              ${testRawMaterials.length}`);
  console.log(`raw_material_purchases:     ${testPurchases.length}`);
  console.log(`finished_products:          ${testFinishedProducts.length}`);
  console.log(`production_batches:         ${testBatches.length}`);
  console.log(`production_batch_materials: ${testBatchMaterials.length}`);
  console.log(`internal_consumption:       ${testInternalConsumption.length}`);
  console.log(`income_register (sales):  ${testProductSales.length}`);
  console.log(`stock_movements:            ${testStockMovements.length}`);
  console.log("");

  console.log("--- RM-001 Caustic Soda purchase split (needs your confirmation) ---");
  if (!rm001) {
    console.log("RM-001 not found in raw_materials.");
  } else {
    console.log(
      `Master row: ${rm001.material_code} — ${rm001.material_name} — stock=${rm001.current_stock} — avg cost=${rm001.average_cost_per_unit}`,
    );
    console.log(`Total purchases under RM-001: ${rm001Purchases.length}`);
    console.log(`Flagged as TEST noise: ${rm001TestPurchases.length}`);
    for (const row of rm001TestPurchases) {
      console.log(
        `  [TEST?] ${shortId(row.id)} — ${row.purchase_date} — qty ${row.quantity} — supplier "${row.supplier ?? ""}" — notes "${row.notes ?? ""}"`,
      );
    }
    console.log(`Flagged as REAL (not auto-matched): ${rm001RealPurchases.length}`);
    for (const row of rm001RealPurchases) {
      console.log(
        `  [REAL?] ${shortId(row.id)} — ${row.purchase_date} — qty ${row.quantity} — supplier "${row.supplier ?? ""}" — notes "${row.notes ?? ""}"`,
      );
    }
  }
  console.log("");

  console.log("--- Detail table ---");
  console.log(
    "| Table | Identifier | Name/Description | Related rows |",
  );
  console.log(
    "|-------|------------|------------------|--------------|",
  );
  for (const row of reportRows) {
    const related = row.related.replace(/\|/g, "\\|");
    console.log(
      `| ${row.table} | ${row.identifier} | ${row.name.replace(/\|/g, "\\|")} | ${related} |`,
    );
  }

  console.log("\n--- Deletion chain order (for Step 3, after voiding sales) ---");
  const chains = [];

  for (const fp of testFinishedProducts) {
    const fpBatches = testBatches.filter((b) => b.finished_product_id === fp.id);
    const fpSales = testProductSales.filter((s) => s.product_id === fp.id);
    const fpIc = testInternalConsumption.filter((ic) => ic.product_id === fp.id);
    const fpMoves = testStockMovements.filter((sm) => sm.product_id === fp.id);
    chains.push({
      root: `${fp.product_code} (${fp.product_name})`,
      steps: [
        `Void ${fpSales.filter((s) => s.sale_status !== "voided").length} active sale(s) first`,
        `Delete ${fpMoves.length} stock_movement(s)`,
        `Delete ${fpIc.length} internal_consumption row(s)`,
        ...fpBatches.map((b) => {
          const bmCount = testBatchMaterials.filter((bm) => bm.batch_id === b.id).length;
          return `Delete batch ${b.batch_number} (+ ${bmCount} batch_material row(s))`;
        }),
        `Delete finished_product ${fp.product_code}`,
      ],
    });
  }

  for (const rm of testRawMaterials) {
    const rmPurchases = testPurchases.filter((p) => p.material_id === rm.id);
    const rmBm = testBatchMaterials.filter((bm) => bm.material_id === rm.id);
    chains.push({
      root: `${rm.material_code} (${rm.material_name})`,
      steps: [
        `Delete ${rmBm.length} production_batch_material row(s) first`,
        `Delete ${rmPurchases.length} purchase row(s)`,
        `Delete raw_material ${rm.material_code}`,
      ],
    });
  }

  if (rm001TestPurchases.length > 0) {
    chains.push({
      root: `RM-001 purchases only (master row preserved)`,
      steps: rm001TestPurchases.map(
        (row) =>
          `Delete purchase ${shortId(row.id)} — ${row.purchase_date} qty ${row.quantity} supplier "${row.supplier ?? ""}"`,
      ),
    });
  }

  for (const chain of chains) {
    console.log(`\n${chain.root}:`);
    chain.steps.forEach((step, index) => console.log(`  ${index + 1}. ${step}`));
  }

  const activeTestSales = testProductSales.filter((s) => s.sale_status !== "voided");
  if (activeTestSales.length > 0) {
    console.log("\n--- Step 2 preview: active test sales to void ---");
    for (const sale of activeTestSales) {
      console.log(`  ${sale.invoice_no} — ${sale.customer_name ?? "(client)"} — status ${sale.sale_status ?? "active"}`);
    }
  } else if (testProductSales.length > 0) {
    console.log("\n--- Step 2 preview: all test sales already voided ---");
    for (const sale of testProductSales) {
      console.log(`  ${sale.invoice_no} — status ${sale.sale_status}`);
    }
  }
}

main().catch((error) => {
  console.error(`REPORT FAILED: ${error.message}`);
  process.exit(1);
});
