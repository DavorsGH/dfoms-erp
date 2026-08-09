/** Quick read: user_accounts for empty-employee tenants */
import { connectPg } from "./lib/pg-connect";

async function main() {
  const { client } = await connectPg({ requiredProjectRef: "wieflwbfdmjtsdnwbfii" });
  const r = await client.query(`
    SELECT t.name, ua.auth_uid, ua.email, ua.role, ua.is_active
    FROM tenants t
    LEFT JOIN user_accounts ua ON ua.tenant_id = t.id
    WHERE t.name IN ('Test Landlord Co', 'Test Managed Co')
    ORDER BY t.name, ua.email
  `);
  console.log(JSON.stringify(r.rows, null, 2));
  await client.end();
}
main();
