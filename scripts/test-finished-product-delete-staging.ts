/**
 * Staging verification for finished product delete FK handling + archive.
 * Run: npx tsx scripts/test-finished-product-delete-staging.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import {
  FINISHED_PRODUCT_DELETE_BLOCKED_MESSAGE,
  getFinishedProductDeleteErrorMessage,
  isFinishedProductDeleteForeignKeyError,
} from "../utils/finished-product-delete-errors";

function loadEnvFile(filePath: string) {
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

function assertTrue(condition: boolean, label: string) {
  if (!condition) throw new Error(label);
}

async function main() {
  loadEnvFile(resolve(process.cwd(), ".env.staging.local"));

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !serviceKey) {
    throw new Error("Missing staging Supabase env (.env.staging.local)");
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const suffix = Date.now();
  const productCode = `FP-DEL-TEST-${suffix}`;
  let productId: string | null = null;

  try {
    const fkMessage =
      'update or delete on table "finished_products" violates foreign key constraint "product_purchases_product_id_fkey" on table "product_purchases"';

    assertTrue(
      isFinishedProductDeleteForeignKeyError({ code: "23503", message: fkMessage }),
      "FK helper should detect product_purchases constraint",
    );
    assertTrue(
      getFinishedProductDeleteErrorMessage({ code: "23503", message: fkMessage }) ===
        FINISHED_PRODUCT_DELETE_BLOCKED_MESSAGE,
      "FK helper should return friendly blocked message",
    );

    const tenantId =
      process.env.VERIFY_TENANT_ID ?? "00000001-0000-4000-8000-000000000001";

    const { data: product, error: productError } = await admin
      .from("finished_products")
      .insert({
        product_code: productCode,
        product_name: "Delete Test Product",
        unit_of_measure: "each",
        sourcing_type: "purchased",
        tenant_id: tenantId,
      })
      .select("id")
      .single();

    if (productError) throw new Error(productError.message);
    productId = product.id;

    const { error: noHistoryDeleteError } = await admin.rpc(
      "delete_finished_product_cascade",
      { p_product_id: productId },
    );
    assertTrue(!noHistoryDeleteError, "Product without history should hard-delete");

    const { data: recreated, error: recreateError } = await admin
      .from("finished_products")
      .insert({
        product_code: `${productCode}-2`,
        product_name: "Delete Test Product With Purchase",
        unit_of_measure: "each",
        sourcing_type: "purchased",
        tenant_id: tenantId,
      })
      .select("id")
      .single();

    if (recreateError) throw new Error(recreateError.message);
    productId = recreated.id;

    const { error: purchaseError } = await admin.from("product_purchases").insert({
      tenant_id: tenantId,
      product_id: productId,
      purchase_date: "2026-08-01",
      quantity: 1,
      cost_per_unit: 10,
      total_cost: 10,
      payment_method: "Cash",
    });

    if (purchaseError) throw new Error(purchaseError.message);

    const { error: blockedDeleteError } = await admin.rpc(
      "delete_finished_product_cascade",
      { p_product_id: productId },
    );

    assertTrue(Boolean(blockedDeleteError), "Delete should fail when purchase history exists");
    assertTrue(
      isFinishedProductDeleteForeignKeyError(blockedDeleteError),
      `Expected FK block, got: ${blockedDeleteError?.message}`,
    );
    assertTrue(
      getFinishedProductDeleteErrorMessage(blockedDeleteError) ===
        FINISHED_PRODUCT_DELETE_BLOCKED_MESSAGE,
      "Blocked delete should map to friendly message",
    );

    const { error: archiveError } = await admin
      .from("finished_products")
      .update({ is_archived: true, updated_at: new Date().toISOString() })
      .eq("id", productId);
    if (archiveError) throw new Error(archiveError.message);

    const { data: archived, error: archivedError } = await admin
      .from("finished_products")
      .select("is_archived")
      .eq("id", productId)
      .single();

    if (archivedError) throw new Error(archivedError.message);
    assertTrue(archived.is_archived === true, "Product should be archived after deactivate");

    const { count: purchaseCount, error: countError } = await admin
      .from("product_purchases")
      .select("id", { count: "exact", head: true })
      .eq("product_id", productId);

    if (countError) throw new Error(countError.message);
    assertTrue((purchaseCount ?? 0) === 1, "Purchase history should remain after archive");

    const { data: hiddenWhenArchived, error: hiddenError } = await admin
      .from("finished_products")
      .select("id")
      .eq("id", productId)
      .eq("is_archived", false)
      .maybeSingle();

    if (hiddenError) throw new Error(hiddenError.message);
    assertTrue(!hiddenWhenArchived, "Archived product should be excluded from active dropdown filter");

    const { error: reactivateError } = await admin
      .from("finished_products")
      .update({ is_archived: false, updated_at: new Date().toISOString() })
      .eq("id", productId);
    if (reactivateError) throw new Error(reactivateError.message);

    const { data: reactivated, error: reactivatedError } = await admin
      .from("finished_products")
      .select("is_archived")
      .eq("id", productId)
      .single();

    if (reactivatedError) throw new Error(reactivatedError.message);
    assertTrue(reactivated.is_archived === false, "Product should be active after reactivate");

    const { data: visibleWhenActive, error: visibleError } = await admin
      .from("finished_products")
      .select("id")
      .eq("id", productId)
      .eq("is_archived", false)
      .maybeSingle();

    if (visibleError) throw new Error(visibleError.message);
    assertTrue(Boolean(visibleWhenActive), "Reactivated product should match active dropdown filter");

    console.log("PASS: FK error maps to friendly message");
    console.log("PASS: Product without history hard-deletes");
    console.log("PASS: Product with purchase history blocks delete");
    console.log("PASS: archive sets is_archived while preserving history");
    console.log("PASS: archived product hidden from active dropdown filter");
    console.log("PASS: reactivate clears is_archived and restores dropdown visibility");
  } finally {
    if (productId) {
      await admin.from("product_purchases").delete().eq("product_id", productId);
      await admin.from("finished_products").delete().eq("id", productId);
    }
  }
}

main().catch((error) => {
  console.error(`\nTEST FAILED: ${error instanceof Error ? error.message : error}`);
  process.exit(1);
});
