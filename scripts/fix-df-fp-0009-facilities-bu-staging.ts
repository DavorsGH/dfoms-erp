/**
 * One-off: stamp DF-FP-0009 with the Davors Facilities business unit row.
 *
 *   npx tsx scripts/fix-df-fp-0009-facilities-bu-staging.ts
 */
import { connectPg } from "./lib/pg-connect";

const STAGING_REF = "wieflwbfdmjtsdnwbfii";
const DAVORS_TENANT = "00000001-0000-4000-8000-000000000001";
const FACILITIES_BU = "de215200-e92b-48e3-a7ba-977d7289868c";
const PRODUCT_CODE = "DF-FP-0009";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

async function main() {
  const { client, envFile } = await connectPg({
    requiredProjectRef: STAGING_REF,
    envFiles: [".env.staging.local", ".env.staging.verify.local", ".env.local"],
  });
  console.log(`Connected via ${envFile} (staging ${STAGING_REF})`);

  try {
    const buCheck = await client.query<{ id: string; name: string }>(
      `SELECT id, name FROM business_units
       WHERE tenant_id = $1 AND id = $2 AND is_active = true`,
      [DAVORS_TENANT, FACILITIES_BU],
    );
    assert(buCheck.rows.length === 1, "Davors Facilities BU row missing on staging");
    console.log(`Using BU: ${buCheck.rows[0]!.name} (${FACILITIES_BU})`);

    const before = await client.query<{
      id: string;
      product_code: string;
      product_name: string;
      business_unit_id: string | null;
    }>(
      `SELECT id, product_code, product_name, business_unit_id
       FROM finished_products
       WHERE tenant_id = $1 AND product_code = $2`,
      [DAVORS_TENANT, PRODUCT_CODE],
    );
    assert(before.rows.length === 1, `${PRODUCT_CODE} not found`);
    console.log("Before:", before.rows[0]);

    const update = await client.query(
      `UPDATE finished_products
       SET business_unit_id = $3
       WHERE tenant_id = $1
         AND product_code = $2
         AND (business_unit_id IS NULL OR business_unit_id <> $3)`,
      [DAVORS_TENANT, PRODUCT_CODE, FACILITIES_BU],
    );
    console.log(`Updated ${update.rowCount ?? 0} row(s).`);

    const after = await client.query<{
      id: string;
      product_code: string;
      business_unit_id: string | null;
    }>(
      `SELECT id, product_code, business_unit_id
       FROM finished_products
       WHERE tenant_id = $1 AND product_code = $2`,
      [DAVORS_TENANT, PRODUCT_CODE],
    );
    assert(
      after.rows[0]?.business_unit_id === FACILITIES_BU,
      "business_unit_id still wrong after update",
    );
    console.log("After:", after.rows[0]);
    console.log("\nPASS: DF-FP-0009 tagged to Davors Facilities");
  } finally {
    await client.end();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
