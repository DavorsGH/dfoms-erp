/**
 * Cleanup leftover CASC240* seed rows from cascade staging tests.
 *   npx tsx scripts/_cleanup-casc240-staging.ts
 */
import { connectPg } from "./lib/pg-connect";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";

async function main() {
  const { client } = await connectPg({
    requiredProjectRef: STAGING_REF,
    envFiles: [".env.staging.local"],
  });

  try {
    const mats = await client.query(
      `SELECT id, material_code FROM raw_materials WHERE material_code ILIKE 'CASC240%'`,
    );
    console.log("orphan materials", mats.rows.length);
    for (const m of mats.rows) {
      const purchases = await client.query(
        `SELECT id FROM raw_material_purchases WHERE material_id = $1`,
        [m.id],
      );
      for (const p of purchases.rows) {
        try {
          await client.query(`SELECT delete_raw_material_purchase($1::uuid)`, [
            p.id,
          ]);
        } catch {
          await client.query(`DELETE FROM raw_material_purchases WHERE id = $1`, [
            p.id,
          ]);
        }
      }
      await client.query(
        `DELETE FROM production_batch_materials WHERE material_id = $1`,
        [m.id],
      );
      await client.query(`DELETE FROM raw_materials WHERE id = $1`, [m.id]);
      console.log("cleaned material", m.material_code);
    }

    const fps = await client.query(
      `SELECT id, product_code FROM finished_products WHERE product_code ILIKE 'CASC240%'`,
    );
    console.log("orphan products", fps.rows.length);
    for (const fp of fps.rows) {
      const incomes = await client.query(
        `
        SELECT id, cogs_expense_id, cogs_reversal_expense_id
        FROM income_register
        WHERE product_id = $1
        `,
        [fp.id],
      );
      for (const inc of incomes.rows) {
        await client.query(`DELETE FROM income_register WHERE id = $1`, [inc.id]);
        if (inc.cogs_expense_id) {
          await client.query(`DELETE FROM expense_register WHERE id = $1`, [
            inc.cogs_expense_id,
          ]);
        }
        if (inc.cogs_reversal_expense_id) {
          await client.query(`DELETE FROM expense_register WHERE id = $1`, [
            inc.cogs_reversal_expense_id,
          ]);
        }
      }
      const batches = await client.query(
        `SELECT id FROM production_batches WHERE finished_product_id = $1`,
        [fp.id],
      );
      for (const b of batches.rows) {
        await client.query(
          `DELETE FROM production_batch_materials WHERE batch_id = $1`,
          [b.id],
        );
        await client.query(`DELETE FROM stock_movements WHERE reference_id = $1`, [
          b.id,
        ]);
        await client.query(`DELETE FROM production_batches WHERE id = $1`, [b.id]);
      }
      await client.query(`DELETE FROM stock_movements WHERE product_id = $1`, [
        fp.id,
      ]);
      await client.query(`DELETE FROM finished_products WHERE id = $1`, [fp.id]);
      console.log("cleaned product", fp.product_code);
    }
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
