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

function assertClose(actual, expected, label) {
  const diff = Math.abs(Number(actual) - Number(expected));
  if (diff > 0.0001) {
    throw new Error(`${label}: expected ${expected}, got ${actual}`);
  }
}

function assertTrue(condition, label) {
  if (!condition) {
    throw new Error(label);
  }
}

async function ensureGoLive(supabase) {
  const { data } = await supabase
    .from("inventory_balance_config")
    .select("go_live_date")
    .eq("id", 1)
    .maybeSingle();

  if (!data) {
    const { error } = await supabase.from("inventory_balance_config").insert({
      id: 1,
      go_live_date: "2026-01-01",
      opening_inventory_value: 0,
    });
    if (error) {
      throw new Error(`Failed to seed inventory_balance_config: ${error.message}`);
    }
  }
}

async function getMaterialCashOutflowTotal(supabase, materialId) {
  const { data, error } = await supabase
    .from("raw_material_purchases")
    .select("total_cost, payment_method")
    .eq("material_id", materialId);

  if (error) {
    throw new Error(error.message);
  }

  return (data ?? [])
    .filter((row) => {
      const method = (row.payment_method ?? "").toLowerCase();
      return !method.includes("credit") && !method.includes("on account");
    })
    .reduce((sum, row) => sum + (Number(row.total_cost) || 0), 0);
}

async function cleanup(supabase, ids) {
  const { batchId, purchaseId, materialId, productId } = ids;

  if (batchId) {
    await supabase
      .from("production_batch_materials")
      .delete()
      .eq("batch_id", batchId);
    await supabase.from("stock_movements").delete().eq("reference_id", batchId);
    await supabase.from("production_batches").delete().eq("id", batchId);
  }

  if (purchaseId) {
    const { error } = await supabase.rpc("delete_raw_material_purchase", {
      p_purchase_id: purchaseId,
    });
    if (error) {
      await supabase.from("raw_material_purchases").delete().eq("id", purchaseId);
    }
  }

  if (materialId) {
    await supabase.from("raw_material_purchases").delete().eq("material_id", materialId);
    await supabase.from("raw_materials").delete().eq("id", materialId);
  }

  if (productId) {
    await supabase.from("finished_products").delete().eq("id", productId);
  }
}

