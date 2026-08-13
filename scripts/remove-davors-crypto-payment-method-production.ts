/**
 * Remove unused Davors production payment method "Crypto Currency".
 *
 * Usage:
 *   npx tsx scripts/remove-davors-crypto-payment-method-production.ts
 */
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadEnvForce } from "./lib/env";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const DAVORS = "00000001-0000-4000-8000-000000000001";
const CRYPTO_METHOD = "Crypto Currency";

const TRANSACTION_TABLES = [
  "expense_register",
  "raw_material_purchases",
  "product_purchases",
  "fixed_assets",
  "client_receipts",
  "client_invoice_payments",
  "product_sale_payments",
] as const;

async function main() {
  loadEnvForce(resolve(process.cwd(), ".env.local.backup"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url.includes(PRODUCTION_REF)) {
    throw new Error("Refusing non-production Supabase URL");
  }
  if (!key) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  }

  const admin = createClient(url, key, { auth: { persistSession: false } });

  for (const table of TRANSACTION_TABLES) {
    const { count, error } = await admin
      .from(table)
      .select("*", { count: "exact", head: true })
      .eq("tenant_id", DAVORS)
      .eq("payment_method", CRYPTO_METHOD);

    if (error) {
      throw new Error(`${table}: ${error.message}`);
    }

    if ((count ?? 0) > 0) {
      throw new Error(`${table} still has ${count} Crypto Currency row(s)`);
    }
  }

  const { data: before, error: beforeError } = await admin
    .from("payment_methods")
    .select("name")
    .eq("tenant_id", DAVORS)
    .order("name");

  if (beforeError) {
    throw new Error(beforeError.message);
  }

  const { error: deleteError } = await admin
    .from("payment_methods")
    .delete()
    .eq("tenant_id", DAVORS)
    .eq("name", CRYPTO_METHOD);

  if (deleteError) {
    throw new Error(deleteError.message);
  }

  const { data: after, error: afterError } = await admin
    .from("payment_methods")
    .select("name")
    .eq("tenant_id", DAVORS)
    .order("name");

  if (afterError) {
    throw new Error(afterError.message);
  }

  const beforeNames = (before ?? []).map((row) => row.name);
  const afterNames = (after ?? []).map((row) => row.name);

  if (afterNames.includes(CRYPTO_METHOD)) {
    throw new Error("Crypto Currency still present after delete");
  }

  console.log(
    JSON.stringify(
      {
        environment: "production",
        tenant_id: DAVORS,
        deleted: beforeNames.includes(CRYPTO_METHOD),
        payment_methods_before: beforeNames,
        payment_methods_after: afterNames,
        transactional_references: 0,
      },
      null,
      2,
    ),
  );
  console.log("PASS — Crypto Currency removed from Davors payment_methods");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
