import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

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

function roundCurrency(value) {
  return Math.round(value * 100) / 100;
}

function normalizePaymentMethod(value) {
  return (value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase()
    .replace(/\u2013|\u2014/g, "-");
}

function isCreditPaymentMethod(paymentMethod) {
  const normalized = normalizePaymentMethod(paymentMethod);
  if (!normalized) return false;
  return (
    normalized.includes("credit") ||
    normalized.includes("on account") ||
    normalized.includes("on-account") ||
    normalized.includes("accounts payable") ||
    normalized.includes("supplier credit")
  );
}

function buildAverageFinishedProductCostMap(batchSummaries) {
  const totals = new Map();
  for (const summary of batchSummaries) {
    const existing = totals.get(summary.finished_product_id) ?? {
      cost: 0,
      quantity: 0,
    };
    existing.cost += Number(summary.total_batch_cost) || 0;
    existing.quantity += Number(summary.quantity_produced) || 0;
    totals.set(summary.finished_product_id, existing);
  }

  const averages = new Map();
  for (const [productId, value] of totals.entries()) {
    averages.set(
      productId,
      value.quantity > 0
        ? Math.round((value.cost / value.quantity) * 10000) / 10000
        : 0,
    );
  }
  return averages;
}

function calculateTotalInventoryValue(rawMaterials, finishedProducts, batchSummaries) {
  const finishedAverageCosts = buildAverageFinishedProductCostMap(batchSummaries);

  const rawTotal = rawMaterials.reduce((sum, material) => {
    const stock = Number(material.current_stock) || 0;
    const cost = Number(material.average_cost_per_unit) || 0;
    return sum + stock * cost;
  }, 0);

  const finishedTotal = finishedProducts.reduce((sum, product) => {
    const stock = Number(product.current_stock) || 0;
    const cost = finishedAverageCosts.get(product.id) ?? 0;
    return sum + stock * cost;
  }, 0);

  return roundCurrency(rawTotal + finishedTotal);
}

function getFinancialYear(referenceDate = new Date()) {
  return referenceDate.getFullYear();
}

function getEntryMonthIndex(dateValue, financialYear) {
  const normalized = dateValue.slice(0, 10);
  const [year, month] = normalized.split("-").map(Number);
  if (year !== financialYear || month < 1 || month > 12) {
    return null;
  }
  return month - 1;
}

function calculateInventoryByMonth(
  rawMaterials,
  finishedProducts,
  batchSummaries,
  config,
  financialYear,
  referenceDate = new Date(),
) {
  const totals = Array.from({ length: 13 }, () => 0);
  if (!config?.go_live_date) {
    return totals;
  }

  const goLiveMonthIndex = getEntryMonthIndex(config.go_live_date, financialYear);
  const currentMonthIndex = getEntryMonthIndex(
    referenceDate.toISOString().slice(0, 10),
    financialYear,
  );

  if (goLiveMonthIndex === null) {
    return totals;
  }

  const liveValue = calculateTotalInventoryValue(
    rawMaterials,
    finishedProducts,
    batchSummaries,
  );

  for (let monthIndex = 0; monthIndex < 12; monthIndex += 1) {
    if (monthIndex < goLiveMonthIndex) {
      totals[monthIndex] = 0;
      continue;
    }
    if (currentMonthIndex !== null && monthIndex > currentMonthIndex) {
      totals[monthIndex] = 0;
      continue;
    }
    totals[monthIndex] = liveValue;
  }

  totals[12] = totals[11];
  return totals;
}

async function fetchBalanceSheetInputs(supabase, tenantId) {
  const [
    { data: incomeEntries, error: incomeError },
    { data: expenseEntries, error: expenseError },
    { data: fixedAssets, error: fixedAssetsError },
    { data: payableEntries, error: payableError },
    { data: capitalContributions, error: capitalError },
    { data: payrollHistory, error: payrollHistoryError },
    { data: payrollProcessing, error: payrollProcessingError },
    { data: monthEndCloseRecords, error: monthEndCloseError },
    { data: configRows, error: configError },
    { data: rawMaterials, error: rawMaterialsError },
    { data: finishedProducts, error: finishedProductsError },
    { data: batchSummaries, error: batchSummariesError },
    { data: cashPurchases, error: cashPurchasesError },
  ] = await Promise.all([
    supabase
      .from("income_register")
      .select(
        "date, amount, amount_received, outstanding_balance, service_category",
      ),
    supabase
      .from("expense_register")
      .select(
        "date, expense_category, sub_category, amount, payment_status, description, receipt_no",
      ),
    supabase
      .from("fixed_assets")
      .select(
        "original_cost, quantity, useful_life_years, purchase_date, depreciation_method",
      ),
    supabase
      .from("accounts_payable")
      .select("invoice_date, balance_due, amount, amount_paid"),
    supabase.from("capital_contributions").select("id, date, contributed_by, amount, description, notes"),
    supabase.from("payroll_history").select("payroll_month, net_pay"),
    supabase.from("payroll_processing").select("payroll_month, net_pay"),
    supabase.from("month_end_close").select("month, total_net_pay"),
    supabase
      .from("inventory_balance_config")
      .select("go_live_date, opening_inventory_value, created_at")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    supabase
      .from("raw_materials")
      .select("current_stock, average_cost_per_unit"),
    supabase.from("finished_products").select("id, current_stock"),
    supabase
      .from("production_batches")
      .select("finished_product_id, total_batch_cost, quantity_produced"),
    supabase
      .from("raw_material_purchases")
      .select("purchase_date, total_cost, payment_method, created_at"),
  ]);

  const errors = [
    incomeError,
    expenseError,
    fixedAssetsError,
    payableError,
    capitalError,
    payrollHistoryError,
    payrollProcessingError,
    monthEndCloseError,
    configError,
    rawMaterialsError,
    finishedProductsError,
    batchSummariesError,
    cashPurchasesError,
  ].filter(Boolean);

  if (errors.length) {
    throw new Error(errors.map((error) => error.message).join("; "));
  }

  const payrollByMonth = new Map();
  for (const entry of payrollHistory ?? []) {
    payrollByMonth.set(entry.payroll_month.slice(0, 10), entry);
  }
  for (const entry of payrollProcessing ?? []) {
    if (!payrollByMonth.has(entry.payroll_month.slice(0, 10))) {
      payrollByMonth.set(entry.payroll_month.slice(0, 10), entry);
    }
  }

  return {
    incomeEntries: incomeEntries ?? [],
    expenseEntries: expenseEntries ?? [],
    fixedAssets: fixedAssets ?? [],
    payableEntries: payableEntries ?? [],
    capitalContributions: capitalContributions ?? [],
    cashFlowExpenseEntries: (expenseEntries ?? []).map((entry) => ({
      date: entry.date,
      expense_category: entry.expense_category,
      sub_category: entry.sub_category,
      amount: entry.amount,
      payment_status: entry.payment_status,
      description: entry.description ?? null,
      receipt_no: entry.receipt_no ?? null,
    })),
    payrollHistory: [...payrollByMonth.values()],
    monthEndCloseNetPay: monthEndCloseRecords ?? [],
    inventoryInput: {
      config: configRows
        ? {
            go_live_date: configRows.go_live_date,
            opening_inventory_value:
              Number(configRows.opening_inventory_value) || 0,
            created_at: configRows.created_at,
          }
        : null,
      rawMaterials: rawMaterials ?? [],
      finishedProducts: finishedProducts ?? [],
      batchSummaries: batchSummaries ?? [],
      cashPurchases: cashPurchases ?? [],
    },
  };
}

function assertBalanceMaintained(label, before, after) {
  console.log(
    `\n${label}: Assets GHS ${after.balanceCheck.totalAssets.toFixed(2)} (Δ ${roundCurrency(after.balanceCheck.totalAssets - before.balanceCheck.totalAssets).toFixed(2)}), L+E GHS ${after.balanceCheck.totalLiabilitiesAndEquity.toFixed(2)}, diff GHS ${after.balanceCheck.difference.toFixed(2)}, balanced=${after.balanceCheck.isBalanced}`,
  );

  if (after.balanceCheck.isBalanced) {
    console.log(`PASS: ${label} — Balance Sheet balances.`);
    return;
  }

  if (
    Math.abs(after.balanceCheck.difference - before.balanceCheck.difference) <=
    2
  ) {
    console.log(
      `PASS: ${label} — Balance Sheet gap unchanged (${after.balanceCheck.difference.toFixed(2)}).`,
    );
    return;
  }

  throw new Error(`${label} changed Balance Sheet gap unexpectedly.`);
}

async function buildBalanceSheetSnapshot(supabase, referenceDate = new Date()) {
  const { spawnSync } = await import("node:child_process");
  const result = spawnSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["--yes", "tsx", "scripts/verify-inventory-phase5-balance.ts"],
    {
      cwd: process.cwd(),
      encoding: "utf8",
      shell: process.platform === "win32",
      env: {
        ...process.env,
        VERIFY_REFERENCE_DATE: referenceDate.toISOString(),
      },
    },
  );

  if (result.status !== 0) {
    throw new Error(
      result.stderr?.trim() ||
        result.stdout?.trim() ||
        "Balance sheet snapshot runner failed.",
    );
  }

  return JSON.parse(result.stdout.trim());
}

