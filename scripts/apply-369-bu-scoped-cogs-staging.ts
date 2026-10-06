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
    resolve(process.cwd(), "scripts/369_create_product_sale_bu_scoped_cogs.sql"),
    "utf8",
  );
  console.log("Applying 369_create_product_sale_bu_scoped_cogs.sql …");
  await client.query(sql);
  console.log("369 applied.");
  await client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
