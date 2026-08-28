/**
 * One-off: remove orphaned IC241 test rows on staging.
 */
import { connectPg } from "./lib/pg-connect";

const DAVORS = "00000001-0000-4000-8000-000000000001";

async function main() {
  const { client } = await connectPg({
    requiredProjectRef: "wieflwbfdmjtsdnwbfii",
    envFiles: [".env.staging.local"],
  });

  try {
    const targets = await client.query(
      `
      SELECT ic.id, ic.expense_register_id, ic.product_id, e.amount,
             fp.product_code
      FROM internal_consumption ic
      LEFT JOIN expense_register e ON e.id = ic.expense_register_id
      LEFT JOIN finished_products fp ON fp.id = ic.product_id
      WHERE ic.tenant_id = $1
        AND (
          ic.reason ILIKE 'IC241%'
          OR ic.notes ILIKE '%verify IC%'
          OR ic.notes ILIKE 'IC241%'
          OR fp.product_code ILIKE 'IC241%'
        )
      ORDER BY ic.created_at
      `,
      [DAVORS],
    );

    if (targets.rows.length === 0) {
      const all = await client.query(
        `
        SELECT ic.id, ic.expense_register_id, fp.product_code, e.amount
        FROM internal_consumption ic
        LEFT JOIN finished_products fp ON fp.id = ic.product_id
        LEFT JOIN expense_register e ON e.id = ic.expense_register_id
        WHERE ic.tenant_id = $1
        ORDER BY ic.created_at DESC
        `,
        [DAVORS],
      );
      console.log("No tagged rows; all Davors IC rows:", JSON.stringify(all.rows, null, 2));
      for (const row of all.rows) {
        await deleteRow(client, row.id, row.expense_register_id);
      }
    } else {
      console.log(`Deleting ${targets.rows.length} tagged row(s):`);
      for (const row of targets.rows) {
        console.log(`  ic=${row.id} expense=${row.expense_register_id} amount=${row.amount}`);
        await deleteRow(client, row.id, row.expense_register_id);
      }
    }

    const remaining = await client.query(
      `SELECT COUNT(*)::int AS n FROM internal_consumption WHERE tenant_id = $1`,
      [DAVORS],
    );
    console.log(`Davors internal_consumption rows remaining: ${remaining.rows[0]?.n}`);
  } finally {
    await client.end();
  }
}

async function deleteRow(
  client: Awaited<ReturnType<typeof connectPg>>["client"],
  icId: string,
  expenseId: string | null,
) {
  await client.query(`DELETE FROM stock_movements WHERE reference_id = $1`, [icId]);
  await client.query(
    `UPDATE internal_consumption SET expense_register_id = NULL WHERE id = $1`,
    [icId],
  );
  if (expenseId) {
    await client.query(`DELETE FROM expense_register WHERE id = $1`, [expenseId]);
  }
  await client.query(`DELETE FROM internal_consumption WHERE id = $1`, [icId]);
  console.log(`Deleted ic=${icId}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
