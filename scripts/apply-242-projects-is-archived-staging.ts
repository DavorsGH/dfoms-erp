/**
 * Apply scripts/242_projects_is_archived.sql to staging only.
 *
 *   npx tsx scripts/apply-242-projects-is-archived-staging.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connectPg } from "./lib/pg-connect";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";

async function main() {
  const { client, envFile } = await connectPg({
    requiredProjectRef: STAGING_REF,
    envFiles: [".env.staging.local"],
  });
  console.log(`Connected via ${envFile}`);

  try {
    const sql = readFileSync(
      resolve(process.cwd(), "scripts/242_projects_is_archived.sql"),
      "utf8",
    );
    console.log("Applying 242_projects_is_archived.sql …");
    await client.query(sql);

    const col = await client.query(`
      SELECT column_default, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'projects'
        AND column_name = 'is_archived'
    `);
    if (!col.rows[0]) {
      throw new Error("projects.is_archived missing after apply");
    }
    console.log("PASS projects.is_archived", col.rows[0]);
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
