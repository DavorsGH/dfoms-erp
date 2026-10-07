import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connectPg } from "./lib/pg-connect";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";

async function main() {
  const { client, envFile } = await connectPg({
    requiredProjectRef: STAGING_REF,
    envFiles: [".env.staging.local", ".env.local"],
  });
  console.log(`Connected via ${envFile} (staging ${STAGING_REF})`);
  const sql = readFileSync(
    resolve(process.cwd(), "scripts/362_production_batch_ic_mutations.sql"),
    "utf8",
  );
  console.log("Applying 362_production_batch_ic_mutations.sql on STAGING …");
  await client.query(sql);

  const sql364 = readFileSync(
    resolve(process.cwd(), "scripts/364_fp_adjustment_lot_dates_bulk_import.sql"),
    "utf8",
  );
  console.log("Applying 364 (adjustment WAC helper) on STAGING …");
  await client.query(sql364);

  const resync = readFileSync(
    resolve(
      process.cwd(),
      "scripts/staging-only/davors-resync-finished-product-master-stock-from-balances.sql",
    ),
    "utf8",
  );
  console.log("Resyncing Davors master FP stock from balances on STAGING …");
  await client.query(resync);

  console.log("362 + 364 + master stock resync applied on staging.");
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
