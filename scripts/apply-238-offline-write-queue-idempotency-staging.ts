/**
 * Apply scripts/238_offline_write_queue_idempotency.sql to staging only.
 *
 *   npx tsx scripts/apply-238-offline-write-queue-idempotency-staging.ts
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
    const dup = await client.query(`
      SELECT COUNT(*)::int AS groups
      FROM (
        SELECT 1
        FROM public.attendance_register
        GROUP BY tenant_id, staff_id, date
        HAVING COUNT(*) > 1
      ) d
    `);
    const groups = Number(dup.rows[0]?.groups ?? 0);
    if (groups > 0) {
      throw new Error(
        `Refusing migration: ${groups} duplicate (tenant_id, staff_id, date) group(s) exist.`,
      );
    }
    console.log("Pre-check PASS: no attendance duplicates for unique key.");

    const sql = readFileSync(
      resolve(process.cwd(), "scripts/238_offline_write_queue_idempotency.sql"),
      "utf8",
    );
    console.log("Applying 238_offline_write_queue_idempotency.sql …");
    await client.query(sql);

    const attendance = await client.query(`
      SELECT conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'public.attendance_register'::regclass
        AND conname = 'attendance_register_tenant_staff_date_key'
    `);
    if (!attendance.rows[0]) {
      throw new Error("Missing attendance_register_tenant_staff_date_key");
    }
    console.log("PASS attendance unique:", attendance.rows[0].def);

    const expenseCol = await client.query(`
      SELECT data_type
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'expense_register'
        AND column_name = 'client_op_id'
    `);
    if (!expenseCol.rows[0]) {
      throw new Error("Missing expense_register.client_op_id");
    }

    const expenseIdx = await client.query(`
      SELECT indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = 'expense_register_client_op_id_key'
    `);
    if (!expenseIdx.rows[0]) {
      throw new Error("Missing expense_register_client_op_id_key");
    }
    console.log("PASS expense client_op_id unique index:", expenseIdx.rows[0].indexdef);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
