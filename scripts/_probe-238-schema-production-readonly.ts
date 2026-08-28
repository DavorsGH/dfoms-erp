/**
 * READ-ONLY: verify script 238 objects exist on PRODUCTION Supabase.
 * Does not apply migrations or mutate data.
 *
 *   npx tsx scripts/_probe-238-schema-production-readonly.ts
 */
import { connectPg } from "./lib/pg-connect";

const PRODUCTION_REF = "tvcurcnmasnocwdxzgvz";

async function main() {
  const { client, envFile } = await connectPg({
    requiredProjectRef: PRODUCTION_REF,
    envFiles: [".env.local", ".env.local.backup"],
  });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
  if (!url.includes(PRODUCTION_REF)) {
    throw new Error(`Refusing: not production (${url})`);
  }

  console.log(
    JSON.stringify({
      envFile,
      projectRef: PRODUCTION_REF,
      mode: "read-only schema probe",
    }),
  );

  try {
    const attendance = await client.query(`
      SELECT conname, pg_get_constraintdef(oid) AS def
      FROM pg_constraint
      WHERE conrelid = 'public.attendance_register'::regclass
        AND conname = 'attendance_register_tenant_staff_date_key'
    `);

    const expenseCol = await client.query(`
      SELECT data_type, is_nullable
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'expense_register'
        AND column_name = 'client_op_id'
    `);

    const expenseIdx = await client.query(`
      SELECT indexdef
      FROM pg_indexes
      WHERE schemaname = 'public'
        AND indexname = 'expense_register_client_op_id_key'
    `);

    const attendanceDupGroups = await client.query(`
      SELECT COUNT(*)::int AS groups
      FROM (
        SELECT 1
        FROM public.attendance_register
        GROUP BY tenant_id, staff_id, date
        HAVING COUNT(*) > 1
      ) d
    `);

    // Recent write activity without assuming created_at exists
    const attendanceCols = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'attendance_register'
      ORDER BY ordinal_position
    `);
    const expenseCols = await client.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'expense_register'
      ORDER BY ordinal_position
    `);

    let attendanceToday = null as number | null;
    let expenseToday = null as number | null;
    try {
      const r = await client.query(`
        SELECT COUNT(*)::int AS n
        FROM public.attendance_register
        WHERE date = CURRENT_DATE
      `);
      attendanceToday = r.rows[0]?.n ?? 0;
    } catch {
      attendanceToday = null;
    }
    try {
      const hasCreated = expenseCols.rows.some(
        (row) => row.column_name === "created_at",
      );
      if (hasCreated) {
        const r = await client.query(`
          SELECT COUNT(*)::int AS n
          FROM public.expense_register
          WHERE created_at >= now() - interval '24 hours'
        `);
        expenseToday = r.rows[0]?.n ?? 0;
      } else {
        const r = await client.query(`
          SELECT COUNT(*)::int AS n
          FROM public.expense_register
          WHERE date = CURRENT_DATE
        `);
        expenseToday = r.rows[0]?.n ?? 0;
      }
    } catch {
      expenseToday = null;
    }

    console.log(
      JSON.stringify(
        {
          attendance_unique_constraint_present: Boolean(attendance.rows[0]),
          attendance_unique_def: attendance.rows[0]?.def ?? null,
          expense_client_op_id_column_present: Boolean(expenseCol.rows[0]),
          expense_client_op_id_type: expenseCol.rows[0] ?? null,
          expense_client_op_id_unique_index_present: Boolean(expenseIdx.rows[0]),
          expense_client_op_id_indexdef: expenseIdx.rows[0]?.indexdef ?? null,
          attendance_duplicate_groups: attendanceDupGroups.rows[0]?.groups ?? null,
          attendance_rows_for_today: attendanceToday,
          expense_rows_recent: expenseToday,
          expense_has_client_op_id_in_columns: expenseCols.rows.some(
            (r) => r.column_name === "client_op_id",
          ),
          attendance_has_created_at: attendanceCols.rows.some(
            (r) => r.column_name === "created_at",
          ),
        },
        null,
        2,
      ),
    );
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
