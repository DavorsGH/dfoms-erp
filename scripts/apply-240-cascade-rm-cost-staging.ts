/**
 * Apply scripts/240_cascade_raw_material_cost_to_batches.sql to staging only.
 *
 *   npx tsx scripts/apply-240-cascade-rm-cost-staging.ts
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
      resolve(process.cwd(), "scripts/240_cascade_raw_material_cost_to_batches.sql"),
      "utf8",
    );
    console.log("Applying 240_cascade_raw_material_cost_to_batches.sql …");
    await client.query(sql);

    for (const fn of [
      "cascade_raw_material_cost_to_batches",
      "update_raw_material_purchase",
      "delete_raw_material_purchase",
    ]) {
      const res = await client.query(
        `
        SELECT p.proname, pg_get_function_identity_arguments(p.oid) AS args
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        WHERE n.nspname = 'public' AND p.proname = $1
        ORDER BY 2
      `,
        [fn],
      );
      if (res.rows.length === 0) {
        throw new Error(`Missing function public.${fn}`);
      }
      for (const row of res.rows) {
        console.log(`PASS function ${row.proname}(${row.args})`);
      }
    }

    // Confirm cascade is referenced from update body
    const src = await client.query(`
      SELECT pg_get_functiondef(p.oid) AS def
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'update_raw_material_purchase'
      LIMIT 1
    `);
    const def = String(src.rows[0]?.def ?? "");
    if (!def.includes("cascade_raw_material_cost_to_batches")) {
      throw new Error(
        "update_raw_material_purchase does not call cascade_raw_material_cost_to_batches",
      );
    }
    if (!def.includes("recalculate_raw_material_inventory")) {
      throw new Error(
        "update_raw_material_purchase does not call recalculate_raw_material_inventory",
      );
    }
    console.log("PASS update_raw_material_purchase body calls recalculate + cascade");

    const delSrc = await client.query(`
      SELECT pg_get_functiondef(p.oid) AS def
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname = 'delete_raw_material_purchase'
      LIMIT 1
    `);
    const delDef = String(delSrc.rows[0]?.def ?? "");
    if (!delDef.includes("cascade_raw_material_cost_to_batches")) {
      throw new Error(
        "delete_raw_material_purchase does not call cascade_raw_material_cost_to_batches",
      );
    }
    console.log("PASS delete_raw_material_purchase body calls cascade");

    console.log("\nStaging apply complete.");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
