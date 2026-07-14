import { resolve } from "node:path";
import { loadEnvFile, resolveDatabaseUrl } from "./resolve-database-url.mjs";

async function ensureProductStock(client, minimum = 10) {
  const countResult = await client.query(
    `SELECT COUNT(*)::int AS count FROM finished_products`,
  );
  if (countResult.rows[0].count === 0) {
    await client.query(
      `
      INSERT INTO finished_products (
        product_code, product_name, unit_of_measure, current_stock, standard_selling_price
      ) VALUES (
        'FP-VERIFY', 'Verify Test Cleaner', 'Litre', $1, 12.50
      )
    `,
      [minimum],
    );
  }

  const existing = await client.query(
    `
    SELECT id, product_code, product_name, current_stock
    FROM finished_products
    WHERE current_stock >= $1
    ORDER BY product_name
    LIMIT 1
  `,
    [minimum],
  );

  if (existing.rows[0]) {
    return existing.rows[0];
  }

  const updated = await client.query(
    `
    UPDATE finished_products
    SET current_stock = $1
    WHERE id = (
      SELECT id FROM finished_products ORDER BY product_name LIMIT 1
    )
    RETURNING id, product_code, product_name, current_stock
  `,
    [minimum],
  );

  if (!updated.rows[0]) {
    throw new Error("No finished_products row available to seed stock for verification.");
  }

  return updated.rows[0];
}

async function main() {
  loadEnvFile(resolve(process.cwd(), ".env.local"));
  const databaseUrl = resolveDatabaseUrl();
  if (!databaseUrl) throw new Error("DATABASE_URL missing");

  const { default: pg } = await import("pg");
  const client = new pg.Client({ connectionString: databaseUrl });
  await client.connect();

  try {
    const product = await ensureProductStock(client, 10);
    console.log(
      JSON.stringify(
        {
          seeded: !Number(product.current_stock) || Number(product.current_stock) < 10,
          product,
        },
        null,
        2,
      ),
    );
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
