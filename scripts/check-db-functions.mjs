import pg from "pg";
import { loadEnvFile, resolveDatabaseUrl } from "./resolve-database-url.mjs";

loadEnvFile();
const client = new pg.Client({ connectionString: resolveDatabaseUrl() });
await client.connect();

const fns = [
  "assert_raw_material_stock_not_negative",
  "delete_raw_material_purchase",
  "update_raw_material_purchase",
  "preview_raw_material_delete",
  "delete_raw_material_cascade",
  "preview_finished_product_delete",
  "delete_finished_product_cascade",
  "current_user_role",
  "can_access_operations_site",
];

for (const fn of fns) {
  const { rows } = await client.query(
    `select proname from pg_proc join pg_namespace n on n.oid = pronamespace where n.nspname = 'public' and proname = $1`,
    [fn],
  );
  console.log(fn, rows.length ? "exists" : "missing");
}

await client.end();
