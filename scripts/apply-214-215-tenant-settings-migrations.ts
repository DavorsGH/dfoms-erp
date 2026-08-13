/**
 * Apply tenant-settings migrations 214 + 215.
 *
 * Usage:
 *   npx tsx scripts/apply-214-215-tenant-settings-migrations.ts staging
 *   npx tsx scripts/apply-214-215-tenant-settings-migrations.ts production
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connectPg } from "./lib/pg-connect";

const SCRIPTS = [
  "214_sites_required_staff_default.sql",
  "215_tax_settings_review_acknowledgments.sql",
] as const;

async function verify214(client: Awaited<ReturnType<typeof connectPg>>["client"]) {
  const { rows } = await client.query(`
    SELECT column_default
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'sites'
      AND column_name = 'required_staff'
  `);
  const defaultValue = String(rows[0]?.column_default ?? "");
  if (!defaultValue.includes("0")) {
    throw new Error(`sites.required_staff default not set to 0: ${defaultValue}`);
  }
  console.log("PASS 214: sites.required_staff default is 0");
}

async function verify215(client: Awaited<ReturnType<typeof connectPg>>["client"]) {
  const { rows } = await client.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'tax_settings'
      AND column_name IN (
        'sales_tax_basis_reviewed_at',
        'product_sales_tax_rate_reviewed_at'
      )
    ORDER BY column_name
  `);
  const names = rows.map((row) => String(row.column_name));
  if (names.length !== 2) {
    throw new Error(`tax_settings review columns missing: ${names.join(", ")}`);
  }
  console.log("PASS 215: tax_settings review columns present:", names.join(", "));
}

async function main() {
  const target = process.argv[2] ?? "staging";
  const isProduction = target === "production";

  const { client, envFile, candidateIndex } = await connectPg({
    envFiles: isProduction ? [".env.local.backup"] : [".env.staging.local"],
    requiredProjectRef: isProduction ? "tvcurcnmasnocwdxzgvz" : "wieflwbfdmjtsdnwbfii",
  });

  console.log(
    `Connected to ${target} via ${envFile} (candidate ${candidateIndex})`,
  );

  try {
    for (const scriptName of SCRIPTS) {
      const sql = readFileSync(resolve(process.cwd(), "scripts", scriptName), "utf8");
      await client.query(sql);
      console.log(`OK: applied scripts/${scriptName} on ${target}`);
    }

    await verify214(client);
    await verify215(client);
    console.log(`ALL PASS — migrations 214/215 applied on ${target}`);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
