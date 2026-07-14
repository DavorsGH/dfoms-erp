import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { loadEnvFile, resolveDatabaseUrl } from "./resolve-database-url.mjs";

async function main() {
  loadEnvFile(resolve(process.cwd(), ".env.local"));
  const databaseUrl = resolveDatabaseUrl();
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required in .env.local to apply migrations.");
  }

  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const sql = readFileSync(
      resolve(process.cwd(), "scripts/57_finished_product_cascade_fk_fix.sql"),
      "utf8",
    );

    console.log("Applying 57_finished_product_cascade_fk_fix.sql...");
    await client.query(sql);
    console.log("Applied.");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