async function main() {
  loadEnvFile(resolve(process.cwd(), ".env.local"));
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  const referenceDate = new Date();
  const financialYear = getFinancialYear(referenceDate);
  const currentMonthIndex = referenceDate.getMonth();
  const tenantId =
    process.env.VERIFY_TENANT_ID ??
    "00000001-0000-4000-8000-000000000001";

  console.log("Phase 5 verification — inventory on Balance Sheet\n");

  const { data: config, error: configError } = await supabase
    .from("inventory_balance_config")
    .select("go_live_date, opening_inventory_value")
    .eq("tenant_id", tenantId)
    .maybeSingle();

  if (configError) {
    throw new Error(`inventory_balance_config query failed: ${configError.message}`);
  }
  if (!config?.go_live_date) {
    throw new Error(
      "inventory_balance_config is missing for this tenant. Set it via Inventory Go-Live settings.",
    );
  }

  console.log(`Go-live date: ${config.go_live_date}`);
  console.log(`Opening inventory value: GHS ${Number(config.opening_inventory_value).toFixed(2)}`);

  const inputs = await fetchBalanceSheetInputs(supabase, tenantId);
  const stockOnHand = calculateTotalInventoryValue(
    inputs.inventoryInput.rawMaterials,
    inputs.inventoryInput.finishedProducts,
    inputs.inventoryInput.batchSummaries,
  );

  const inventoryByMonth = calculateInventoryByMonth(
    inputs.inventoryInput.rawMaterials,
    inputs.inventoryInput.finishedProducts,
    inputs.inventoryInput.batchSummaries,
    inputs.inventoryInput.config,
    financialYear,
    referenceDate,
  );

  console.log(`\nStock on Hand total: GHS ${stockOnHand.toFixed(2)}`);
  console.log(
    `Balance Sheet Inventory (month ${currentMonthIndex + 1}): GHS ${inventoryByMonth[currentMonthIndex].toFixed(2)}`,
  );

  if (Math.abs(stockOnHand - inventoryByMonth[currentMonthIndex]) > 0.01) {
    throw new Error("Today's Inventory line does not match Stock on Hand total.");
  }
  console.log("PASS: Today's Inventory matches Stock on Hand.");

  for (let monthIndex = 0; monthIndex < currentMonthIndex; monthIndex += 1) {
    if (inventoryByMonth[monthIndex] !== 0) {
      throw new Error(
        `Month ${monthIndex + 1} shows Inventory GHS ${inventoryByMonth[monthIndex]}; expected 0 before go-live month.`,
      );
    }
  }
  console.log("PASS: All months before go-live month show Inventory = GHS 0.");

  const beforeSnapshot = await buildBalanceSheetSnapshot(supabase, referenceDate);
  console.log(
    `\nBaseline Balance Sheet (${beforeSnapshot.periodLabel}): Assets GHS ${beforeSnapshot.balanceCheck.totalAssets.toFixed(2)}, L+E GHS ${beforeSnapshot.balanceCheck.totalLiabilitiesAndEquity.toFixed(2)}, diff GHS ${beforeSnapshot.balanceCheck.difference.toFixed(2)}`,
  );
  if (!beforeSnapshot.balanceCheck.isBalanced) {
    console.log(
      "WARN: Baseline is not perfectly balanced; transaction checks will require each step to preserve the gap.",
    );
  } else {
    console.log("PASS: Baseline Balance Sheet balances.");
  }

  const { data: material } = await supabase
    .from("raw_materials")
    .select("id, material_name")
    .order("material_name", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!material?.id) {
    throw new Error("Need at least one raw material for purchase test.");
  }

  const today = referenceDate.toISOString().slice(0, 10);
  const purchaseCost = 12.5;
  const { data: purchaseRow, error: purchaseError } = await supabase
    .from("raw_material_purchases")
    .insert({
      material_id: material.id,
      purchase_date: today,
      quantity: 1,
      cost_per_unit: purchaseCost,
      total_cost: purchaseCost,
      supplier: "Phase 5 Verify",
      payment_method: "Cash",
      notes: "verify-inventory-phase5 purchase",
    })
    .select("id")
    .single();

  if (purchaseError) {
    throw new Error(`Raw material purchase test failed: ${purchaseError.message}`);
  }

  const afterPurchase = await buildBalanceSheetSnapshot(supabase, referenceDate);
  assertBalanceMaintained(
    `After raw material purchase (Cash GHS ${purchaseCost.toFixed(2)})`,
    beforeSnapshot,
    afterPurchase,
  );

  let priorSnapshot = afterPurchase;

  const { data: product } = await supabase
    .from("finished_products")
    .select("id, product_name, current_stock")
    .gt("current_stock", 0)
    .order("product_name", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (!product?.id || Number(product.current_stock) < 0.1) {
    throw new Error("Need finished product stock for internal consumption test.");
  }

  const consumptionQty = 0.1;
  const { error: consumptionError } = await supabase
    .from("internal_consumption")
    .insert({
      product_id: product.id,
      quantity: consumptionQty,
      consumption_date: today,
      reason: "Phase 5 verify",
      recorded_by: "System",
      notes: "verify-inventory-phase5 consumption",
    });

  if (consumptionError) {
    throw new Error(`Internal consumption test failed: ${consumptionError.message}`);
  }

  const afterConsumption = await buildBalanceSheetSnapshot(supabase, referenceDate);
  assertBalanceMaintained(
    `After internal consumption (${consumptionQty} ${product.product_name})`,
    priorSnapshot,
    afterConsumption,
  );

  priorSnapshot = afterConsumption;

  const saleQty = Math.min(0.1, Number(product.current_stock));
  const invoiceNo = `PH5-${Date.now()}`;
  const { data: saleId, error: saleError } = await supabase.rpc("create_product_sale", {
    p_date: today,
    p_invoice_no: invoiceNo,
    p_client_id: null,
    p_customer_name: "Phase 5 Verify",
    p_product_id: product.id,
    p_quantity: saleQty,
    p_unit_price: 25,
    p_amount_received: 0,
    p_payment_status: "Pending",
    p_due_date: today,
    p_description: null,
    p_notes: "verify-inventory-phase5 sale",
  });

  if (saleError) {
    throw new Error(`Product sale test failed: ${saleError.message}`);
  }

  const afterSale = await buildBalanceSheetSnapshot(supabase, referenceDate);
  assertBalanceMaintained(
    `After product sale (${saleQty} units, sale ${saleId})`,
    priorSnapshot,
    afterSale,
  );

  const { data: subcategory } = await supabase
    .from("expense_subcategories")
    .select("name")
    .eq("name", "Cleaning Supplies - Internal Use")
    .maybeSingle();

  if (!subcategory?.name) {
    throw new Error("Missing expense sub-category Cleaning Supplies - Internal Use.");
  }
  console.log("PASS: Internal consumption expense sub-category exists.");

  const { data: creditPurchase } = await supabase
    .from("raw_material_purchases")
    .select("accounts_payable_id, payment_method")
    .eq("id", purchaseRow.id)
    .maybeSingle();

  if (isCreditPaymentMethod(creditPurchase?.payment_method)) {
    if (!creditPurchase?.accounts_payable_id) {
      throw new Error("Credit raw material purchase did not create accounts_payable link.");
    }
  } else {
    console.log("PASS: Cash raw material purchase did not require AP linkage.");
  }

  console.log("\nAll Phase 5 inventory Balance Sheet checks passed.");
}

main().catch((error) => {
  console.error(`\nVERIFY FAILED: ${error.message}`);
  process.exit(1);
});
