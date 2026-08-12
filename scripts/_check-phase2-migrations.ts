/**
 * Verify Phase 2 migrations exist on staging and production.
 * Usage: npx tsx scripts/_check-phase2-migrations.ts
 */
// @ts-nocheck
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";

function loadEnvForce(filePath) {
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

async function checkEnv(label, envFile) {
  loadEnvForce(resolve(envFile));
  const ref = /^https?:\/\/([^.]+)\.supabase\.co/.exec(
    (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").trim(),
  )?.[1];

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.SUPABASE_SERVICE_ROLE_KEY,
    { auth: { persistSession: false } },
  );

  console.log(`\n=== ${label} (${ref}) ===`);

  const { data: clientNotifications, error: cnError } = await admin
    .from("client_notifications")
    .select("id")
    .limit(1);

  console.log(
    "  211 client_notifications:",
    cnError ? `MISSING (${cnError.message})` : "OK",
  );

  const { data: taxSettings, error: tsError } = await admin
    .from("tax_settings")
    .select("sales_tax_basis")
    .limit(1);

  console.log(
    "  202 tax_settings.sales_tax_basis:",
    tsError ? `MISSING (${tsError.message})` : "OK",
  );

  const { data: quotationTaxBasis, error: qtError } = await admin
    .from("client_quotations")
    .select("tax_basis")
    .limit(1);

  console.log(
    "  210 client_quotations.tax_basis:",
    qtError ? `MISSING (${qtError.message})` : "OK",
  );

  const { data: quotationType, error: qtypeError } = await admin
    .from("client_quotations")
    .select("quotation_type")
    .limit(1);

  console.log(
    "  209 client_quotations.quotation_type:",
    qtypeError ? `MISSING (${qtypeError.message})` : "OK",
  );
}

async function main() {
  await checkEnv("staging", ".env.local");
  await checkEnv("production", ".env.local.backup");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
