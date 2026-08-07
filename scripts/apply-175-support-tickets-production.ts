/**
 * Apply scripts/175_support_tickets.sql to production.
 * Usage: npx tsx scripts/apply-175-support-tickets-production.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connectPg } from "./lib/pg-connect";

async function main() {
  const sql = readFileSync(
    resolve(process.cwd(), "scripts/175_support_tickets.sql"),
    "utf8",
  );

  const { client, envFile, candidateIndex } = await connectPg({
    envFiles: [".env.local.backup"],
    requiredProjectRef: "tvcurcnmasnocwdxzgvz",
  });
  console.log(`Connected via ${envFile} (candidate ${candidateIndex})`);

  try {
    await client.query(sql);
    console.log("OK: applied scripts/175_support_tickets.sql on production");

    const { rows: tableRows } = await client.query(
      "SELECT to_regclass('public.support_tickets') AS tbl",
    );
    console.log("Table exists:", tableRows[0]?.tbl);

    const { rows: policyRows } = await client.query(
      "SELECT policyname FROM pg_policies WHERE tablename = 'support_tickets' ORDER BY policyname",
    );
    console.log(
      "Policies:",
      policyRows.map((row) => row.policyname).join(", ") || "(none)",
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
