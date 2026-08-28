/**
 * Apply scripts/249 to staging (property_service_records.cost_ghs).
 * Usage: npx tsx scripts/apply-249-property-service-cost-staging.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connectPg } from "./lib/pg-connect";

async function main() {
  const file = "scripts/249_property_service_records_cost.sql";
  const { client, envFile, candidateIndex } = await connectPg({
    envFiles: [".env.staging.local"],
  });
  console.log(`Connected via ${envFile} (candidate ${candidateIndex})`);

  try {
    const sql = readFileSync(resolve(process.cwd(), file), "utf8");
    await client.query(sql);
    console.log(`OK: applied ${file} on staging`);

    const { rows } = await client.query(`
      SELECT column_name, data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'property_service_records'
        AND column_name = 'cost_ghs'
    `);
    console.log("cost_ghs column:", rows[0] ?? "(missing)");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
