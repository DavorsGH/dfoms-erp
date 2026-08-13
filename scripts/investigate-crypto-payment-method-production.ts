/**
 * Read-only: check whether "Crypto Currency" payment method is unused on Davors production.
 *
 * Usage:
 *   npx tsx scripts/investigate-crypto-payment-method-production.ts --env-file .env.local.backup
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";
const DAVORS = "00000001-0000-4000-8000-000000000001";
const CRYPTO_METHOD = "Crypto Currency";

const TRANSACTION_TABLES = [
  { table: "expense_register", column: "payment_method" },
  { table: "raw_material_purchases", column: "payment_method" },
  { table: "product_purchases", column: "payment_method" },
  { table: "fixed_assets", column: "payment_method" },
  { table: "client_receipts", column: "payment_method" },
  { table: "client_invoice_payments", column: "payment_method" },
  { table: "product_sale_payments", column: "payment_method" },
];

function loadEnvForce(filePath: string) {
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const i = trimmed.indexOf("=");
    if (i === -1) continue;
    let value = trimmed.slice(i + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    process.env[trimmed.slice(0, i).trim()] = value;
  }
}

function envFileFromArgs() {
  const idx = process.argv.indexOf("--env-file");
  return idx >= 0 ? process.argv[idx + 1] : ".env.local.backup";
}

async function countMatches(admin, table: string, column: string) {
  const { count, error } = await admin
    .from(table)
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", DAVORS)
    .eq(column, CRYPTO_METHOD);

  if (error) {
    return { table, count: null, error: error.message };
  }

  return { table, count: count ?? 0, error: null };
}

async function main() {
  const envFile = envFileFromArgs();
  loadEnvForce(resolve(envFile));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!url.includes(PRODUCTION_REF)) {
    throw new Error(`Refusing non-production URL from ${envFile}`);
  }
  if (!key) {
    throw new Error("Missing SUPABASE_SERVICE_ROLE_KEY");
  }

  const admin = createClient(url, key, { auth: { persistSession: false } });

  const { data: methodRow, error: methodError } = await admin
    .from("payment_methods")
    .select("name")
    .eq("tenant_id", DAVORS)
    .eq("name", CRYPTO_METHOD)
    .maybeSingle();

  if (methodError) {
    throw new Error(methodError.message);
  }

  const { data: allMethods, error: allMethodsError } = await admin
    .from("payment_methods")
    .select("name")
    .eq("tenant_id", DAVORS)
    .order("name");

  if (allMethodsError) {
    throw new Error(allMethodsError.message);
  }

  const referenceCounts = [];
  for (const { table, column } of TRANSACTION_TABLES) {
    referenceCounts.push(await countMatches(admin, table, column));
  }

  const totalReferences = referenceCounts.reduce(
    (sum, row) => sum + (row.count ?? 0),
    0,
  );

  const safeToDelete =
    Boolean(methodRow) && totalReferences === 0 && referenceCounts.every((r) => !r.error);

  console.log(
    JSON.stringify(
      {
        environment: "production",
        tenant_id: DAVORS,
        crypto_method_present: Boolean(methodRow),
        all_payment_methods: (allMethods ?? []).map((row) => row.name),
        reference_counts: referenceCounts,
        total_references: totalReferences,
        safe_to_delete_from_davors: safeToDelete,
        recommendation: !methodRow
          ? "Crypto Currency is not in Davors payment_methods — nothing to remove."
          : safeToDelete
            ? "Safe to delete Crypto Currency from Davors payment_methods (no transactional references found)."
            : "Do NOT delete yet — historical rows reference Crypto Currency, or a table probe failed.",
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
