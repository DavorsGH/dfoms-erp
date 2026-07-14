import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { loadEnvFile, resolveDatabaseUrl } from "./resolve-database-url.mjs";

function assertTrue(condition, label) {
  if (!condition) throw new Error(label);
}

async function countOrphans(client, productId) {
  const tables = [
    {
      label: "income_register (product_sale)",
      sql: `SELECT COUNT(*)::int AS count FROM income_register WHERE product_id = $1 AND entry_type = 'product_sale'`,
    },
    {
      label: "internal_consumption",
      sql: `SELECT COUNT(*)::int AS count FROM internal_consumption WHERE product_id = $1`,
    },
    {
      label: "stock_movements (by product_id)",
      sql: `SELECT COUNT(*)::int AS count FROM stock_movements WHERE product_id = $1`,
    },
    {
      label: "production_batches",
      sql: `SELECT COUNT(*)::int AS count FROM production_batches WHERE finished_product_id = $1`,
    },
  ];

  const results = {};
  for (const table of tables) {
    const { rows } = await client.query(table.sql, [productId]);
    results[table.label] = rows[0].count;
  }

  return results;
}

async function main() {
  loadEnvFile(resolve(process.cwd(), ".env.local"));
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  const databaseUrl = resolveDatabaseUrl();

  if (!url || !serviceKey || !databaseUrl) {
    throw new Error("Missing Supabase env or DATABASE_URL");
  }

  const admin = createClient(url, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const { rows: products } = await client.query(
      `SELECT id, product_code, product_name
       FROM finished_products
       WHERE product_code = 'FP-VERIFY'`,
    );

    assertTrue(products.length === 1, "FP-VERIFY finished product must exist before test");
    const product = products[0];

    const { data: preview, error: previewError } = await admin.rpc(
      "preview_finished_product_delete",
      { p_product_id: product.id },
    );
    if (previewError) throw new Error(previewError.message);

    console.log("Preview:", JSON.stringify(preview, null, 2));

    const orphansBefore = await countOrphans(client, product.id);
    console.log("Related rows before delete:", JSON.stringify(orphansBefore, null, 2));

    const { error: deleteError } = await admin.rpc("delete_finished_product_cascade", {
      p_product_id: product.id,
    });
    if (deleteError) throw new Error(deleteError.message);

    const { rows: productAfter } = await client.query(
      `SELECT id FROM finished_products WHERE id = $1`,
      [product.id],
    );
    assertTrue(productAfter.length === 0, "FP-VERIFY should be deleted");

    const orphansAfter = await countOrphans(client, product.id);
    console.log("Related rows after delete:", JSON.stringify(orphansAfter, null, 2));

    for (const [label, count] of Object.entries(orphansAfter)) {
      assertTrue(count === 0, `Orphan rows remain in ${label}`);
    }

    const expenseOrphans = await client.query(
      `
      SELECT COUNT(*)::int AS count
      FROM expense_register er
      WHERE er.notes LIKE '%' || $1 || '%'
         OR er.description LIKE '%Verify Test Cleaner%'
      `,
      [product.id],
    );
    console.log(
      "Expense rows mentioning deleted product (should be 0):",
      expenseOrphans.rows[0].count,
    );

    console.log("\nPASS: FP-VERIFY cascade delete completed with no orphaned rows.");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error.message ?? error);
  process.exit(1);
});
