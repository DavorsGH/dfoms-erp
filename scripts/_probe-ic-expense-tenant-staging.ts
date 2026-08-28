import { connectPg } from "./lib/pg-connect";

async function main() {
  const { client } = await connectPg({
    requiredProjectRef: "wieflwbfdmjtsdnwbfii",
    envFiles: [".env.staging.local"],
  });
  const r = await client.query(`
    SELECT e.id, e.tenant_id, e.sub_category, e.amount, ic.id AS ic_id
    FROM internal_consumption ic
    JOIN expense_register e ON e.id = ic.expense_register_id
    ORDER BY ic.created_at DESC LIMIT 3
  `);
  console.log(r.rows);
  await client.end();
}

main();