async function main() {
  loadEnvFile(resolve(process.cwd(), ".env.local"));
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  await ensureGoLive(supabase);

  const { error: rpcProbeError } = await supabase.rpc("archive_raw_material", {
    p_material_id: "00000000-0000-0000-0000-000000000000",
  });

  if (
    rpcProbeError &&
    (rpcProbeError.message.includes("Could not find the function") ||
      rpcProbeError.message.includes("is_archived"))
  ) {
    throw new Error(
      "Migration 45 is not applied yet. Run scripts/45_purchase_edit_delete_and_archive.sql in the Supabase SQL Editor (or node scripts/apply-migration-45.mjs with DATABASE_URL set).",
    );
  }

  const suffix = Date.now();
  const materialCode = `RM-TEST-A-${suffix}`;
  const productCode = `FP-TEST-${suffix}`;
  const batchNumber = `BATCH-TEST-${suffix}`;

  const ids = {
    batchId: null,
    purchaseId: null,
    materialId: null,
    productId: null,
  };

  try {
    const { data: material, error: materialError } = await supabase
      .from("raw_materials")
      .insert({
        material_code: materialCode,
        material_name: "Test Material A",
        unit_of_measure: "kg",
      })
      .select("id")
      .single();

    if (materialError) throw new Error(materialError.message);
    ids.materialId = material.id;

    const { data: purchase, error: purchaseError } = await supabase
      .from("raw_material_purchases")
      .insert({
        material_id: material.id,
        purchase_date: "2026-07-14",
        quantity: 50,
        cost_per_unit: 10,
        total_cost: 500,
        supplier: "Test Supplier",
        payment_method: "Cash",
        notes: "verify purchase edit/delete",
      })
      .select("id")
      .single();

    if (purchaseError) throw new Error(purchaseError.message);
    ids.purchaseId = purchase.id;

    const { data: afterInsert, error: afterInsertError } = await supabase
      .from("raw_materials")
      .select("current_stock, average_cost_per_unit")
      .eq("id", material.id)
      .single();

    if (afterInsertError) throw new Error(afterInsertError.message);
    assertClose(afterInsert.current_stock, 50, "Stock after initial purchase");
    assertClose(afterInsert.average_cost_per_unit, 10, "Avg cost after initial purchase");

    const cashAfterInsert = await getMaterialCashOutflowTotal(supabase, material.id);
    assertClose(cashAfterInsert, 500, "Cash outflow after initial purchase");

    const { error: editError } = await supabase.rpc("update_raw_material_purchase", {
      p_purchase_id: purchase.id,
      p_purchase_date: "2026-07-14",
      p_quantity: 50,
      p_cost_per_unit: 12,
      p_supplier: "Test Supplier",
      p_payment_method: "Cash",
      p_notes: "verify purchase edit/delete",
    });

    if (editError) throw new Error(editError.message);

    const { data: afterEdit, error: afterEditError } = await supabase
      .from("raw_materials")
      .select("current_stock, average_cost_per_unit")
      .eq("id", material.id)
      .single();

    if (afterEditError) throw new Error(afterEditError.message);
    assertClose(afterEdit.current_stock, 50, "Stock after edit");
    assertClose(afterEdit.average_cost_per_unit, 12, "Avg cost after edit");

    const cashAfterEdit = await getMaterialCashOutflowTotal(supabase, material.id);
    assertClose(cashAfterEdit, 600, "Cash outflow after edit");

    const { error: deleteError } = await supabase.rpc("delete_raw_material_purchase", {
      p_purchase_id: purchase.id,
    });

    if (deleteError) throw new Error(deleteError.message);
    ids.purchaseId = null;

    const { data: afterDelete, error: afterDeleteError } = await supabase
      .from("raw_materials")
      .select("current_stock, average_cost_per_unit")
      .eq("id", material.id)
      .single();

    if (afterDeleteError) throw new Error(afterDeleteError.message);
    assertClose(afterDelete.current_stock, 0, "Stock after delete");
    assertClose(afterDelete.average_cost_per_unit, 0, "Avg cost after delete");

    const cashAfterDelete = await getMaterialCashOutflowTotal(supabase, material.id);
    assertClose(cashAfterDelete, 0, "Cash outflow after delete");

    const { data: repurchase, error: repurchaseError } = await supabase
      .from("raw_material_purchases")
      .insert({
        material_id: material.id,
        purchase_date: "2026-07-14",
        quantity: 50,
        cost_per_unit: 10,
        total_cost: 500,
        supplier: "Test Supplier",
        payment_method: "Cash",
        notes: "verify blocked delete",
      })
      .select("id")
      .single();

    if (repurchaseError) throw new Error(repurchaseError.message);
    ids.purchaseId = repurchase.id;

    const { data: product, error: productError } = await supabase
      .from("finished_products")
      .insert({
        product_code: productCode,
        product_name: "Test Product",
        unit_of_measure: "litres",
        standard_selling_price: 25,
      })
      .select("id")
      .single();

    if (productError) throw new Error(productError.message);
    ids.productId = product.id;

    const { data: batchId, error: batchError } = await supabase.rpc(
      "create_production_batch",
      {
        p_batch_number: batchNumber,
        p_production_date: "2026-07-14",
        p_finished_product_id: product.id,
        p_quantity_produced: 20,
        p_notes: "verify blocked delete",
        p_materials: [{ material_id: material.id, quantity_used: 6 }],
      },
    );

    if (batchError) throw new Error(batchError.message);
    ids.batchId = batchId;

    const { error: blockedDeleteError } = await supabase.rpc(
      "delete_raw_material_purchase",
      { p_purchase_id: repurchase.id },
    );

    assertTrue(
      Boolean(blockedDeleteError),
      "Expected delete to be blocked after batch consumption",
    );
    assertTrue(
      blockedDeleteError.message.includes("Cannot delete"),
      `Expected negative-stock message, got: ${blockedDeleteError.message}`,
    );
    assertTrue(
      blockedDeleteError.message.includes("6kg"),
      `Expected consumed quantity in message, got: ${blockedDeleteError.message}`,
    );

    const { error: archiveError } = await supabase.rpc("archive_raw_material", {
      p_material_id: material.id,
    });

    if (archiveError) throw new Error(archiveError.message);

    const { data: archivedMaterial, error: archivedError } = await supabase
      .from("raw_materials")
      .select("is_archived")
      .eq("id", material.id)
      .single();

    if (archivedError) throw new Error(archivedError.message);
    assertTrue(archivedMaterial.is_archived, "Material should be archived");

    const { data: purchaseHistory, error: historyError } = await supabase
      .from("raw_material_purchases")
      .select("id")
      .eq("material_id", material.id);

    if (historyError) throw new Error(historyError.message);
    assertTrue(
      (purchaseHistory ?? []).length === 1,
      "Purchase history should remain after archive",
    );

    console.log("PASS: Purchase edit updates avg cost and cash outflow.");
    console.log("PASS: Purchase delete resets stock and reverses cash outflow.");
    console.log("PASS: Delete blocked when production consumption exceeds remaining purchases.");
    console.log("PASS: Archive hides material flag while preserving purchase history.");
  } finally {
    await cleanup(supabase, ids);
  }
}

main().catch((error) => {
  console.error(`\nVERIFY FAILED: ${error.message}`);
  process.exit(1);
});
