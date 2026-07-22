/**
 * Staging: FP / RM / BATCH generate_next_code wiring for inventory codes.
 * Usage: node scripts/test-inventory-codes-staging.mjs
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const DAVORS = "00000001-0000-4000-8000-000000000001";

function loadEnvForce(filePath) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    process.env[trimmed.slice(0, i).trim()] = trimmed.slice(i + 1).trim();
  }
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

loadEnvForce(resolve(process.cwd(), ".env.staging.local"));

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
assert(supabaseUrl && serviceRoleKey, "Missing staging env");
assert(supabaseUrl.includes("wieflwbfdmjtsdnwbfii"), "Refusing non-staging");

const checks = [
  [
    "app/dashboard/inventory/finished-products.tsx",
    "allocateProductCode",
    "generateNextInventoryCode",
  ],
  [
    "app/dashboard/inventory/raw-materials.tsx",
    "allocateMaterialCode",
    "generateNextInventoryCode",
  ],
  [
    "app/dashboard/inventory/production-batches.tsx",
    "allocateBatchNumber",
    "generateNextInventoryCode",
  ],
];

for (const [file, fn, banned] of checks) {
  const source = readFileSync(resolve(file), "utf8");
  assert(source.includes(fn), `${file} missing ${fn}`);
  assert(!source.includes(banned), `${file} still references ${banned}`);
}

const apiSource = readFileSync(
  resolve("app/dashboard/inventory/inventory-ids-api.ts"),
  "utf8",
);
for (const entity of ["FP", "RM", "BATCH"]) {
  assert(
    apiSource.includes(`"${entity}"`),
    `inventory-ids-api missing ${entity}`,
  );
}

const utilsSource = readFileSync(
  resolve("app/dashboard/inventory/inventory-utils.ts"),
  "utf8",
);
assert(
  !utilsSource.includes("generateNextInventoryCode"),
  "inventory-utils still exports generateNextInventoryCode",
);

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

async function snapshotCodes() {
  const [
    { data: products, error: pErr },
    { data: materials, error: mErr },
    { data: batches, error: bErr },
  ] = await Promise.all([
    supabase
      .from("finished_products")
      .select("id, product_code, tenant_id")
      .order("product_code"),
    supabase
      .from("raw_materials")
      .select("id, material_code, tenant_id")
      .order("material_code"),
    supabase
      .from("production_batches")
      .select("id, batch_number, tenant_id")
      .order("batch_number"),
  ]);
  if (pErr || mErr || bErr) {
    throw new Error(pErr?.message ?? mErr?.message ?? bErr?.message);
  }
  return {
    products: products ?? [],
    materials: materials ?? [],
    batches: batches ?? [],
  };
}

const before = await snapshotCodes();
console.log("Before counts:", {
  products: before.products.length,
  materials: before.materials.length,
  batches: before.batches.length,
});
console.log(
  "Existing product codes:",
  before.products.map((r) => r.product_code),
);

// Remove leftovers from prior failed runs (branded test codes only)
{
  const orphanProducts = before.products.filter((r) =>
    /^DF-FP-\d{4}$/.test(r.product_code),
  );
  const orphanMaterials = before.materials.filter((r) =>
    /^DF-RM-\d{4}$/.test(r.material_code),
  );
  const orphanBatches = before.batches.filter((r) =>
    /^DF-BATCH-\d{4}$/.test(r.batch_number),
  );
  for (const b of orphanBatches) {
    await supabase.from("production_batch_materials").delete().eq("batch_id", b.id);
    await supabase.from("stock_movements").delete().eq("reference_id", b.id);
    await supabase.from("production_batches").delete().eq("id", b.id);
  }
  for (const m of orphanMaterials) {
    await supabase.from("raw_materials").delete().eq("id", m.id);
  }
  for (const p of orphanProducts) {
    await supabase.from("finished_products").delete().eq("id", p.id);
  }
}

const baseline = await snapshotCodes();
console.log("Baseline after orphan cleanup:", {
  products: baseline.products.map((r) => r.product_code),
  materials: baseline.materials.map((r) => r.material_code),
  batches: baseline.batches.map((r) => r.batch_number),
});

async function allocate(entity) {
  const { data, error } = await supabase.rpc("generate_next_code", {
    p_tenant_id: DAVORS,
    p_entity_type: entity,
    p_padding: 4,
  });
  if (error || !data) throw new Error(`${entity}: ${error?.message ?? "empty"}`);
  const expected = new RegExp(`^DF-${entity}-\\d{4}$`);
  assert(expected.test(data), `Expected DF-${entity}-####, got ${data}`);
  return data;
}

const tag = `INVCODE-${Date.now().toString(36).toUpperCase()}`;
const today = new Date().toISOString().slice(0, 10);

const productCode = await allocate("FP");
const materialCode = await allocate("RM");
const batchNumber = await allocate("BATCH");
console.log("Allocated:", { productCode, materialCode, batchNumber });

const { data: product, error: productError } = await supabase
  .from("finished_products")
  .insert({
    tenant_id: DAVORS,
    product_code: productCode,
    product_name: `${tag} Product`,
    unit_of_measure: "units",
    standard_selling_price: 10,
    sourcing_type: "manufactured",
  })
  .select("id, product_code")
  .single();
if (productError) throw new Error(`FP insert: ${productError.message}`);

const { data: material, error: materialError } = await supabase
  .from("raw_materials")
  .insert({
    tenant_id: DAVORS,
    material_code: materialCode,
    material_name: `${tag} Material`,
    unit_of_measure: "kg",
    current_stock: 100,
    average_cost_per_unit: 2,
  })
  .select("id, material_code")
  .single();
if (materialError) throw new Error(`RM insert: ${materialError.message}`);

const { data: batchRow, error: batchError } = await supabase
  .from("production_batches")
  .insert({
    tenant_id: DAVORS,
    batch_number: batchNumber,
    production_date: today,
    finished_product_id: product.id,
    quantity_produced: 5,
    cost_per_unit_produced: 0.8,
    total_batch_cost: 4,
    notes: `${tag} batch`,
  })
  .select("id, batch_number, finished_product_id")
  .single();
if (batchError) throw new Error(`BATCH insert: ${batchError.message}`);

console.log("Created:", {
  product: product.product_code,
  material: material.material_code,
  batch: batchRow.batch_number,
});

assert(product.product_code === productCode, "FP code mismatch");
assert(material.material_code === materialCode, "RM code mismatch");
assert(batchRow.batch_number === batchNumber, "BATCH code mismatch");
assert(
  batchRow.finished_product_id === product.id,
  "Batch finished_product_id should reference product UUID (ordering OK)",
);

const after = await snapshotCodes();

for (const prior of baseline.products) {
  const still = after.products.find((r) => r.id === prior.id);
  assert(still, `Missing prior product ${prior.product_code}`);
  assert(
    still.product_code === prior.product_code,
    `Product code changed: ${prior.product_code} → ${still.product_code}`,
  );
}
for (const prior of baseline.materials) {
  const still = after.materials.find((r) => r.id === prior.id);
  assert(still, `Missing prior material ${prior.material_code}`);
  assert(
    still.material_code === prior.material_code,
    `Material code changed: ${prior.material_code} → ${still.material_code}`,
  );
}
for (const prior of baseline.batches) {
  const still = after.batches.find((r) => r.id === prior.id);
  assert(still, `Missing prior batch ${prior.batch_number}`);
  assert(
    still.batch_number === prior.batch_number,
    `Batch number changed: ${prior.batch_number} → ${still.batch_number}`,
  );
}

const legacyFp = baseline.products.find((r) => r.product_code === "FP-001");
if (legacyFp) {
  const still = after.products.find((r) => r.id === legacyFp.id);
  assert(still?.product_code === "FP-001", "Legacy FP-001 must remain unchanged");
  console.log("Confirmed legacy FP-001 unchanged");
}

// Cleanup test rows (leave sequences advanced — expected)
await supabase.from("production_batches").delete().eq("id", batchRow.id);
await supabase.from("raw_materials").delete().eq("id", material.id);
await supabase.from("finished_products").delete().eq("id", product.id);

const cleaned = await snapshotCodes();
assert(
  cleaned.products.length === baseline.products.length,
  "Product count should restore after cleanup",
);
assert(
  cleaned.materials.length === baseline.materials.length,
  "Material count should restore after cleanup",
);
assert(
  cleaned.batches.length === baseline.batches.length,
  "Batch count should restore after cleanup",
);

console.log("ALL CHECKS PASSED");
