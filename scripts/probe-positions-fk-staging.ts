import { connectPg } from "./lib/pg-connect";

async function main() {
  const { client } = await connectPg({ requiredProjectRef: "wieflwbfdmjtsdnwbfii" });
  const cols = await client.query(`
    SELECT column_name FROM information_schema.columns
    WHERE table_name = 'positions' ORDER BY ordinal_position
  `);
  const fk = await client.query(`
    SELECT pg_get_constraintdef(c.oid) AS def
    FROM pg_constraint c JOIN pg_class t ON t.oid = c.conrelid
    WHERE t.relname = 'employees' AND c.conname LIKE '%position%'
  `);
  const pos = await client.query(`
    SELECT tenant_id, position_title FROM positions
    WHERE position_title ILIKE '%admin%' OR position_title = 'Administrator'
    LIMIT 10
  `);
  console.log("positions cols", cols.rows);
  console.log("employees position fk", fk.rows);
  console.log("admin positions", pos.rows);
  await client.end();
}
main();
