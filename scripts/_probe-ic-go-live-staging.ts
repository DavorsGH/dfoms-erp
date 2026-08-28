import { connectPg } from "./lib/pg-connect";

const DAVORS = "00000001-0000-4000-8000-000000000001";

async function main() {
  const { client } = await connectPg({
    requiredProjectRef: "wieflwbfdmjtsdnwbfii",
    envFiles: [".env.staging.local"],
  });
  const cfg = await client.query(
    `SELECT go_live_date, opening_inventory_value FROM inventory_balance_config WHERE tenant_id = $1`,
    [DAVORS],
  );
  console.log("config", cfg.rows[0]);
  const ic = await client.query(
    `SELECT id, expense_register_id, consumption_date FROM internal_consumption WHERE tenant_id = $1 ORDER BY created_at DESC LIMIT 3`,
    [DAVORS],
  );
  console.log("recent ic", ic.rows);
  await client.end();
}

main();
