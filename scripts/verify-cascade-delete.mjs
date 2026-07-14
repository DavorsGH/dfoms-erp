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

function assertTrue(condition, label) {
  if (!condition) throw new Error(label);
}

async function main() {
  loadEnvFile(resolve(process.cwd(), ".env.local"));
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
  );

  const rpcs = [
    "preview_raw_material_delete",
    "delete_raw_material_cascade",
    "preview_finished_product_delete",
    "delete_finished_product_cascade",
    "delete_raw_material_purchase",
    "update_raw_material_purchase",
  ];

  for (const rpc of rpcs) {
    const { error } = await supabase.rpc(rpc, {
      p_material_id: "00000000-0000-0000-0000-000000000000",
      p_product_id: "00000000-0000-0000-0000-000000000000",
      p_purchase_id: "00000000-0000-0000-0000-000000000000",
      p_purchase_date: "2026-01-01",
      p_quantity: 1,
      p_cost_per_unit: 1,
      p_supplier: "Test",
      p_payment_method: "Cash",
      p_notes: null,
    });
    if (error?.message.includes("Could not find the function")) {
      throw new Error(
        `Migration 46 not applied: missing RPC ${rpc}. Apply scripts/46_cascade_delete_and_purchase_rpcs.sql first.`,
      );
    }
  }

  const { data: testMaterial, error: materialError } = await supabase
    .from("raw_materials")
    .select("id, material_name, material_code")
    .eq("material_name", "Test Material A")
    .maybeSingle();

  if (materialError) throw new Error(materialError.message);

  if (!testMaterial) {
    console.log("Test Material A not found — skipping delete test.");
    console.log("RPC probe: OK (migration appears applied).");
    return;
  }

  const { data: preview, error: previewError } = await supabase.rpc(
    "preview_raw_material_delete",
    { p_material_id: testMaterial.id },
  );
  if (previewError) throw new Error(previewError.message);

  console.log("Preview:", JSON.stringify(preview, null, 2));
  assertTrue(
    Number(preview.purchase_count) >= 1,
    "Expected Test Material A to have at least one purchase in preview",
  );

  const { data: purchasesBefore } = await supabase
    .from("raw_material_purchases")
    .select("id, total_cost, payment_method, accounts_payable_id")
    .eq("material_id", testMaterial.id);

  const { error: deleteError } = await supabase.rpc("delete_raw_material_cascade", {
    p_material_id: testMaterial.id,
  });
  if (deleteError) throw new Error(deleteError.message);

  const { data: materialAfter } = await supabase
    .from("raw_materials")
    .select("id")
    .eq("id", testMaterial.id);
  assertTrue((materialAfter ?? []).length === 0, "Material should be deleted");

  const { data: purchasesAfter } = await supabase
    .from("raw_material_purchases")
    .select("id")
    .eq("material_id", testMaterial.id);
  assertTrue((purchasesAfter ?? []).length === 0, "Purchases should be deleted");

  for (const purchase of purchasesBefore ?? []) {
    if (purchase.accounts_payable_id) {
      const { data: payable } = await supabase
        .from("accounts_payable")
        .select("id")
        .eq("id", purchase.accounts_payable_id)
        .maybeSingle();
      assertTrue(!payable, "Linked accounts payable should be removed");
    }
  }

  console.log("Cascade delete test passed for Test Material A.");
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
