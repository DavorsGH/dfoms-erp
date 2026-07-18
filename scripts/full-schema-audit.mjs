import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
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

function walk(dir, files = []) {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      if (entry === "node_modules" || entry === ".next") continue;
      walk(full, files);
    } else if (/\.(ts|tsx|mjs|js)$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

function extractRpcNames(source) {
  const names = new Set();
  const patterns = [
    /\.rpc\(\s*["'`]([^"'`]+)["'`]/g,
    /admin\.rpc\(\s*["'`]([^"'`]+)["'`]/g,
    /supabase\.rpc\(\s*["'`]([^"'`]+)["'`]/g,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) {
      names.add(match[1]);
    }
  }
  return names;
}

function extractSelectProbes(source, filePath) {
  const probes = [];
  const constPattern =
    /export const ([A-Z0-9_]+_SELECT)\s*=\s*(?:\n\s*)?["'`]([^"'`]+)["'`]/g;
  for (const match of source.matchAll(constPattern)) {
    probes.push({
      label: `${match[1]} (${relativePath(filePath)})`,
      select: match[2],
    });
  }

  const inlinePattern = /\.select\(\s*["'`]([^"'`]+)["'`]/g;
  for (const match of source.matchAll(inlinePattern)) {
    if (match[1] === "*") continue;
    probes.push({
      label: `inline select (${relativePath(filePath)})`,
      select: match[1],
    });
  }

  return probes;
}

function extractTables(source) {
  const tables = new Set();
  for (const match of source.matchAll(/\.from\(\s*["'`]([^"'`]+)["'`]/g)) {
    tables.add(match[1]);
  }
  return tables;
}

function relativePath(filePath) {
  return filePath.replace(process.cwd() + "\\", "").replace(process.cwd() + "/", "");
}

function inferTableFromSelect(select) {
  if (select.startsWith("*")) return null;
  const firstToken = select.split(",")[0].trim();
  if (!firstToken || firstToken.includes(":") || firstToken.includes("(")) {
    return null;
  }
  return null;
}

function dedupeProbes(probes) {
  const seen = new Map();
  for (const probe of probes) {
    const key = probe.select;
    if (!seen.has(key)) seen.set(key, probe);
  }
  return [...seen.values()];
}

function guessRpcArgs(name) {
  const zeroUuid = "00000000-0000-0000-0000-000000000000";
  const argsByName = {
    create_product_sale: {
      p_product_id: zeroUuid,
      p_client_id: null,
      p_customer_name: "Audit",
      p_sale_date: "2026-01-01",
      p_quantity: 1,
      p_unit_price: 1,
      p_amount_received: 1,
      p_payment_method: "Cash",
      p_notes: null,
    },
    void_product_sale: { p_sale_id: zeroUuid },
    create_production_batch: {
      p_finished_product_id: zeroUuid,
      p_production_date: "2026-01-01",
      p_quantity_produced: 1,
      p_notes: null,
      p_materials: [],
    },
    preview_raw_material_delete: { p_material_id: zeroUuid },
    delete_raw_material_cascade: { p_material_id: zeroUuid },
    preview_finished_product_delete: { p_product_id: zeroUuid },
    delete_finished_product_cascade: { p_product_id: zeroUuid },
    delete_raw_material_purchase: { p_purchase_id: zeroUuid },
    update_raw_material_purchase: {
      p_purchase_id: zeroUuid,
      p_purchase_date: "2026-01-01",
      p_quantity: 1,
      p_cost_per_unit: 1,
      p_supplier: "Audit",
      p_payment_method: "Cash",
      p_notes: null,
    },
    archive_raw_material: { p_material_id: zeroUuid },
    archive_finished_product: { p_product_id: zeroUuid },
    admin_delete_payroll_history_for_month: { p_month: "2099-01" },
    recalculate_raw_material_inventory: { p_material_id: zeroUuid },
  };
  return argsByName[name] ?? {};
}

function classifyRpcError(name, errorMessage) {
  if (
    errorMessage.includes("Could not find the function") ||
    errorMessage.includes("function") && errorMessage.includes("does not exist") ||
    errorMessage.includes("schema cache")
  ) {
    return "MISSING_FUNCTION";
  }
  if (errorMessage.includes("not found")) {
    return "EXISTS_NOT_FOUND";
  }
  return "EXISTS_VALIDATION";
}

function classifySelectError(errorMessage) {
  if (errorMessage.includes("Could not find the table")) {
    return "MISSING_TABLE";
  }
  if (errorMessage.includes("does not exist")) {
    if (errorMessage.includes("relationship")) return "MISSING_RELATIONSHIP";
    if (errorMessage.includes("column")) return "MISSING_COLUMN";
    return "MISSING_OBJECT";
  }
  if (errorMessage.includes("permission denied")) {
    return "PERMISSION_DENIED";
  }
  return "OTHER_ERROR";
}

async function probeRpc(supabase, name) {
  const { error } = await supabase.rpc(name, guessRpcArgs(name));
  if (!error) {
    return { status: "EXISTS_OK", detail: null };
  }
  const status = classifyRpcError(name, error.message);
  return { status, detail: error.message };
}

async function probeSelect(supabase, table, select) {
  const { error } = await supabase.from(table).select(select).limit(0);
  if (!error) {
    return { status: "OK", detail: null };
  }
  const status = classifySelectError(error.message);
  return { status, detail: error.message };
}

function tableForSelect(select, tablesInFile) {
  return null;
}

async function fetchOpenApiTables(url, key) {
  const response = await fetch(`${url}/rest/v1/`, {
    headers: {
      apikey: key,
      Authorization: `Bearer ${key}`,
    },
  });
  if (!response.ok) {
    throw new Error(`OpenAPI fetch failed: ${response.status}`);
  }
  const spec = await response.json();
  return Object.keys(spec.definitions ?? {}).sort();
}

async function main() {
  loadEnvFile(resolve(process.cwd(), ".env.local"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Supabase URL/service role key missing");

  const supabase = createClient(url, key);
  const appDir = resolve(process.cwd(), "app");
  const files = walk(appDir);

  const rpcNames = new Set();
  const selectProbes = [];
  const tableUsage = new Map();

  for (const file of files) {
    const source = readFileSync(file, "utf8");
    for (const name of extractRpcNames(source)) rpcNames.add(name);
    selectProbes.push(...extractSelectProbes(source, file));
    for (const table of extractTables(source)) {
      if (!tableUsage.has(table)) tableUsage.set(table, new Set());
      tableUsage.get(table).add(relativePath(file));
    }
  }

  const uniqueSelects = dedupeProbes(selectProbes);

  // Import select constants by reading key utils files
  const utilsReads = {
    SERVICE_INCOME_REGISTER_SELECT: readFileSync(resolve("app/dashboard/finance/income-register-utils.ts"), "utf8").match(/SERVICE_INCOME_REGISTER_SELECT\s*=\s*["'`]([^"'`]+)["'`]/)?.[1],
    PRODUCT_SALES_SELECT: readFileSync(resolve("app/dashboard/crm/product-sales-utils.ts"), "utf8").match(/PRODUCT_SALES_SELECT\s*=\s*["'`]([^"'`]+)["'`]/)?.[1],
    PRODUCT_SALES_REPORT_SELECT: readFileSync(resolve("app/dashboard/reports/inventory-report-data.ts"), "utf8").match(/PRODUCT_SALES_REPORT_SELECT\s*=\s*["'`]([^"'`]+)["'`]/)?.[1],
    PROJECT_SELECT: readFileSync(resolve("app/dashboard/administration/projects-utils.ts"), "utf8").match(/PROJECT_SELECT\s*=\s*["'`]([^"'`]+)["'`]/)?.[1],
    ROSTER_CONFIG_SELECT: readFileSync(resolve("app/dashboard/operations/roster-config-utils.ts"), "utf8").match(/ROSTER_CONFIG_SELECT\s*=\s*["'`]([^"'`]+)["'`]/)?.[1],
    INTERNAL_CONSUMPTION_SELECT: readFileSync(resolve("app/dashboard/inventory/internal-consumption-utils.ts"), "utf8").match(/INTERNAL_CONSUMPTION_SELECT\s*=\s*["'`]([^"'`]+)["'`]/)?.[1],
    PRODUCTION_BATCH_SELECT: readFileSync(resolve("app/dashboard/inventory/production-batches-utils.ts"), "utf8").match(/PRODUCTION_BATCH_SELECT\s*=\s*["'`]([^"'`]+)["'`]/)?.[1],
    PRODUCTION_BATCH_DETAIL_SELECT: readFileSync(resolve("app/dashboard/inventory/production-batches-utils.ts"), "utf8").match(/PRODUCTION_BATCH_DETAIL_SELECT\s*=\s*["'`]([^"'`]+)["'`]/)?.[1],
    RAW_MATERIAL_SELECT: readFileSync(resolve("app/dashboard/inventory/raw-materials-utils.ts"), "utf8").match(/RAW_MATERIAL_SELECT\s*=\s*["'`]([^"'`]+)["'`]/)?.[1],
    RAW_MATERIAL_PURCHASE_SELECT: readFileSync(resolve("app/dashboard/inventory/raw-materials-utils.ts"), "utf8").match(/RAW_MATERIAL_PURCHASE_SELECT\s*=\s*["'`]([^"'`]+)["'`]/)?.[1],
    FINISHED_PRODUCT_SELECT: readFileSync(resolve("app/dashboard/inventory/finished-products-utils.ts"), "utf8").match(/FINISHED_PRODUCT_SELECT\s*=\s*["'`]([^"'`]+)["'`]/)?.[1],
    SITE_SELECT: readFileSync(resolve("app/dashboard/operations/sites-utils.ts"), "utf8").match(/SITE_SELECT\s*=\s*["'`]([^"'`]+)["'`]/)?.[1],
    SITE_ASSIGNMENT_SELECT: readFileSync(resolve("app/dashboard/operations/sites-utils.ts"), "utf8").match(/SITE_ASSIGNMENT_SELECT\s*=\s*["'`]([^"'`]+)["'`]/)?.[1],
    EMPLOYEE_SELECT: readFileSync(resolve("app/dashboard/employees/employee-record-utils.ts"), "utf8").match(/EMPLOYEE_SELECT\s*=\s*["'`]([^"'`]+)["'`]/)?.[1],
    HR_EMPLOYEE_SELECT: readFileSync(resolve("app/dashboard/hr-payroll/employee-utils.ts"), "utf8").match(/HR_EMPLOYEE_SELECT\s*=\s*["'`]([^"'`]+)["'`]/)?.[1],
    STAFF_ID_CARD_EMPLOYEE_SELECT: readFileSync(resolve("app/dashboard/hr-payroll/staff-id-cards-utils.ts"), "utf8").match(/STAFF_ID_CARD_EMPLOYEE_SELECT\s*=\s*["'`]([^"'`]+)["'`]/)?.[1],
  };

  const curatedProbes = [
    { table: "income_register", label: "SERVICE_INCOME_REGISTER_SELECT", select: utilsReads.SERVICE_INCOME_REGISTER_SELECT },
    { table: "income_register", label: "PRODUCT_SALES_SELECT", select: utilsReads.PRODUCT_SALES_SELECT },
    { table: "income_register", label: "PRODUCT_SALES_REPORT_SELECT", select: utilsReads.PRODUCT_SALES_REPORT_SELECT },
    { table: "projects", label: "PROJECT_SELECT", select: utilsReads.PROJECT_SELECT },
    { table: "projects", label: "projects.site_id legacy", select: "project_code, project_name, required_staff, site_id, site:sites!site_id(site_code, site_name, client_id)" },
    { table: "roster_config", label: "ROSTER_CONFIG_SELECT", select: utilsReads.ROSTER_CONFIG_SELECT },
    { table: "internal_consumption", label: "INTERNAL_CONSUMPTION_SELECT", select: utilsReads.INTERNAL_CONSUMPTION_SELECT },
    { table: "production_batches", label: "PRODUCTION_BATCH_SELECT", select: utilsReads.PRODUCTION_BATCH_SELECT },
    { table: "production_batches", label: "PRODUCTION_BATCH_DETAIL_SELECT", select: utilsReads.PRODUCTION_BATCH_DETAIL_SELECT },
    { table: "raw_materials", label: "RAW_MATERIAL_SELECT", select: utilsReads.RAW_MATERIAL_SELECT },
    { table: "raw_material_purchases", label: "RAW_MATERIAL_PURCHASE_SELECT", select: utilsReads.RAW_MATERIAL_PURCHASE_SELECT },
    { table: "finished_products", label: "FINISHED_PRODUCT_SELECT", select: utilsReads.FINISHED_PRODUCT_SELECT },
    { table: "sites", label: "SITE_SELECT", select: utilsReads.SITE_SELECT },
    { table: "sites", label: "SITE_ASSIGNMENT_SELECT", select: utilsReads.SITE_ASSIGNMENT_SELECT },
    { table: "employees", label: "EMPLOYEE_SELECT", select: utilsReads.EMPLOYEE_SELECT },
    { table: "employees", label: "HR_EMPLOYEE_SELECT", select: utilsReads.HR_EMPLOYEE_SELECT },
    { table: "employees", label: "STAFF_ID_CARD_EMPLOYEE_SELECT", select: utilsReads.STAFF_ID_CARD_EMPLOYEE_SELECT },
    { table: "payroll_history", label: "payroll_history.locked", select: "id, locked" },
    { table: "month_end_close", label: "month_end_close.partial_lock_status", select: "month, partial_lock_status" },
    { table: "raw_materials", label: "raw_materials.is_archived", select: "id, is_archived" },
    { table: "finished_products", label: "finished_products.is_archived", select: "id, is_archived" },
    { table: "raw_material_purchases", label: "raw_material_purchases.accounts_payable_id", select: "id, accounts_payable_id" },
    { table: "internal_consumption", label: "internal_consumption.expense_register_id", select: "id, expense_register_id" },
    { table: "internal_consumption", label: "internal_consumption.site_id", select: "id, site_id" },
    { table: "sites", label: "sites.project_id", select: "id, project_id, client_id" },
  ].filter((p) => p.select);

  console.log("=== CODEBASE INVENTORY ===\n");
  console.log("RPC functions referenced in app/:");
  for (const name of [...rpcNames].sort()) console.log(`  - ${name}`);
  console.log(`\nTables referenced in app/: ${tableUsage.size}`);
  for (const [table, refs] of [...tableUsage.entries()].sort()) {
    console.log(`  - ${table} (${refs.size} file(s))`);
  }

  let openApiTables = [];
  try {
    openApiTables = await fetchOpenApiTables(url, key);
    console.log(`\nLive OpenAPI tables exposed: ${openApiTables.length}`);
  } catch (error) {
    console.log(`\nOpenAPI table list unavailable: ${error.message}`);
  }

  console.log("\n=== LIVE PROBE: RPC FUNCTIONS ===\n");
  const rpcResults = [];
  for (const name of [...rpcNames].sort()) {
    const result = await probeRpc(supabase, name);
    rpcResults.push({ name, ...result });
    const marker =
      result.status === "MISSING_FUNCTION"
        ? "MISSING"
        : result.status === "EXISTS_OK"
          ? "OK"
          : "EXISTS";
    console.log(`${marker.padEnd(8)} ${name}`);
    if (result.detail && result.status === "MISSING_FUNCTION") {
      console.log(`         ${result.detail}`);
    }
  }

  console.log("\n=== LIVE PROBE: SELECT / RELATIONSHIPS ===\n");
  const selectResults = [];
  for (const probe of curatedProbes) {
    const result = await probeSelect(supabase, probe.table, probe.select);
    selectResults.push({ ...probe, ...result });
    const marker = result.status === "OK" ? "OK" : "FAIL";
    console.log(`${marker.padEnd(5)} ${probe.table} :: ${probe.label}`);
    if (result.status !== "OK") {
      console.log(`      ${result.status}: ${result.detail}`);
    }
  }

  // Probe tables existence
  console.log("\n=== LIVE PROBE: TABLE ACCESS ===\n");
  const tableResults = [];
  for (const table of [...tableUsage.keys()].sort()) {
    const { error } = await supabase.from(table).select("id").limit(0);
    const status = error
      ? classifySelectError(error.message)
      : "OK";
    tableResults.push({ table, status, detail: error?.message ?? null });
    const marker = status === "OK" ? "OK" : "FAIL";
    console.log(`${marker.padEnd(5)} ${table}`);
    if (error) console.log(`      ${status}: ${error.message}`);
  }

  const mismatches = [];

  for (const row of rpcResults) {
    if (row.status === "MISSING_FUNCTION") {
      mismatches.push({
        kind: "RPC",
        name: row.name,
        detail: row.detail,
      });
    }
  }

  for (const row of selectResults) {
    if (row.status !== "OK") {
      mismatches.push({
        kind: row.status,
        name: `${row.table} :: ${row.label}`,
        detail: row.detail,
      });
    }
  }

  for (const row of tableResults) {
    if (row.status !== "OK") {
      mismatches.push({
        kind: "TABLE",
        name: row.table,
        detail: row.detail,
      });
    }
  }

  console.log("\n=== MISMATCH SUMMARY (AUDIT ONLY — NO FIXES APPLIED) ===\n");
  if (mismatches.length === 0) {
    console.log("No mismatches detected.");
  } else {
    console.log(`Found ${mismatches.length} mismatch(es):\n`);
    for (const [index, item] of mismatches.entries()) {
      console.log(`${index + 1}. [${item.kind}] ${item.name}`);
      console.log(`   ${item.detail}`);
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    rpcNames: [...rpcNames].sort(),
    tables: [...tableUsage.keys()].sort(),
    openApiTables,
    rpcResults,
    selectResults,
    tableResults,
    mismatches,
  };

  const outPath = resolve(process.cwd(), "scripts/.schema-audit-report.json");
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  console.log(`\nFull JSON report: ${outPath}`);
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
