/**
 * Apply scripts/383_convert_davors_small_units.sql on staging only.
 * npx tsx scripts/apply-383-convert-davors-units-staging.ts
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { connectPg } from "./lib/pg-connect";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";

async function main() {
  const { client, envFile } = await connectPg({
    requiredProjectRef: STAGING_REF,
    envFiles: [".env.staging.local", ".env.staging.verify.local"],
  });
  console.log(`Connected via ${envFile} (staging ${STAGING_REF})`);

  const sqlPath = resolve(process.cwd(), "scripts/383_convert_davors_small_units.sql");
  const sql = readFileSync(sqlPath, "utf8");
  console.log("Applying 383_convert_davors_small_units.sql …\n");

  const result = await client.query(sql);

  const resultSets = Array.isArray(result) ? result : [result];
  for (const rs of resultSets) {
    if (rs.rows?.length) {
      console.log(JSON.stringify(rs.rows, null, 2));
      console.log("");
    }
  }

  const verify = await client.query(
    `SELECT * FROM backup_20261015_unit_conv_verification ORDER BY material_code`,
  );
  console.log("=== Verification (backup_20261015_unit_conv_verification) ===");
  console.log(JSON.stringify(verify.rows, null, 2));

  const batches = await client.query(`
    SELECT
      pb.id AS batch_id,
      pb.batch_number,
      pb.total_batch_cost,
      ROUND(COALESCE(SUM(pbm.quantity_used * pbm.cost_at_time), 0), 4) AS conv_line_cost
    FROM public.production_batches pb
    JOIN public.production_batch_materials pbm ON pbm.batch_id = pb.id
    JOIN public.raw_materials rm ON rm.id = pbm.material_id
    WHERE rm.tenant_id = '00000001-0000-4000-8000-000000000001'::uuid
      AND lower(trim(rm.unit_of_measure)) IN ('kg', 'litre')
    GROUP BY pb.id, pb.batch_number, pb.total_batch_cost
    ORDER BY pb.production_date DESC NULLS LAST
    LIMIT 20
  `);
  console.log("\n=== Production batches using converted materials (sample) ===");
  console.log(JSON.stringify(batches.rows, null, 2));

  await client.end();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
