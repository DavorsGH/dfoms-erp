import { connectPg } from "./lib/pg-connect";

async function main() {
  const { client } = await connectPg({
    envFiles: [".env.local.backup"],
    requiredProjectRef: "tvcurcnmasnocwdxzgvz",
  });
  const r = await client.query(`
    SELECT t.name, COUNT(pm.name)::int AS cnt,
           COALESCE(string_agg(pm.name, ', ' ORDER BY pm.name), '') AS names
    FROM tenants t LEFT JOIN payment_methods pm ON pm.tenant_id = t.id
    GROUP BY t.id, t.name ORDER BY t.name
  `);
  console.log(JSON.stringify(r.rows, null, 2));
  await client.end();
}
main();
