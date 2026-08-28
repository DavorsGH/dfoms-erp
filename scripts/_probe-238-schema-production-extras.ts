/**
 * READ-ONLY extras for production 238 verification.
 */
import { connectPg } from "./lib/pg-connect";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";

async function main() {
  const { client, envFile } = await connectPg({
    requiredProjectRef: PRODUCTION_REF,
    envFiles: [".env.local", ".env.local.backup"],
  });
  console.log(JSON.stringify({ envFile, projectRef: PRODUCTION_REF }));

  try {
    const constraints = await client.query(`
      SELECT conname, contype, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'public.attendance_register'::regclass
      ORDER BY conname
    `);
    console.log("attendance_constraints", JSON.stringify(constraints.rows, null, 2));

    const indexes = await client.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public' AND tablename = 'attendance_register'
      ORDER BY indexname
    `);
    console.log("attendance_indexes", JSON.stringify(indexes.rows, null, 2));

    const expenseClientOp = await client.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND tablename = 'expense_register'
        AND (indexdef ILIKE '%client_op%' OR indexname ILIKE '%client_op%')
    `);
    console.log("expense_client_op_indexes", JSON.stringify(expenseClientOp.rows, null, 2));

    const att7 = await client.query(`
      SELECT COUNT(*)::int AS n
      FROM public.attendance_register
      WHERE date >= CURRENT_DATE - 7
    `);
    const exp7 = await client.query(`
      SELECT COUNT(*)::int AS n
      FROM public.expense_register
      WHERE date >= CURRENT_DATE - 7
    `);
    console.log("counts_last_7_days", {
      attendance: att7.rows[0]?.n,
      expense: exp7.rows[0]?.n,
    });
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
